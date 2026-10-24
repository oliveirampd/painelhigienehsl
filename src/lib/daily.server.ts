import { ACTIVE_DAILY_BEDS, isDailyConcurrentEligibleBed } from "@/lib/dailyScope";

/**
 * Leitura ao vivo das rotinas de higiene diária (concorrente) e camareira no Listo360.
 * Não usa banco: consulta o Listo direto a cada chamada, então o painel /diaria
 * funciona em tempo real sem depender de sync.
 */

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const QUERY_MARGIN_MS = 10 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 12 * 1000;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

let tokenCache: { token: string; expiresAt: number } | null = null;
let dailyCache: { shiftStartMs: number; expiresAt: number; events: DailyBedEvent[] } | null = null;
let dailyInFlight: { shiftStartMs: number; promise: Promise<DailyBedEvent[]> } | null = null;

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
  startedAt: string | null;
  completedAt: string | null;
  /** Quantos ciclos concluídos desse tipo de rotina esse leito já teve neste turno. */
  count: number;
};

type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

function getEdgeCache(): EdgeCache | null {
  return (
    globalThis as unknown as { caches?: { default?: EdgeCache } }
  ).caches?.default ?? null;
}

function dailyEdgeRequest(shiftStartMs: number): Request {
  return new Request(`https://painelhigiene.internal/cache/daily/${shiftStartMs}`);
}

async function readDailyEdgeCache(shiftStartMs: number): Promise<DailyBedEvent[] | null> {
  const cache = getEdgeCache();
  if (!cache) return null;
  try {
    const response = await cache.match(dailyEdgeRequest(shiftStartMs));
    return response ? ((await response.json()) as DailyBedEvent[]) : null;
  } catch {
    return null;
  }
}

async function writeDailyEdgeCache(shiftStartMs: number, events: DailyBedEvent[]): Promise<void> {
  const cache = getEdgeCache();
  if (!cache) return;
  try {
    await cache.put(
      dailyEdgeRequest(shiftStartMs),
      new Response(JSON.stringify(events), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${Math.ceil(RESULT_CACHE_TTL_MS / 1000)}`,
        },
      }),
    );
  } catch {
    // Cache de borda é otimização; nunca derruba a leitura ao vivo.
  }
}

function parseBRT(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}-03:00`);
  return isNaN(d.getTime()) ? null : d;
}

async function login(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

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
  tokenCache = { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS };
  return token;
}

function formatListoDate(d: Date): string {
  // A API do Listo trabalha com data/hora de parede sem timezone. Convertemos
  // o instante real para Brasília antes de remover o offset.
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 19);
}

async function fetchAnswers(start: Date, end: Date): Promise<ListoAnswer[]> {
  const all: ListoAnswer[] = [];
  const pageSize = 500;
  let token = await login();

  for (let page = 1; page <= 30; page++) {
    const url = `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}&pageSize=${pageSize}&pageNumber=${page}&startDate=${formatListoDate(start)}&endDate=${formatListoDate(end)}`;
    let res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });

    if (res.status === 401 || res.status === 403) {
      token = await login(true);
      res = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    }

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
  return new Date(Date.now() - BRT_OFFSET_MS);
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
  const start = new Date(startWall.getTime() + BRT_OFFSET_MS);

  const lengthMin =
    label === "Manhã"
      ? SHIFT_BOUNDARIES[1].startMin - SHIFT_BOUNDARIES[0].startMin
      : label === "Tarde"
        ? SHIFT_BOUNDARIES[2].startMin - SHIFT_BOUNDARIES[1].startMin
        : 24 * 60 - SHIFT_BOUNDARIES[2].startMin + SHIFT_BOUNDARIES[0].startMin;
  const end = new Date(start.getTime() + lengthMin * 60 * 1000);

  return { start, end, label };
}

const ACTIVE_DAILY_BEDS_BY_NUMBER = new Map(ACTIVE_DAILY_BEDS.map((item) => [item.n, item] as const));

