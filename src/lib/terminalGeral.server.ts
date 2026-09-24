/**
 * Leitura ao vivo da rotina "Limpeza Terminal Geral" no Listo360 — diferente da
 * limpeza terminal de leito (vinculada à alta de um paciente), essa é a limpeza
 * terminal de ÁREAS COMUNS (recepção, postos, corredores, etc.), sem número de
 * leito. Não usa banco: consulta o Listo direto a cada chamada.
 *
 * O catálogo de áreas (quais existem, em qual bloco/andar/setor) vem de
 * TERMINAL_GERAL_AREAS (src/lib/terminalGeralAreas.ts — lista fornecida pela
 * operação). Isso garante que toda área conhecida apareça na tela, mesmo sem
 * nenhuma rotina registrada ainda (aí ela entra como "pendente"). Qualquer área
 * que aparecer no Listo e NÃO estiver nessa lista ainda entra do mesmo jeito
 * (descoberta ao vivo), como rede de segurança.
 */

import { TERMINAL_GERAL_AREAS } from "@/lib/terminalGeralAreas";

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
// Janela do fetch principal — o catálogo de áreas já vem fixo da lista acima,
// então essa janela só precisa cobrir o turno atual + uma margem de segurança
// (não precisa mais ser gigante só pra "descobrir" área).
const FETCH_HOURS = 26;

type ListoAnswer = {
  id: number;
  routeName: string | null;
  inspectionName: string | null;
  locationName: string | null;
  sectorName: string | null;
  sectorDescription: string | null;
  userName: string | null;
  isPriority: boolean;
  answerComment: { comment?: string | null } | string | null;
  startTime: string | null;
  endTime: string | null;
  date: string | null;
  statusAnswer: { id: number; displayName: string | null } | null;
};

/** Só 3 estados, como pedido: em andamento, pendente, concluída — sem "a
 * caminho", "pausada" ou "aguardando" (tudo isso vira "pendente"). */
export type TerminalGeralStatus = "in_progress" | "pendente" | "completed";
export type TerminalGeralBlock = "D" | "E" | "C" | "B" | "A" | "outro";

export type TerminalGeralEvent = {
  area: string;
  unit: string;
  block: TerminalGeralBlock;
  /** Número do andar, pra ordenar do maior pro menor. Null quando block="outro". */
  floor: number | null;
  /** Nome completo do setor dentro do andar (ex: "1ºss - Tomografia",
   * "07º Andar - Semi/Uti - Pediatrica") — vários setores podem compartilhar o
   * mesmo número de andar (ex: vários "1ºss - X" são todos "andar 1"), então
   * isso é o que realmente distingue uma área de outra, e o que agrupa a
   * exibição quando há mais de um setor no mesmo andar. */
  floorLabel: string | null;
  /** Nome do grupo original quando block === "outro" (ex: "Térreo B",
   * "Mezanino Diretoria") — pra não misturar tudo numa lista só sem contexto. */
  outroGrupo: string | null;
  status: TerminalGeralStatus;
  staff: string | null;
  reason: string | null;
  /** null quando a área está pendente (nenhum registro neste turno). */
  at: string | null;
};

function parseBRT(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}-03:00`);
  return isNaN(d.getTime()) ? null : d;
}

async function login(): Promise<string> {
  const res = await fetch(`${LISTO_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env["LISTO360_EMAIL"],
      password: process.env["LISTO360_PASSWORD"],
    }),
  });
  if (!res.ok) throw new Error("Falha ao autenticar na origem dos dados");
  const data = (await res.json()) as { token?: string; accessToken?: string };
  const token = data.token || data.accessToken;
  if (!token) throw new Error("Falha ao autenticar na origem dos dados");
  return token;
}

