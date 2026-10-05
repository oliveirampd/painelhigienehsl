import { TERMINAL_GERAL_AREAS } from "@/lib/terminalGeralAreas";

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

type ListoAnswer = {
  id: number;
  sectorName: string | null;
  sectorDescription: string | null;
  locationName: string | null;
  routeName: string | null;
  inspectionName: string | null;
  userName: string | null;
  answerComment: { comment?: string | null } | string | null;
  startTime: string | null;
  endTime: string | null;
  date: string | null;
  statusAnswer: { id: number; name?: string | null; displayName?: string | null } | null;
};

export type AnalyticsDay = {
  date: string;
  total: number;
  completed: number;
  avgWaitMin: number | null;
  avgExecutionMin: number | null;
  withinTargetPct: number | null;
};

export type AnalyticsBlock = {
  block: string;
  total: number;
  completed: number;
  avgWaitMin: number | null;
  avgExecutionMin: number | null;
  withinTargetPct: number | null;
};

export type ShiftSummary = {
  label: string;
  start: string;
  end: string;
  total: number;
  completed: number;
  avgWaitMin: number | null;
  avgExecutionMin: number | null;
  withinTargetPct: number | null;
  peakHour: number | null;
  peakCount: number;
};

export type GeneralAreaTrend = {
  area: string;
  unit: string;
  completed7d: number;
  activeDays: number;
  lastCompletedAt: string | null;
};

type TerminalCycle = {
  key: string;
  bed: string;
  unit: string;
  block: string;
  detectedAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  staff: string | null;
  targetMin: number;
};

export type OperationsAnalytics = {
  generatedAt: string;
  days: AnalyticsDay[];
  blocks: AnalyticsBlock[];
  hourly: Array<{ hour: number; count: number }>;
  weekdayHour: Array<{ weekday: number; hour: number; count: number }>;
  peakHour: number | null;
  peakCount: number;
  currentShift: ShiftSummary;
  previousShift: ShiftSummary;
  forecast: Array<{ hour: number; expected: number }>;
  generalAreas: GeneralAreaTrend[];
  totalSample: number;
  rawTerminalRecords: number;
  samplePartial: boolean;
};

export type DischargeTimeline = {
  answerId: number;
  bed: string;
  unit: string;
  staff: string | null;
  detectedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  reason: string | null;
};

let analyticsCache: { expiresAt: number; value: OperationsAnalytics } | null = null;
let answersCache: {
  expiresAt: number;
  startMs: number;
  rows: ListoAnswer[];
  partial: boolean;
} | null = null;

