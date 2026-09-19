/**
 * Leitura ao vivo da rotina "Limpeza Terminal Geral" no Listo360 — diferente da
 * limpeza terminal de leito (que é vinculada à alta de um paciente), essa é a
 * limpeza terminal de ÁREAS COMUNS (recepção, postos, corredores, etc.), sem
 * número de leito. Não usa banco: consulta o Listo direto a cada chamada.
 */

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;

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

export type TerminalGeralStatus = "waiting_cleaning" | "en_route" | "in_progress" | "paused" | "completed";
/** Os dois agrupamentos de bloco usados nessa tela (mesmo agrupamento do rodapé do /tv). */
export type BlockGroup = "DE" | "BC" | "outro";

export type TerminalGeralEvent = {
  id: number;
  area: string;
  unit: string;
  blockGroup: BlockGroup;
  status: TerminalGeralStatus;
  staff: string | null;
  reason: string | null;
  at: string;
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
  for (let page = 1; page <= 30; page++) {
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

function isTerminalGeral(a: ListoAnswer): boolean {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  const isBed = (a.locationName || "").toLowerCase().trim().startsWith("leito");
  // "Limpeza Terminal Geral" é de área comum — nunca tem número de leito.
  return !isBed && (route.includes("terminal geral") || insp.includes("terminal geral"));
}

function extractComment(c: ListoAnswer["answerComment"]): string | null {
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.comment ?? null;
}

function blockGroupOf(unit: string): BlockGroup {
  const m = unit.toUpperCase().match(/BLOCO\s+([A-Z])/);
  const b = m?.[1];
  if (b === "D" || b === "E") return "DE";
  if (b === "B" || b === "C") return "BC";
  return "outro";
}

/** Mesma lógica de status usada no sync principal (sync-listo360.ts), simplificada. */
function statusOf(a: ListoAnswer): TerminalGeralStatus {
  const id = a.statusAnswer?.id;
  const hasEnd = !!a.endTime;
  const hasStart = !!a.startTime;
  const hasUser = !!(a.userName && a.userName.trim());

  if (id === 4 || id === 7) return "paused";
  if (id === 3 || id === 6) return "completed";
  if (id === 2) return hasEnd ? "completed" : "in_progress";
  if (hasEnd) return "completed";
  if (hasStart) return "in_progress";
  if (hasUser) return "en_route";
  return "waiting_cleaning";
}

/** Eventos de limpeza terminal de áreas comuns, um por área (a resposta mais recente). */
export async function loadTerminalGeralEvents(): Promise<TerminalGeralEvent[]> {
  const token = await login();
  const answers = await fetchAnswers(token, 26);
  const relevant = answers.filter(isTerminalGeral);

  const byArea = new Map<string, TerminalGeralEvent>();
  for (const a of relevant) {
    const area = (a.locationName || a.sectorDescription || `Área ${a.id}`).trim();
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const at = (parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date()).toISOString();

    const ev: TerminalGeralEvent = {
      id: a.id,
      area,
      unit,
      blockGroup: blockGroupOf(unit),
      status: statusOf(a),
      staff: a.userName?.trim() || null,
      reason: extractComment(a.answerComment),
      at,
    };

    const prev = byArea.get(area);
    if (!prev || new Date(at) > new Date(prev.at)) {
      byArea.set(area, ev);
    }
  }

  return Array.from(byArea.values());
}