async function fetchAnswers(token: string, hours: number): Promise<ListoAnswer[]> {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const all: ListoAnswer[] = [];
  const pageSize = 500;
  for (let page = 1; page <= 60; page++) {
    const url = `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}&pageSize=${pageSize}&pageNumber=${page}&startDate=${fmt(start)}&endDate=${fmt(end)}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error("Falha ao consultar as rotinas");
    const body = (await res.json()) as ListoAnswer[] | { data?: ListoAnswer[] };
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

function isTerminalGeralRoute(a: ListoAnswer): boolean {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  return route.includes("terminal geral") || insp.includes("terminal geral");
}

/** Só áreas de verdade — nunca leito (unidade avulsa por paciente). Nomes que
 * contêm a palavra "box" como parte do nome de uma área fixa (ex: "Box de
 * Sinais Vitais", "Corredor - Box 05|08") são áreas reais, não são excluídos. */
function isRealArea(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !!n && !n.startsWith("leito");
}

function extractComment(c: ListoAnswer["answerComment"]): string | null {
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.comment ?? null;
}

const VALID_BLOCKS = new Set(["D", "E", "C", "B", "A"]);

/**
 * Extrai bloco + andar (número, pra ordenar) + setor (texto completo, pra
 * identificar unicamente) de um "unit" (ex: "Bloco B 07º Andar - Semi/Uti -
 * Pediatrica", "Bloco C 1ºss - Tomografia"). Trata "Térreo" sem número como
 * andar 0. Áreas fora desse padrão (anexos administrativos distintos dos
 * blocos principais no próprio Listo, ex: "Térreo B", "Mezanino Diretoria")
 * caem em "outro".
 *
 * IMPORTANTE: vários setores diferentes podem começar com o mesmo número (ex:
 * "1ºss - Tomografia", "1ºss - Raio X" e "01º Andar - Oncologia" são todos
 * "andar 1", mas são lugares diferentes) — por isso floorLabel (o texto
 * completo do setor) é o que deve ser usado pra identificar uma área de forma
 * única, nunca só o número do andar.
 */
function blockAndFloorOf(unit: string): { block: TerminalGeralBlock; floor: number | null; floorLabel: string | null } {
  const m = unit.match(/^BLOCO\s+([A-Z])\s*(.*)$/i);
  if (m && VALID_BLOCKS.has(m[1].toUpperCase())) {
    const floorLabel = m[2].trim() || null;
    const numMatch = floorLabel?.match(/0*(\d+)/);
    const floor = numMatch ? parseInt(numMatch[1], 10) : /T[ÉE]RREO/i.test(floorLabel || "") ? 0 : null;
    return { block: m[1].toUpperCase() as TerminalGeralBlock, floor, floorLabel };
  }
  return { block: "outro", floor: null, floorLabel: null };
}

function statusOf(a: ListoAnswer): TerminalGeralStatus {
  const id = a.statusAnswer?.id;
  const hasEnd = !!a.endTime;
  if (id === 3 || id === 6 || hasEnd) return "completed";
  if (a.startTime && !hasEnd) return "in_progress";
  if (id === 2 && !hasEnd) return "in_progress";
  return "pendente";
}

// Turnos em horário de Brasília — mesma janela usada em /lib/daily.server.ts.
// Sem isso, uma área concluída ontem à tarde continuaria aparecendo como
// "concluída" hoje de manhã, mesmo sem nada feito no turno atual.
const SHIFT_BOUNDARIES = [
  { label: "Manhã", startMin: 6 * 60 + 20 },
  { label: "Tarde", startMin: 13 * 60 + 40 },
  { label: "Noite", startMin: 22 * 60 },
] as const;

function currentShiftWindow(): { start: Date; end: Date } {
  const wall = new Date(Date.now() - 3 * 60 * 60 * 1000); // horário de parede BRT
  const minutesNow = wall.getUTCHours() * 60 + wall.getUTCMinutes();

  let startMin: number = SHIFT_BOUNDARIES[2].startMin;
  let dayOffset = minutesNow < SHIFT_BOUNDARIES[0].startMin ? -1 : 0;
  let shiftIndex = 2;

  SHIFT_BOUNDARIES.forEach((s, i) => {
    if (minutesNow >= s.startMin) {
      startMin = s.startMin;
      dayOffset = 0;
      shiftIndex = i;
    }
  });

  const startWall = new Date(
    Date.UTC(
      wall.getUTCFullYear(),
      wall.getUTCMonth(),
      wall.getUTCDate() + dayOffset,
      Math.floor(startMin / 60),
      startMin % 60,
      0,
      0,
    ),
  );
  const start = new Date(startWall.getTime() + 3 * 60 * 60 * 1000);

  const lengthMin =
    shiftIndex === 0
      ? SHIFT_BOUNDARIES[1].startMin - SHIFT_BOUNDARIES[0].startMin
      : shiftIndex === 1
        ? SHIFT_BOUNDARIES[2].startMin - SHIFT_BOUNDARIES[1].startMin
        : 24 * 60 - SHIFT_BOUNDARIES[2].startMin + SHIFT_BOUNDARIES[0].startMin;
  const end = new Date(start.getTime() + lengthMin * 60 * 1000);

  return { start, end };
}

type CatalogEntry = {
  unit: string;
  area: string;
  block: TerminalGeralBlock;
  floor: number | null;
  floorLabel: string | null;
  outroGrupo: string | null;
};

/** Chave que identifica uma área de forma única: bloco + setor completo + nome
 * — nunca só o número do andar (colide entre setores diferentes) nem só o
 * nome (se repete em dezenas de andares, tipo "WC Masculino" ou "DML"). */
function areaKey(block: TerminalGeralBlock, floorLabel: string | null, area: string): string {
  return `${block}|${(floorLabel ?? "-").toLowerCase()}|${area.trim().toLowerCase()}`;
}

function outroGrupoOf(unit: string): string {
  return unit.replace(/\s+Térreo$|\s+Mezanino$/i, "").trim() || unit.trim();
}

/**
 * Eventos de limpeza terminal de áreas comuns: uma linha por área SEMPRE —
 * mesmo que a área não tenha nenhuma rotina neste turno (aí ela entra como
 * "pendente", nunca herdando um "concluída" de um turno já passado).
 */
export async function loadTerminalGeralEvents(): Promise<TerminalGeralEvent[]> {
  const token = await login();
  const answers = await fetchAnswers(token, FETCH_HOURS);
  const relevant = answers.filter((a) => isTerminalGeralRoute(a) && isRealArea(a.locationName || ""));
  const { start: shiftStart, end: shiftEnd } = currentShiftWindow();

  // 1) Catálogo: parte da lista fixa (garante cobertura total das áreas
  // conhecidas), e soma qualquer área nova que apareça no Listo e ainda não
  // esteja na lista (rede de segurança).
  const catalog = new Map<string, CatalogEntry>();
  for (const seed of TERMINAL_GERAL_AREAS) {
    const { block, floor, floorLabel } = blockAndFloorOf(seed.unit);
    const key = areaKey(block, floorLabel, seed.area);
    if (!catalog.has(key)) {
      catalog.set(key, {
        unit: seed.unit,
        area: seed.area,
        block,
        floor,
        floorLabel,
        outroGrupo: block === "outro" ? outroGrupoOf(seed.unit) : null,
      });
    }
  }
  for (const a of relevant) {
    const area = (a.locationName || a.sectorDescription || `Área ${a.id}`).trim();
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const { block, floor, floorLabel } = blockAndFloorOf(unit);
    const key = areaKey(block, floorLabel, area);
    if (!catalog.has(key)) {
      catalog.set(key, {
        unit,
        area,
        block,
        floor,
        floorLabel,
        outroGrupo: block === "outro" ? outroGrupoOf(unit) : null,
      });
    }
  }

  // 2) Status atual: só o que caiu dentro do turno em andamento agora
  const currentByKey = new Map<string, ListoAnswer>();
  for (const a of relevant) {
    const at = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date);
    if (!at || at < shiftStart || at >= shiftEnd) continue;
    const area = (a.locationName || a.sectorDescription || `Área ${a.id}`).trim();
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const { block, floorLabel } = blockAndFloorOf(unit);
    const key = areaKey(block, floorLabel, area);
    const prev = currentByKey.get(key);
    if (!prev) {
      currentByKey.set(key, a);
      continue;
    }
    const prevAt = parseBRT(prev.endTime) ?? parseBRT(prev.startTime) ?? parseBRT(prev.date) ?? new Date(0);
    const emAndamento = (x: ListoAnswer) => (statusOf(x) === "in_progress" ? 1 : 0);
    if (emAndamento(a) > emAndamento(prev) || (emAndamento(a) === emAndamento(prev) && at > prevAt)) {
      currentByKey.set(key, a);
    }
  }

  // 3) Junta: toda área do catálogo aparece, "pendente" por padrão
  return Array.from(catalog.entries()).map(([key, info]) => {
    const cur = currentByKey.get(key);
    if (!cur) {
      return {
        area: info.area,
        unit: info.unit,
        block: info.block,
        floor: info.floor,
        floorLabel: info.floorLabel,
        outroGrupo: info.outroGrupo,
        status: "pendente" as const,
        staff: null,
        reason: null,
        at: null,
      };
    }
    const at = (parseBRT(cur.endTime) ?? parseBRT(cur.startTime) ?? parseBRT(cur.date) ?? new Date()).toISOString();
    return {
      area: info.area,
      unit: info.unit,
      block: info.block,
      floor: info.floor,
      floorLabel: info.floorLabel,
      outroGrupo: info.outroGrupo,
      status: statusOf(cur),
      staff: cur.userName?.trim() || null,
      reason: extractComment(cur.answerComment),
      at,
    };
  });
}