function parseBRT(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const d = new Date(hasTz ? value : `${value}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function brtParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function extractComment(c: ListoAnswer["answerComment"]): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.comment ?? null;
}

function isTerminalBed(a: ListoAnswer): boolean {
  const location = (a.locationName || "").toLowerCase();
  if (!location.startsWith("leito")) return false;
  const route = (a.routeName || "").toLowerCase();
  const inspection = (a.inspectionName || "").toLowerCase();
  if (route.includes("desmontagem") || inspection.includes("desmontagem")) return false;
  return route.includes("limpeza terminal") || inspection.includes("terminal");
}

function isTerminalGeneral(a: ListoAnswer): boolean {
  const location = (a.locationName || "").trim().toLowerCase();
  if (!location || location.startsWith("leito")) return false;
  const route = (a.routeName || "").toLowerCase();
  const inspection = (a.inspectionName || "").toLowerCase();
  return route.includes("terminal geral") || inspection.includes("terminal geral");
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function blockOf(a: ListoAnswer): string {
  const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ");
  return unit.toUpperCase().match(/BLOCO\s+([A-Z])/)?.[1] ?? "Outro";
}

function bedCode(a: ListoAnswer): string {
  return (a.locationName || "").match(/\d+/)?.[0]?.replace(/^0+/, "") || "";
}

function targetMinutes(a: ListoAnswer): number {
  const block = blockOf(a);
  const suites = new Set([
    "1852","1752","1652","1552","1452","1260","1160","1060","960","860","760",
    "1855","1755","1655","1555","1455","1261","1161","1061","961","861","761",
    "1264","1164","1064","964","864","764","1267","1167","1067","967","884","784",
    "877","777","878","778",
  ]);
  const bed = bedCode(a);
  if (block === "C") return 50;
  if (block === "B") return 45;
  if (block === "D" || block === "E") return suites.has(bed) ? 135 : 75;
  return 75;
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * O endpoint all-answers pode devolver várias linhas para a mesma execução no
 * mesmo leito. Para gestão, uma "alta" só vira um ciclo mensurável quando há
 * startTime. A identidade do ciclo é leito + minuto de início registrado pelo
 * Listo; linhas duplicadas desse mesmo ciclo são consolidadas.
 */
function buildTerminalCycles(rows: ListoAnswer[]): TerminalCycle[] {
  const grouped = new Map<string, TerminalCycle>();

  for (const a of rows) {
    if (!isTerminalBed(a)) continue;
    const startedAt = parseBRT(a.startTime);
    if (!startedAt) continue;

    const bed = (a.locationName || `Leito ${a.id}`).trim();
    const startMinute = Math.floor(startedAt.getTime() / 60000);
    const key = `${normalizeKey(bed)}|${startMinute}`;
    const detectedAt = parseBRT(a.date);
    const completedAt = parseBRT(a.endTime);
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const staff = a.userName?.trim() || null;

    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        key,
        bed,
        unit,
        block: blockOf(a),
        detectedAt,
        startedAt,
        completedAt,
        staff,
        targetMin: targetMinutes(a),
      });
      continue;
    }

    current.detectedAt = minDate(current.detectedAt, detectedAt);
    current.completedAt = maxDate(current.completedAt, completedAt);
    if (!current.staff && staff) current.staff = staff;
    if (current.unit === "—" && unit !== "—") current.unit = unit;
  }

  return Array.from(grouped.values()).sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );
}

function summarizeCycles(
  cycles: TerminalCycle[],
  window: { label: string; start: Date; end: Date },
): ShiftSummary {
  const selected = cycles.filter(
    (cycle) => cycle.startedAt >= window.start && cycle.startedAt < window.end,
  );
  const completed = selected.filter((cycle) => !!cycle.completedAt);
  const execution = completed.map((cycle) =>
    validDiffMinutes(cycle.startedAt, cycle.completedAt, 6),
  );
  const waits = selected.map((cycle) =>
    validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12),
  );
  const within = completed.filter((cycle) => {
    const duration = validDiffMinutes(cycle.startedAt, cycle.completedAt, 6);
    return duration != null && duration <= cycle.targetMin;
  }).length;

  const hourCounts = new Map<number, number>();
  for (const cycle of selected) {
    const h = brtParts(cycle.startedAt).hour;
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }
  let peakHour: number | null = null;
  let peakCount = 0;
  for (const [hour, count] of hourCounts) {
    if (count > peakCount) {
      peakHour = hour;
      peakCount = count;
    }
  }

  return {
    label: window.label,
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    total: selected.length,
    completed: completed.length,
    avgWaitMin: avg(waits),
    avgExecutionMin: avg(execution),
    withinTargetPct: pct(within, completed.length),
    peakHour,
    peakCount,
  };
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

async function fetchAnswers(days: number): Promise<{ rows: ListoAnswer[]; partial: boolean }> {
  const startMs = Date.now() - days * DAY_MS;
  if (answersCache && answersCache.expiresAt > Date.now() && answersCache.startMs <= startMs) {
    return { rows: answersCache.rows, partial: answersCache.partial };
  }

  const token = await login();
  const nowMs = Date.now();
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const pageSize = 500;
  // 8 dias x no máximo 6 páginas = 48 subrequests (+ login), mantendo a coleta
  // abaixo de limites comuns de Workers e distribuindo a amostra entre os dias.
  const maxPagesPerWindow = 6;
  const byId = new Map<number, ListoAnswer>();
  let partial = false;

  for (let windowIndex = 0; windowIndex < days; windowIndex++) {
    const windowEndMs = nowMs - windowIndex * DAY_MS;
    const windowStartMs = Math.max(startMs, windowEndMs - DAY_MS);
    const start = new Date(windowStartMs);
    const end = new Date(windowEndMs);
    let reachedCap = false;

    for (let page = 1; page <= maxPagesPerWindow; page++) {
      const url = `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}&pageSize=${pageSize}&pageNumber=${page}&startDate=${fmt(start)}&endDate=${fmt(end)}`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error("Falha ao consultar histórico operacional");
      const body = (await res.json()) as ListoAnswer[] | { data?: ListoAnswer[] };
      const pageRows = Array.isArray(body) ? body : body.data ?? [];
      for (const row of pageRows) byId.set(row.id, row);
      if (pageRows.length < pageSize) {
        reachedCap = false;
        break;
      }
      reachedCap = page === maxPagesPerWindow;
    }
    if (reachedCap) partial = true;
  }

  const rows = Array.from(byId.values());
  answersCache = {
    expiresAt: Date.now() + 3 * 60 * 1000,
    startMs,
    rows,
    partial,
  };
  return { rows, partial };
}

function validDiffMinutes(start: Date | null, end: Date | null, maxHours = 12): number | null {
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diff < 0 || diff > maxHours * 60) return null;
  return diff;
}

function avg(values: Array<number | null>): number | null {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!clean.length) return null;
  return Math.round(clean.reduce((a, b) => a + b, 0) / clean.length);
}

function pct(done: number, total: number): number | null {
  return total ? Math.round((done / total) * 100) : null;
}

function shiftWindow(nowMs: number, offset = 0): { label: string; start: Date; end: Date } {
  const wall = new Date(nowMs - 3 * 60 * 60 * 1000);
  const min = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  let startHour = 22;
  let startMinute = 0;
  let label = "Noite";
  let dayOffset = min < 6 * 60 + 20 ? -1 : 0;
  let lengthMin = 8 * 60 + 20;

  if (min >= 6 * 60 + 20 && min < 13 * 60 + 40) {
    startHour = 6; startMinute = 20; label = "Manhã"; dayOffset = 0; lengthMin = 7 * 60 + 20;
  } else if (min >= 13 * 60 + 40 && min < 22 * 60) {
    startHour = 13; startMinute = 40; label = "Tarde"; dayOffset = 0; lengthMin = 8 * 60 + 20;
  }

  const startWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + dayOffset,
    startHour,
    startMinute,
  );
  let start = new Date(startWall + 3 * 60 * 60 * 1000);
  let end = new Date(start.getTime() + lengthMin * 60 * 1000);

  if (offset < 0) {
    for (let i = 0; i > offset; i--) {
      const prevEnd = start;
      const probe = new Date(start.getTime() - 60 * 1000);
      const p = shiftWindow(probe.getTime(), 0);
      start = p.start;
      end = prevEnd;
      label = p.label;
    }
  }
  return { label, start, end };
}

export async function loadOperationsAnalytics(): Promise<OperationsAnalytics> {
  if (analyticsCache && analyticsCache.expiresAt > Date.now()) return analyticsCache.value;
  const history = await fetchAnswers(8);
  const raw = history.rows;
  const rawTerminal = raw.filter(isTerminalBed);
  const now = new Date();
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
  const cycles = buildTerminalCycles(rawTerminal).filter(
    (cycle) => cycle.startedAt.getTime() >= sevenDaysAgo,
  );

  const dateKeys: string[] = [];
  for (let i = 6; i >= 0; i--) dateKeys.push(brtParts(new Date(now.getTime() - i * DAY_MS)).date);

  const days: AnalyticsDay[] = dateKeys.map((date) => {
    const selected = cycles.filter((cycle) => brtParts(cycle.startedAt).date === date);
    const completed = selected.filter((cycle) => !!cycle.completedAt);
    const within = completed.filter((cycle) => {
      const duration = validDiffMinutes(cycle.startedAt, cycle.completedAt, 6);
      return duration != null && duration <= cycle.targetMin;
    }).length;
    return {
      date,
      total: selected.length,
      completed: completed.length,
      avgWaitMin: avg(selected.map((cycle) => validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12))),
      avgExecutionMin: avg(completed.map((cycle) => validDiffMinutes(cycle.startedAt, cycle.completedAt, 6))),
      withinTargetPct: pct(within, completed.length),
    };
  });

  const blockMap = new Map<string, TerminalCycle[]>();
  for (const cycle of cycles) {
    const list = blockMap.get(cycle.block) ?? [];
    list.push(cycle);
    blockMap.set(cycle.block, list);
  }
  const blocks: AnalyticsBlock[] = Array.from(blockMap.entries())
    .map(([block, selected]) => {
      const completed = selected.filter((cycle) => !!cycle.completedAt);
      const within = completed.filter((cycle) => {
        const duration = validDiffMinutes(cycle.startedAt, cycle.completedAt, 6);
        return duration != null && duration <= cycle.targetMin;
      }).length;
      return {
        block,
        total: selected.length,
        completed: completed.length,
        avgWaitMin: avg(selected.map((cycle) => validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12))),
        avgExecutionMin: avg(completed.map((cycle) => validDiffMinutes(cycle.startedAt, cycle.completedAt, 6))),
        withinTargetPct: pct(within, completed.length),
      };
    })
    .sort((a, b) => b.total - a.total);

  const hourCounts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const weekdayMap = new Map<string, number>();
  for (const cycle of cycles) {
    const p = brtParts(cycle.startedAt);
    hourCounts[p.hour].count += 1;
    const key = `${p.weekday}|${p.hour}`;
    weekdayMap.set(key, (weekdayMap.get(key) ?? 0) + 1);
  }
  const weekdayHour = Array.from({ length: 7 * 24 }, (_, i) => {
    const weekday = Math.floor(i / 24);
    const hour = i % 24;
    return { weekday, hour, count: weekdayMap.get(`${weekday}|${hour}`) ?? 0 };
  });
  const peak = hourCounts.reduce((best, h) => (h.count > best.count ? h : best), hourCounts[0]);

  const distinctDates = Math.max(
    1,
    new Set(cycles.map((cycle) => brtParts(cycle.startedAt).date)).size,
  );
  const currentHour = brtParts(now).hour;
  const forecast = [1, 2, 3].map((ahead) => {
    const hour = (currentHour + ahead) % 24;
    const historical = hourCounts[hour]?.count ?? 0;
    return { hour, expected: Math.round((historical / distinctDates) * 10) / 10 };
  });

  const generalHistory = raw.filter(isTerminalGeneral);
  const generalMap = new Map<
    string,
    { area: string; unit: string; completed7d: number; days: Set<string>; lastCompletedAt: string | null }
  >();
  const seenGeneralCycles = new Set<string>();
  for (const seed of TERMINAL_GERAL_AREAS) {
    const key = `${normalizeKey(seed.unit)}|${normalizeKey(seed.area)}`;
    generalMap.set(key, {
      area: seed.area,
      unit: seed.unit,
      completed7d: 0,
      days: new Set<string>(),
      lastCompletedAt: null,
    });
  }
  for (const a of generalHistory) {
    const area = (a.locationName || "").trim();
    if (!area) continue;
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const key = `${normalizeKey(unit)}|${normalizeKey(area)}`;
    const cur = generalMap.get(key) ?? {
      area,
      unit,
      completed7d: 0,
      days: new Set<string>(),
      lastCompletedAt: null,
    };
    const start = parseBRT(a.startTime);
    const end = parseBRT(a.endTime);
    if (end) {
      const anchor = start ?? end;
      const cycleKey = `${key}|${Math.floor(anchor.getTime() / 60000)}`;
      if (!seenGeneralCycles.has(cycleKey)) {
        seenGeneralCycles.add(cycleKey);
        cur.completed7d += 1;
        cur.days.add(brtParts(end).date);
      }
      if (!cur.lastCompletedAt || end > new Date(cur.lastCompletedAt)) {
        cur.lastCompletedAt = end.toISOString();
      }
    }
    generalMap.set(key, cur);
  }
  const generalAreas: GeneralAreaTrend[] = Array.from(generalMap.values())
    .map((x) => ({
      area: x.area,
      unit: x.unit,
      completed7d: x.completed7d,
      activeDays: x.days.size,
      lastCompletedAt: x.lastCompletedAt,
    }))
    .sort((a, b) => a.completed7d - b.completed7d || a.activeDays - b.activeDays || a.area.localeCompare(b.area));

  const value: OperationsAnalytics = {
    generatedAt: new Date().toISOString(),
    days,
    blocks,
    hourly: hourCounts,
    weekdayHour,
    peakHour: peak.count ? peak.hour : null,
    peakCount: peak.count,
    currentShift: summarizeCycles(cycles, shiftWindow(Date.now(), 0)),
    previousShift: summarizeCycles(cycles, shiftWindow(Date.now(), -1)),
    forecast,
    generalAreas,
    totalSample: cycles.length,
    rawTerminalRecords: rawTerminal.length,
    samplePartial: history.partial,
  };
  analyticsCache = { expiresAt: Date.now() + 5 * 60 * 1000, value };
  return value;
}

export async function loadDischargeTimeline(answerId: number): Promise<DischargeTimeline | null> {
  const history = await fetchAnswers(2);
  const a = history.rows.find((row) => row.id === answerId && isTerminalBed(row));
  if (!a) return null;
  const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
  const status =
    a.endTime ? "Concluída" : a.startTime ? "Em execução" : a.userName ? "A caminho" : "Aguardando";
  return {
    answerId: a.id,
    bed: a.locationName || `Leito ${a.id}`,
    unit,
    staff: a.userName?.trim() || null,
    detectedAt: parseBRT(a.date)?.toISOString() ?? null,
    startedAt: parseBRT(a.startTime)?.toISOString() ?? null,
    completedAt: parseBRT(a.endTime)?.toISOString() ?? null,
    status,
    reason: extractComment(a.answerComment),
  };
}
