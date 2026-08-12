/**
 * Leitura ao vivo das rotinas de higiene diária (concorrente) e camareira no Listo360.
 * Não usa banco: consulta o Listo direto a cada chamada, então o painel /diaria
 * funciona em tempo real sem depender de sync.
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
  startTime: string | null;
  endTime: string | null;
  date: string | null;
  statusAnswer: { id: number; displayName: string | null } | null;
};

export type DailyKind = "concorrente" | "camareira";
export type DailyStatus = "in_progress" | "completed";

export type DailyBedEvent = {
  bed: string;
  kind: DailyKind;
  status: DailyStatus;
  shift: string;
  staff: string | null;
  unit: string;
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

function bedNumber(a: ListoAnswer): string | null {
  const m = (a.locationName || "").match(/^\s*leito\s*0*(\d+)/i);
  return m ? m[1] : null;
}

function kindOf(a: ListoAnswer): DailyKind | null {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  if (route.startsWith("rotina camareira") || insp.startsWith("camareira")) return "camareira";
  if (route.startsWith("limpeza concorrente")) return "concorrente";
  return null;
}

function shiftOf(a: ListoAnswer): string {
  const route = a.routeName || "";
  if (/manh/i.test(route)) return "Manhã";
  if (/tarde/i.test(route)) return "Tarde";
  if (/noite/i.test(route)) return "Noite";
  return "—";
}

function statusOf(a: ListoAnswer): DailyStatus | null {
  const id = a.statusAnswer?.id;
  if (id === 2 && !a.endTime) return "in_progress";
  if (id === 3 || id === 6 || a.endTime) return "completed";
  return null;
}

// Turnos (horário de Brasília): Manhã 06:20-13:40, Tarde 13:40-22:00, Noite 22:00-06:20.
const SHIFT_BOUNDARIES = [
  { label: "Manhã", startMin: 6 * 60 + 20 },
  { label: "Tarde", startMin: 13 * 60 + 40 },
  { label: "Noite", startMin: 22 * 60 },
] as const;

/** "Agora" com os getters UTC representando o horário de parede de Brasília (UTC-3, sem DST). */
function nowAsBrtWallClock(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

/** Início/fim (instantes reais, em UTC) do turno em andamento agora em Brasília. */
function currentShiftWindow(): { start: Date; end: Date; label: string } {
  const wall = nowAsBrtWallClock();
  const minutesNow = wall.getUTCHours() * 60 + wall.getUTCMinutes();

  let label: (typeof SHIFT_BOUNDARIES)[number]["label"] = "Noite";
  let startMin = SHIFT_BOUNDARIES[2].startMin;
  let dayOffset = minutesNow < SHIFT_BOUNDARIES[0].startMin ? -1 : 0;

  for (const s of SHIFT_BOUNDARIES) {
    if (minutesNow >= s.startMin) {
      label = s.label;
      startMin = s.startMin;
      dayOffset = 0;
    }
  }

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
  // volta o horário de parede BRT para o instante real em UTC
  const start = new Date(startWall.getTime() + 3 * 60 * 60 * 1000);

  const lengthMin =
    label === "Manhã"
      ? SHIFT_BOUNDARIES[1].startMin - SHIFT_BOUNDARIES[0].startMin
      : label === "Tarde"
        ? SHIFT_BOUNDARIES[2].startMin - SHIFT_BOUNDARIES[1].startMin
        : 24 * 60 - SHIFT_BOUNDARIES[2].startMin + SHIFT_BOUNDARIES[0].startMin;
  const end = new Date(start.getTime() + lengthMin * 60 * 1000);

  return { start, end, label };
}

/** Eventos de higiene diária por leito, deduplicados (em execução tem prioridade). */
export async function loadDailyBedEvents(): Promise<DailyBedEvent[]> {
  const token = await login();
  const answers = await fetchAnswers(token, 26);
  const { start: shiftStart, end: shiftEnd } = currentShiftWindow();

  const byBed = new Map<string, DailyBedEvent>();
  for (const a of answers) {
    const kind = kindOf(a);
    if (!kind) continue;
    const bed = bedNumber(a);
    if (!bed) continue;
    const status = statusOf(a);
    if (!status) continue;

    const at = (parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date()).toISOString();
    const atDate = new Date(at);
    // Só conta pro turno em andamento agora — no início de cada turno, o leito
    // volta a aparecer como "sem rotina" até que a equipe registre uma nova entrada.
    if (atDate < shiftStart || atDate >= shiftEnd) continue;

    const ev: DailyBedEvent = {
      bed,
      kind,
      status,
      shift: shiftOf(a),
      staff: a.userName?.trim() || null,
      unit: [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—",
      at,
    };

    // Chave por leito + tipo de rotina: um leito pode ter concorrente E camareira
    // no mesmo turno, e as duas precisam aparecer (não uma sobrescrever a outra).
    const key = `${bed}|${kind}`;
    const prev = byBed.get(key);
    if (!prev) {
      byBed.set(key, ev);
      continue;
    }
    // Em execução sempre vence; entre iguais, o mais recente vence.
    const prevScore = prev.status === "in_progress" ? 1 : 0;
    const score = status === "in_progress" ? 1 : 0;
    if (score > prevScore || (score === prevScore && at > prev.at)) {
      byBed.set(key, ev);
    }
  }

  return Array.from(byBed.values());
}
