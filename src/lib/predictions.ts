import { isExcludedUnit } from "@/lib/operationalScope";

// Nenhuma informacao identificavel de pacientes (nome, ID, idade, medico)
// entra no payload de importacao ou na tabela do Supabase.
export type PredictionSourceRow = {
  establishment: string;
  sector: string;
  bed: string;
  probability: string;
  dischargeType: string;
  predictedTime?: string | null;
};

export type PredictionImportRow = {
  bed_number: string;
  unit: string;
  source_sector: string;
  probability_text: string;
  probability_value: number | null;
  predicted_time: string | null;
};

export type PredictionRecord = PredictionImportRow & {
  id: number;
  expires_at: string;
};

function plain(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clean(value: string | null | undefined, limit: number): string {
  return (value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
}

/** Proxima troca de turno da TV (06:20, 13:40, 22:00 em Brasilia). */
export function nextPredictionShift(nowMs: number): string {
  const brt = new Date(nowMs - 3 * 60 * 60 * 1000);
  const midnightUTC = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate());
  const minuteOfDay = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const targets = [6 * 60 + 20, 13 * 60 + 40, 22 * 60];
  const target = targets.find((time) => time > minuteOfDay) ?? targets[0] + 24 * 60;
  return new Date(midnightUTC + (target + 180) * 60_000).toISOString();
}

function parseProbability(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?%?$/.test(normalized)) return null;
  const n = Number(normalized.replace("%", ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Normaliza codigo C602/D1556/E875 ao formato Leito 602/1556/875. */
function normalizeBed(sourceBed: string): { bedNumber: string; block: string; digits: string } | null {
  const bed = plain(sourceBed).toUpperCase().replace(/\s+/g, " ");
  const found = bed.match(/^([B-CDE])\s*[- ]?\s*(\d{2,5})$/);
  if (found) return { bedNumber: `Leito ${Number(found[2])}`, block: found[1], digits: found[2] };
  const plainBed = bed.match(/^(?:LEITO\s*)?(\d{2,5})$/);
  if (plainBed) return { bedNumber: `Leito ${Number(plainBed[1])}`, block: "", digits: plainBed[1] };
  return null; // Box, UTI ou outras areas fora das regras operacionais da TV
}

function normalizeUnit(sector: string, blockFromBed: string, digits: string): string | null {
  const text = plain(sector);
  const leadingBlock = text.match(/^([bcde])\s*(?:[-/]|\s)/)?.[1]?.toUpperCase() ?? "";
  const pediatricBlock = text.match(/\b([bcde])\s*(?:pediatria|\/tmo)/)?.[1]?.toUpperCase() ?? "";
  const block = blockFromBed || leadingBlock || pediatricBlock;
  if (!block || (leadingBlock && !text.startsWith("d/e") && leadingBlock !== block)) return null;

  const namedFloor = text.match(/(\d{1,2})\s*[ºª°oa]?\s*andar/)?.[1] ??
    text.match(/ui\s*[- ]\s*(\d{1,2})\s*[ªºao]?\s*b\b/)?.[1];
  // Se o setor nao trouxer andar, o proprio codigo D1556/C1115 indica 15/11.
  const inferredFloor = digits.length >= 3 ? Number(digits.slice(0, -2)) : null;
  const floor = namedFloor ? Number(namedFloor) : inferredFloor;
  if (!floor || floor > 30 || floor < 1) return null;
  return `Bloco ${block} ${String(floor).padStart(2, "0")}º andar`;
}

function normalizeDischargeType(value: string): "Alta Médica" | "Alta Real" | null {
  const normalized = plain(value);
  if (normalized === "alta medica") return "Alta Médica";
  if (normalized === "alta real") return "Alta Real";
  return null;
}

export function normalizePredictionRows(rows: PredictionSourceRow[]): PredictionImportRow[] {
  const unique = new Map<string, PredictionImportRow>();
  for (const row of rows) {
    if (plain(clean(row.establishment, 80)) !== "bela vista") continue;
    // O Command Center não preenche "Prob. Alta" neste relatório.
    // Para a TV, o tipo de alta é a informação operacional confiável.
    const dischargeType = normalizeDischargeType(clean(row.dischargeType, 80));
    if (!dischargeType) continue;
    const sourceSector = clean(row.sector, 120);
    const bed = normalizeBed(clean(row.bed, 60));
    if (!sourceSector || !bed) continue;
    const unit = normalizeUnit(sourceSector, bed.block, bed.digits);
    if (!unit || isExcludedUnit(unit)) continue;
    const entry: PredictionImportRow = {
      bed_number: bed.bedNumber,
      unit,
      source_sector: sourceSector,
      // Mantém a coluna existente para não exigir migração no banco.
      // Nesta versão ela guarda o tipo de alta, nunca uma porcentagem fictícia.
      probability_text: dischargeType,
      probability_value: null,
      predicted_time: null,
    };
    const key = `${unit}|${bed.bedNumber}`;
    const previous = unique.get(key);
    // Quando um mesmo leito aparecer nas duas categorias, "Alta Real" prevalece.
    if (!previous || (previous.probability_text === "Alta Médica" && dischargeType === "Alta Real")) {
      unique.set(key, entry);
    }
  }
  return Array.from(unique.values()).sort(
    (a, b) => a.probability_text.localeCompare(b.probability_text, "pt-BR") ||
      a.bed_number.localeCompare(b.bed_number, "pt-BR", { numeric: true }),
  );
}

function readDelimitedCsv(csv: string): string[][] {
  const firstLine = csv.slice(0, csv.indexOf("\n") > -1 ? csv.indexOf("\n") : csv.length);
  const delimiters = [",", ";", "\t"];
  const separator = delimiters.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === separator) {
      current.push(cell); cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      current.push(cell); cell = "";
      if (current.some((v) => v.trim())) rows.push(current);
      current = [];
    } else {
      cell += char;
    }
    if (rows.length > 3000) throw new Error("O CSV tem linhas demais para esta importacao.");
  }
  if (quoted) throw new Error("O CSV tem aspas nao fechadas.");
  current.push(cell);
  if (current.some((v) => v.trim())) rows.push(current);
  return rows;
}

function headerKey(s: string): string {
  return plain(s.replace(/^\uFEFF/, "")).replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseCommandCenterCsv(csv: string): {
  total: number;
  sources: PredictionSourceRow[];
  predictions: PredictionImportRow[];
} {
  if (csv.length > 1_000_000) throw new Error("O CSV deve ter no maximo 1 MB.");
  const records = readDelimitedCsv(csv.replace(/^\uFEFF/, ""));
  if (!records.length) throw new Error("Arquivo CSV vazio.");
  const names = records[0].map(headerKey);
  const find = (...labels: string[]) => names.findIndex((k) => labels.includes(k));
  const indices = {
    establishment: find("estabelecimento"),
    sector: find("setor origem"),
    bed: find("leito origem"),
    probability: find("prob alta", "probabilidade alta", "probabilidade de alta"),
    dischargeType: find("procedencia", "pendencia", "tipo de alta"),
    predictedTime: find("horario previsto", "hora prevista", "previsao horario", "previsao de alta", "data prevista de alta"),
  };
  if ([indices.establishment, indices.sector, indices.bed, indices.dischargeType].some(i => i < 0)) {
    throw new Error("CSV nao reconhecido. Esperado: Estabelecimento, Setor Origem, Leito Origem e Procedencia.");
  }
  const sources = records.slice(1).map(row => ({
    establishment: row[indices.establishment] ?? "",
    sector: row[indices.sector] ?? "",
    bed: row[indices.bed] ?? "",
    probability: indices.probability < 0 ? "" : row[indices.probability] ?? "",
    dischargeType: row[indices.dischargeType] ?? "",
    predictedTime: indices.predictedTime < 0 ? null : row[indices.predictedTime] ?? null,
  }));
  return { total: sources.length, sources, predictions: normalizePredictionRows(sources) };
}
