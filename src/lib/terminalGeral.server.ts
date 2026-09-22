/**
 * Leitura ao vivo da rotina "Limpeza Terminal Geral" no Listo360 — diferente da
 * limpeza terminal de leito (vinculada à alta de um paciente), essa é a limpeza
 * terminal de ÁREAS COMUNS (recepção, postos, corredores, etc.), sem número de
 * leito nem "box". Não usa banco: consulta o Listo direto a cada chamada.
 *
 * LIMITAÇÃO CONHECIDA: ao contrário dos leitos (que têm uma lista fixa e
 * completa em src/lib/beds.ts, fornecida pela operação), não existe aqui uma
 * lista fixa das áreas comuns do hospital. A lista abaixo é "descoberta" a
 * partir do histórico de respostas do Listo dos últimos DISCOVERY_HOURS —
 * uma área que não teve NENHUMA rotina de Limpeza Terminal Geral nesse período
 * simplesmente não aparece na tela. Se quiser garantir 100% de cobertura,
 * passa a lista real das áreas (nome + bloco + andar) que o time usa no Listo,
 * do mesmo jeito que foi feito para os leitos, que eu deixo isso fixo.
 */

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
// Janela usada só pra "descobrir" quais áreas existem (ver limitação acima).
// Maior que as 24h de um turno pra pegar áreas que não são limpas todo dia,
// mas sem exagerar (isso é buscado a cada poll da tela, não pode ficar lento).
const DISCOVERY_HOURS = 48;

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
export type TerminalGeralBlock = "D" | "E" | "C" | "B" | "outro";

export type TerminalGeralEvent = {
  area: string;
  unit: string;
  block: TerminalGeralBlock;
  floor: number | null;
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

/** Só áreas de verdade — nunca leito, nunca "box" (espaço avulso/temporário). */
function isRealArea(a: ListoAnswer): boolean {
  const name = (a.locationName || "").trim().toLowerCase();
  if (!name) return false;
  if (name.startsWith("leito")) return false;
  if (/\bbox\b/.test(name)) return false;
  return true;
}

function extractComment(c: ListoAnswer["answerComment"]): string | null {
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.comment ?? null;
}

function blockAndFloorOf(unit: string): { block: TerminalGeralBlock; floor: number | null } {
  const m = unit.toUpperCase().match(/BLOCO\s+([A-Z])[^\d]*0*(\d+)/);
  if (!m) return { block: "outro", floor: null };
  const b = m[1];
  const floor = parseInt(m[2], 10);
  if (b === "D" || b === "E" || b === "C" || b === "B") return { block: b, floor };
  return { block: "outro", floor };
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

/**
 * Eventos de limpeza terminal de áreas comuns: uma linha por área SEMPRE —
 * mesmo que a área não tenha nenhuma rotina neste turno (aí ela entra como
 * "pendente", nunca herdando um "concluída" de um turno já passado).
 */
export async function loadTerminalGeralEvents(): Promise<TerminalGeralEvent[]> {
  const token = await login();
  const answers = await fetchAnswers(token, DISCOVERY_HOURS);
  const relevant = answers.filter((a) => isTerminalGeralRoute(a) && isRealArea(a));
  const { start: shiftStart, end: shiftEnd } = currentShiftWindow();

  // 1) Catálogo de áreas conhecidas (nome + bloco/andar), descoberto no histórico
  const catalog = new Map<string, { unit: string; block: TerminalGeralBlock; floor: number | null }>();
  for (const a of relevant) {
    const area = (a.locationName || a.sectorDescription || `Área ${a.id}`).trim();
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    if (!catalog.has(area)) {
      catalog.set(area, { unit, ...blockAndFloorOf(unit) });
    }
  }

  // 2) Status atual: só o que caiu dentro do turno em andamento agora
  const currentByArea = new Map<string, ListoAnswer>();
  for (const a of relevant) {
    const at = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date);
    if (!at || at < shiftStart || at >= shiftEnd) continue;
    const area = (a.locationName || a.sectorDescription || `Área ${a.id}`).trim();
    const prev = currentByArea.get(area);
    if (!prev) {
      currentByArea.set(area, a);
      continue;
    }
    const prevAt = parseBRT(prev.endTime) ?? parseBRT(prev.startTime) ?? parseBRT(prev.date) ?? new Date(0);
    const emAndamento = (x: ListoAnswer) => (statusOf(x) === "in_progress" ? 1 : 0);
    if (emAndamento(a) > emAndamento(prev) || (emAndamento(a) === emAndamento(prev) && at > prevAt)) {
      currentByArea.set(area, a);
    }
  }

  // 3) Junta: toda área do catálogo aparece, "pendente" por padrão
  return Array.from(catalog.entries()).map(([area, info]) => {
    const cur = currentByArea.get(area);
    if (!cur) {
      return {
        area,
        unit: info.unit,
        block: info.block,
        floor: info.floor,
        status: "pendente" as const,
        staff: null,
        reason: null,
        at: null,
      };
    }
    const at = (parseBRT(cur.endTime) ?? parseBRT(cur.startTime) ?? parseBRT(cur.date) ?? new Date()).toISOString();
    return {
      area,
      unit: info.unit,
      block: info.block,
      floor: info.floor,
      status: statusOf(cur),
      staff: cur.userName?.trim() || null,
      reason: extractComment(cur.answerComment),
      at,
    };
  });
}
