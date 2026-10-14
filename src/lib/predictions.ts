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
  predicted_at?: string | null;
};

export type PredictionRecord = PredictionImportRow & {
  id: number;
  expires_at: string | null;
};

function plain(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clean(value: string | null | undefined, limit: number): string {
  return (value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
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


/**
 * O aplicativo exporta .xls como texto tabulado Windows-1252.
 * Só quatro campos operacionais são usados, sem dados de pacientes.
 */
export type PriorityXlsSourceRow = {
  bed: string;
  sector: string;
  status: string;
  predictedAt: string;
};

function normalizePriorityStatus(status: string): string | null {
  const key = plain(status);
  if (key === "alta medica assinada") return "Alta médica assinada";
  if (key === "alta prevista confirmada") return "Alta prevista confirmada";
  if (key === "alta prevista nao confirmada") return "Alta prevista não confirmada";
  return null;
}

/** Converte dd/MM/yyyy HH:mm[:ss] de Brasília e valida o calendário. */
function priorityDateToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, day, month, year, hours, minutes, seconds = "00"] = match;
  const iso = year + "-" + month + "-" + day + "T" + hours + ":" + minutes + ":" + seconds + "-03:00";
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return null;
  const brt = new Date(instant.getTime() - 3 * 60 * 60 * 1000);
  if (
    brt.getUTCDate() !== Number(day) ||
    brt.getUTCMonth() + 1 !== Number(month) ||
    brt.getUTCFullYear() !== Number(year) ||
    brt.getUTCHours() !== Number(hours) ||
    brt.getUTCMinutes() !== Number(minutes) ||
    brt.getUTCSeconds() !== Number(seconds)
  ) return null;
  return instant.toISOString();
}

export function normalizePriorityRows(rows: PriorityXlsSourceRow[]): PredictionImportRow[] {
  const unique = new Map<string, PredictionImportRow>();
  const rank = (status: string) =>
    status === "Alta médica assinada" ? 3 :
      status === "Alta prevista confirmada" ? 2 : 1;
  for (const row of rows) {
    const status = normalizePriorityStatus(clean(row.status, 80));
    const bed = normalizeBed(clean(row.bed, 60));
    const sourceSector = clean(row.sector, 120);
    const predictedAt = clean(row.predictedAt, 40);
    if (!status || !bed || !sourceSector || !/^\d{4}-\d{2}-\d{2}T/.test(predictedAt)) continue;
    const parsed = new Date(predictedAt);
    if (!Number.isFinite(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(predictedAt)) continue;
    const unit = normalizeUnit(sourceSector, bed.block, bed.digits);
    if (!unit || isExcludedUnit(unit)) continue;
    const entry: PredictionImportRow = {
      bed_number: bed.bedNumber,
      unit,
      source_sector: sourceSector,
      probability_text: status,
      probability_value: null,
      predicted_time: parsed.toISOString(),
      predicted_at: parsed.toISOString(),
    };
    const key = unit + "|" + bed.bedNumber;
    const previous = unique.get(key);
    if (!previous || rank(status) > rank(previous.probability_text) ||
      (rank(status) === rank(previous.probability_text) &&
        (entry.predicted_at ?? "") > (previous.predicted_at ?? ""))) {
      unique.set(key, entry);
    }
  }
  return [...unique.values()].sort((a, b) =>
    (a.predicted_at ?? "").localeCompare(b.predicted_at ?? "") ||
    a.bed_number.localeCompare(b.bed_number, "pt-BR", { numeric: true }),
  );
}

export function parsePriorityXls(content: string): {
  total: number;
  sources: PriorityXlsSourceRow[];
  predictions: PredictionImportRow[];
} {
  if (content.length > 1_000_000) throw new Error("O XLS deve ter no máximo 1 MB.");
  if (content.includes("\u0000")) {
    throw new Error("Este XLS não está no formato tabulado do aplicativo de prioridades.");
  }
  const records = readDelimitedCsv(content.replace(/^\uFEFF/, ""));
  if (!records.length) throw new Error("Arquivo XLS vazio.");
  const names = records[0].map(headerKey);
  const header = (...labels: string[]) => names.findIndex((name) => labels.includes(name));
  const idx = {
    status: header("probabilidade"),
    at: header("hora min"),
    bed: header("unidade"),
    sector: header("setor atendimento"),
  };
  if (Object.values(idx).some((i) => i < 0) || !content.includes("\t")) {
    throw new Error("XLS inválido. Esperado: Probabilidade, Hora/Min, Unidade e Setor atendimento.");
  }
  const sources = records.slice(1).map((cols) => ({
    status: cols[idx.status] ?? "",
    bed: cols[idx.bed] ?? "",
    sector: cols[idx.sector] ?? "",
    predictedAt: priorityDateToIso(cols[idx.at] ?? "") ?? "",
  }));
  return { total: sources.length, sources, predictions: normalizePriorityRows(sources) };
}
