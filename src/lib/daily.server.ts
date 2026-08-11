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

/** Eventos de higiene diária por leito, deduplicados (em execução tem prioridade). */
export async function loadDailyBedEvents(): Promise<DailyBedEvent[]> {
  const token = await login();
  const answers = await fetchAnswers(token, 16);

  const byBed = new Map<string, DailyBedEvent>();
  for (const a of answers) {
    const kind = kindOf(a);
    if (!kind) continue;
    const bed = bedNumber(a);
    if (!bed) continue;
    const status = statusOf(a);
    if (!status) continue;

    const at = (parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date()).toISOString();
    const ev: DailyBedEvent = {
      bed,
      kind,
      status,
      shift: shiftOf(a),
      staff: a.userName?.trim() || null,
      unit: [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—",
      at,
    };

    const prev = byBed.get(bed);
    if (!prev) {
      byBed.set(bed, ev);
      continue;
    }
    // Em execução sempre vence; entre iguais, o mais recente vence.
    const prevScore = prev.status === "in_progress" ? 1 : 0;
    const score = status === "in_progress" ? 1 : 0;
    if (score > prevScore || (score === prevScore && at > prev.at)) {
      byBed.set(bed, ev);
    }
  }

  return Array.from(byBed.values());
}