async function loadDailyBedEventsFresh(
  shiftStart: Date,
  shiftEnd: Date,
): Promise<DailyBedEvent[]> {
  // A tela só considera o turno atual. Buscar 26h fazia o Worker baixar e
  // processar registros que seriam descartados logo abaixo.
  const queryStart = new Date(shiftStart.getTime() - QUERY_MARGIN_MS);
  const answers = await fetchAnswers(queryStart, new Date());

  const byBed = new Map<string, { event: Omit<DailyBedEvent, "count">; completedCount: number }>();

  const seenCompletedCycles = new Set<string>();
  for (const a of answers) {
    const kind = kindOf(a);
    if (!kind) continue;
    const bed = bedNumber(a);
    if (!bed) continue;
    const bedRef = ACTIVE_DAILY_BEDS_BY_NUMBER.get(bed);
    if (!bedRef) continue;
    if (kind === "concorrente" && !isDailyConcurrentEligibleBed(bed, bedRef.b)) continue;
    const status = statusOf(a);
    if (!status) continue;

    const startAt = parseBRT(a.startTime);
    const endAt = parseBRT(a.endTime);
    const sourceAt = parseBRT(a.date);
    const atDate = endAt ?? startAt ?? sourceAt;
    if (!atDate || atDate.getTime() > Date.now()) continue;
    const at = atDate.toISOString();
    // Só conta pro turno em andamento agora — no início de cada turno, o leito
    // volta a aparecer como "sem rotina" até que a equipe registre uma nova entrada.
    if (atDate < shiftStart || atDate >= shiftEnd) continue;

    const cycleAnchor = startAt ?? endAt ?? sourceAt;
    const completedCycleKey =
      status === "completed" && cycleAnchor
        ? `${bed}|${kind}|${Math.floor(cycleAnchor.getTime() / 60000)}`
        : null;
    const completedIncrement =
      completedCycleKey && !seenCompletedCycles.has(completedCycleKey) ? 1 : 0;
    if (completedCycleKey) seenCompletedCycles.add(completedCycleKey);

    const ev: Omit<DailyBedEvent, "count"> = {
      bed,
      kind,
      status,
      shift: shiftOf(a),
      staff: a.userName?.trim() || null,
      unit: [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—",
      at,
      startedAt: startAt?.toISOString() ?? (status === "in_progress" ? at : null),
      completedAt: status === "completed" ? (endAt?.toISOString() ?? null) : null,
    };

    // Chave por leito + tipo de rotina: um leito pode ter concorrente E camareira
    // no mesmo turno, e as duas precisam aparecer (não uma sobrescrever a outra).
    // Se o mesmo tipo repetir (ex: concorrente de novo depois da camareira), o
    // registro anterior não é descartado — soma no contador (completedCount),
    // e o card mostra "×N" pra indicar que houve mais de um ciclo no turno.
    const key = `${bed}|${kind}`;
    const prev = byBed.get(key);
    if (!prev) {
      byBed.set(key, { event: ev, completedCount: completedIncrement });
      continue;
    }
    const completedCount = prev.completedCount + completedIncrement;
    // Em execução sempre vence pra exibição; entre iguais, o mais recente vence.
    const prevScore = prev.event.status === "in_progress" ? 1 : 0;
    const score = status === "in_progress" ? 1 : 0;
    const event = score > prevScore || (score === prevScore && at > prev.event.at) ? ev : prev.event;
    byBed.set(key, { event, completedCount });
  }

  return Array.from(byBed.values()).map(({ event, completedCount }) => ({
    ...event,
    count: Math.max(completedCount, event.status === "completed" ? 1 : 0),
  }));
}

/** Eventos de higiene diária por leito, deduplicados (em execução tem prioridade). */
export async function loadDailyBedEvents(): Promise<DailyBedEvent[]> {
  const { start: shiftStart, end: shiftEnd } = currentShiftWindow();
  const shiftStartMs = shiftStart.getTime();
  const now = Date.now();

  if (dailyCache && dailyCache.shiftStartMs === shiftStartMs && dailyCache.expiresAt > now) {
    return dailyCache.events;
  }
  if (dailyInFlight && dailyInFlight.shiftStartMs === shiftStartMs) {
    return dailyInFlight.promise;
  }

  const edgeEvents = await readDailyEdgeCache(shiftStartMs);
  if (edgeEvents) {
    dailyCache = {
      shiftStartMs,
      expiresAt: Date.now() + RESULT_CACHE_TTL_MS,
      events: edgeEvents,
    };
    return edgeEvents;
  }

  // Outra requisição pode ter começado enquanto consultávamos o cache de borda.
  if (dailyInFlight && dailyInFlight.shiftStartMs === shiftStartMs) {
    return dailyInFlight.promise;
  }

  const promise = loadDailyBedEventsFresh(shiftStart, shiftEnd)
    .then(async (events) => {
      dailyCache = {
        shiftStartMs,
        expiresAt: Date.now() + RESULT_CACHE_TTL_MS,
        events,
      };
      await writeDailyEdgeCache(shiftStartMs, events);
      return events;
    })
    .catch((error) => {
      // Em uma oscilação curta do Listo, mantém o último estado válido do mesmo
      // turno em vez de transformar a tela inteira em loading/erro.
      if (dailyCache?.shiftStartMs === shiftStartMs) return dailyCache.events;
      throw error;
    })
    .finally(() => {
      if (dailyInFlight?.promise === promise) dailyInFlight = null;
    });

  dailyInFlight = { shiftStartMs, promise };
  return promise;
}
