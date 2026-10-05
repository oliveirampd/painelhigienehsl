import { isExcludedUnit } from "@/lib/operationalScope";
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
  waitSamples: number;
  executionSamples: number;
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
  answerIds: number[];
  kind: "alta" | "desmontagem";
};

export type AnalyticsCycleRow = {
  key: string;
  bed: string;
  unit: string;
  block: string;
  staff: string | null;
  startedAt: string;
  completedAt: string | null;
  waitMin: number | null;
  executionMin: number | null;
  answerIds: number[];
};

export type StaffProductivity = {
  name: string;
  altas: number;
  completed: number;
  dismantles: number;
  dismantlesCompleted: number;
  avgExecutionMin: number | null;
  medianExecutionMin: number | null;
  executionSamples: number;
  avgDismantleMin: number | null;
  dismantleSamples: number;
  avgRegistrationMin: number | null;
  registrationSamples: number;
  withinTargetPct: number | null;
  activeDays: number;
  lastActivity: string;
};

export type OperationsAnalytics = {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  excludedRecords: number;
  staffProductivity: StaffProductivity[];
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
  staffActivity: Array<AnalyticsCycleRow & { kind: "alta" | "desmontagem" }>;
  totalSample: number;
  rawTerminalRecords: number;
  recentCycles: AnalyticsCycleRow[];
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
  previous: AnalyticsCycleRow[];
  samplePartial: boolean;
};

let analyticsCache: { expiresAt: number; value: OperationsAnalytics } | null = null;
let answersCache: {
  expiresAt: number;
  startMs: number;
  rows: ListoAnswer[];
  partial: boolean;
  fetchedAt: string;
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
  return typeof c === "string" ? c : (c.comment ?? null);
}

function isTerminalBed(a: ListoAnswer): boolean {
  if (isExcludedUnit([a.sectorName, a.sectorDescription].filter(Boolean).join(" · "))) return false;
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
    "1852",
    "1752",
    "1652",
    "1552",
    "1452",
    "1260",
    "1160",
    "1060",
    "960",
    "860",
    "760",
    "1855",
    "1755",
    "1655",
    "1555",
    "1455",
    "1261",
    "1161",
    "1061",
    "961",
    "861",
    "761",
    "1264",
    "1164",
    "1064",
    "964",
    "864",
    "764",
    "1267",
    "1167",
    "1067",
    "967",
    "884",
    "784",
    "877",
    "777",
    "878",
    "778",
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
function isDismantleBed(a: ListoAnswer): boolean {
  return (
    !isExcludedUnit([a.sectorName, a.sectorDescription].filter(Boolean).join(" · ")) &&
    (a.locationName || "").toLowerCase().startsWith("leito") &&
    /desmontagem/i.test(`${a.routeName} ${a.inspectionName}`)
  );
}

function confirmedEnd(a: ListoAnswer, start: Date): Date | null {
  if ([4, 5, 7].includes(a.statusAnswer?.id ?? 0)) return null;
  const end = parseBRT(a.endTime);
  return end && end >= start && end.getTime() <= Date.now() ? end : null;
}

export function buildTerminalCycles(
  rows: ListoAnswer[],
  kind: "alta" | "desmontagem" = "alta",
): TerminalCycle[] {
  const grouped = new Map<string, TerminalCycle>();
  const blockedCompletion = new Set<string>();
  for (const a of rows) {
    if (!(kind === "alta" ? isTerminalBed(a) : isDismantleBed(a))) continue;
    const startedAt = parseBRT(a.startTime);
    if (!startedAt || startedAt.getTime() > Date.now()) continue;
    const bed = (a.locationName || "").trim();
    const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
    const key = `${kind}|${normalizeKey(unit)}|${normalizeKey(bed)}|${Math.floor(startedAt.getTime() / 60000)}`;
    const detectedAt = parseBRT(a.date);
    const completedAt = confirmedEnd(a, startedAt);
    const staff = a.userName?.trim() || null;
    if ([4, 5, 7].includes(a.statusAnswer?.id ?? 0)) blockedCompletion.add(key);
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
        answerIds: [a.id],
        kind,
      });
    } else {
      current.answerIds.push(a.id);
      current.detectedAt = minDate(current.detectedAt, detectedAt);
      current.completedAt = maxDate(current.completedAt, completedAt);
      // Different names in one execution must not be credited to an arbitrary employee.
      if (staff && current.staff && normalizeKey(staff) !== normalizeKey(current.staff))
        current.staff = "Atribuição divergente";
      else if (!current.staff && staff) current.staff = staff;
    }
  }
  for (const key of blockedCompletion) grouped.get(key)!.completedAt = null;
  return [...grouped.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

function cycleRow(cycle: TerminalCycle): AnalyticsCycleRow {
  return {
    key: cycle.key,
    bed: cycle.bed,
    unit: cycle.unit,
    block: cycle.block,
    staff: cycle.staff,
    startedAt: cycle.startedAt.toISOString(),
    completedAt: cycle.completedAt?.toISOString() ?? null,
    waitMin: validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12),
    executionMin: validDiffMinutes(cycle.startedAt, cycle.completedAt, 6),
    answerIds: cycle.answerIds,
  };
}

function staffSummary(cycles: TerminalCycle[]): StaffProductivity[] {
  const groups = new Map<string, TerminalCycle[]>();
  for (const cycle of cycles) {
    const key = normalizeKey(cycle.staff || "Sem colaborador informado");
    groups.set(key, [...(groups.get(key) ?? []), cycle]);
  }
  return [...groups.values()]
    .map((rows) => {
      const altas = rows.filter((x) => x.kind === "alta");
      const dismantles = rows.filter((x) => x.kind === "desmontagem");
      const execution = altas
        .map((x) => validDiffMinutes(x.startedAt, x.completedAt, 6))
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b);
      const dismantleTimes = dismantles.map((x) => validDiffMinutes(x.startedAt, x.completedAt, 6));
      const waits = altas.map((x) => validDiffMinutes(x.detectedAt, x.startedAt, 12));
      const within = altas.filter((x) => {
        const d = validDiffMinutes(x.startedAt, x.completedAt, 6);
        return d != null && d <= x.targetMin;
      }).length;
      const mid = Math.floor(execution.length / 2);
      return {
        name: rows[0].staff || "Sem colaborador informado",
        altas: altas.length,
        completed: altas.filter((x) => x.completedAt).length,
        dismantles: dismantles.length,
        dismantlesCompleted: dismantles.filter((x) => x.completedAt).length,
        avgExecutionMin: avg(execution),
        medianExecutionMin: execution.length
          ? (execution[mid] + execution[Math.floor((execution.length - 1) / 2)]) / 2
          : null,
        executionSamples: execution.length,
        avgDismantleMin: avg(dismantleTimes),
        dismantleSamples: dismantleTimes.filter((x) => x != null).length,
        avgRegistrationMin: avg(waits),
        registrationSamples: waits.filter((x) => x != null).length,
        withinTargetPct: pct(within, execution.length),
        activeDays: new Set(rows.map((x) => brtParts(x.startedAt).date)).size,
        lastActivity: new Date(
          Math.max(...rows.map((x) => (x.completedAt ?? x.startedAt).getTime())),
        ).toISOString(),
      };
    })
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

function summarizeCycles(
  cycles: TerminalCycle[],
  window: { label: string; start: Date; end: Date },
): ShiftSummary {
  const selected = cycles.filter(
    (cycle) => cycle.startedAt >= window.start && cycle.startedAt < window.end,
  );
  const completed = cycles.filter(
    (cycle) =>
      cycle.completedAt != null &&
      cycle.completedAt >= window.start &&
      cycle.completedAt < window.end,
  );
  const execution = completed.map((cycle) =>
    validDiffMinutes(cycle.startedAt, cycle.completedAt, 6),
  );
  const waits = selected.map((cycle) => validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12));
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
    withinTargetPct: pct(within, execution.filter((x) => x != null).length),
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

async function fetchAnswers(
  days: number,
): Promise<{ rows: ListoAnswer[]; partial: boolean; fetchedAt: string }> {
  const today = brtParts(new Date()).date;
  const startMs = new Date(`${today}T00:00:00-03:00`).getTime() - (days - 1) * DAY_MS;
  if (answersCache && answersCache.expiresAt > Date.now() && answersCache.startMs <= startMs) {
    return {
      rows: answersCache.rows,
      partial: answersCache.partial,
      fetchedAt: answersCache.fetchedAt,
    };
  }

  const token = await login();
  const nowMs = Date.now();
  const fmt = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const pageSize = 500;
  // Mantém folga ampla no limite de subrequests do Worker. Se uma janela diária
  // vier muito carregada, marcamos a amostra como parcial em vez de derrubar a tela.
  const maxPagesPerWindow = Math.min(3, Math.floor(35 / days));
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
      try {
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        });
        if (!res.ok) {
          partial = true;
          break;
        }
        const body = (await res.json()) as ListoAnswer[] | { data?: ListoAnswer[] };
        const pageRows = Array.isArray(body) ? body : (body.data ?? []);
        for (const row of pageRows) byId.set(row.id, row);
        if (pageRows.length < pageSize) {
          reachedCap = false;
          break;
        }
        reachedCap = page === maxPagesPerWindow;
      } catch {
        partial = true;
        break;
      }
    }
    if (reachedCap) partial = true;
  }

  const rows = Array.from(byId.values());
  if (rows.length === 0 && answersCache?.rows.length) {
    return { rows: answersCache.rows, partial: true, fetchedAt: answersCache.fetchedAt };
  }
  if (rows.length === 0) {
    throw new Error("Histórico operacional indisponível na origem");
  }
  answersCache = {
    expiresAt: Date.now() + 3 * 60 * 1000,
    startMs,
    rows,
    partial,
    fetchedAt: new Date(nowMs).toISOString(),
  };
  return { rows, partial, fetchedAt: answersCache.fetchedAt };
}

function validDiffMinutes(start: Date | null, end: Date | null, maxHours = 12): number | null {
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  if (end < start || end.getTime() - start.getTime() > maxHours * 3600000) return null;
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
    startHour = 6;
    startMinute = 20;
    label = "Manhã";
    dayOffset = 0;
    lengthMin = 7 * 60 + 20;
  } else if (min >= 13 * 60 + 40 && min < 22 * 60) {
    startHour = 13;
    startMinute = 40;
    label = "Tarde";
    dayOffset = 0;
    lengthMin = 8 * 60 + 20;
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
  const history = await fetchAnswers(7);
  const raw = history.rows;

  const now = new Date(history.fetchedAt);
  const sevenDaysAgo = new Date(`${brtParts(now).date}T00:00:00-03:00`).getTime() - 6 * DAY_MS;
  const inPeriod = (a: ListoAnswer) => {
    const anchor = parseBRT(a.startTime) ?? parseBRT(a.date);
    return anchor != null && anchor.getTime() >= sevenDaysAgo && anchor <= now;
  };
  const rawTerminal = raw.filter((a) => isTerminalBed(a) && inPeriod(a));
  const cycles = buildTerminalCycles(rawTerminal).filter(
    (cycle) => cycle.startedAt.getTime() >= sevenDaysAgo,
  );

  const dateKeys: string[] = [];
  for (let i = 6; i >= 0; i--) dateKeys.push(brtParts(new Date(now.getTime() - i * DAY_MS)).date);

  const days: AnalyticsDay[] = dateKeys.map((date) => {
    const selected = cycles.filter((cycle) => brtParts(cycle.startedAt).date === date);
    const completed = cycles.filter(
      (cycle) => cycle.completedAt != null && brtParts(cycle.completedAt).date === date,
    );
    const within = completed.filter((cycle) => {
      const duration = validDiffMinutes(cycle.startedAt, cycle.completedAt, 6);
      return duration != null && duration <= cycle.targetMin;
    }).length;
    return {
      date,
      total: selected.length,
      completed: completed.length,
      avgWaitMin: avg(
        selected.map((cycle) => validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12)),
      ),
      avgExecutionMin: avg(
        completed.map((cycle) => validDiffMinutes(cycle.startedAt, cycle.completedAt, 6)),
      ),
      withinTargetPct: pct(
        within,
        completed.filter((c) => validDiffMinutes(c.startedAt, c.completedAt, 6) != null).length,
      ),
      waitSamples: selected.filter((c) => validDiffMinutes(c.detectedAt, c.startedAt, 12) != null)
        .length,
      executionSamples: completed.filter(
        (c) => validDiffMinutes(c.startedAt, c.completedAt, 6) != null,
      ).length,
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
        avgWaitMin: avg(
          selected.map((cycle) => validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12)),
        ),
        avgExecutionMin: avg(
          completed.map((cycle) => validDiffMinutes(cycle.startedAt, cycle.completedAt, 6)),
        ),
        withinTargetPct: pct(
          within,
          completed.filter((c) => validDiffMinutes(c.startedAt, c.completedAt, 6) != null).length,
        ),
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
    return { hour, expected: Math.round((historical / dateKeys.length) * 10) / 10 };
  });

  const generalHistory = raw.filter(isTerminalGeneral);
  const generalMap = new Map<
    string,
    {
      area: string;
      unit: string;
      completed7d: number;
      days: Set<string>;
      lastCompletedAt: string | null;
    }
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
    .sort(
      (a, b) =>
        a.completed7d - b.completed7d ||
        a.activeDays - b.activeDays ||
        a.area.localeCompare(b.area),
    );

  const staffActivity = [
    ...cycles,
    ...buildTerminalCycles(raw, "desmontagem").filter((c) => c.startedAt.getTime() >= sevenDaysAgo),
  ];

  const recentCycles: AnalyticsCycleRow[] = cycles
    .slice()
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((cycle) => ({
      answerIds: cycle.answerIds,
      key: cycle.key,
      bed: cycle.bed,
      unit: cycle.unit,
      block: cycle.block,
      staff: cycle.staff,
      startedAt: cycle.startedAt.toISOString(),
      completedAt: cycle.completedAt?.toISOString() ?? null,
      waitMin: validDiffMinutes(cycle.detectedAt, cycle.startedAt, 12),
      executionMin: validDiffMinutes(cycle.startedAt, cycle.completedAt, 6),
    }));

  const value: OperationsAnalytics = {
    generatedAt: new Date().toISOString(),
    periodStart: new Date(sevenDaysAgo).toISOString(),
    periodEnd: now.toISOString(),
    excludedRecords: raw.filter(
      (a) =>
        inPeriod(a) &&
        isExcludedUnit([a.sectorName, a.sectorDescription].filter(Boolean).join(" · ")),
    ).length,
    staffProductivity: staffSummary(staffActivity),
    staffActivity: staffActivity.map((c) => ({ ...cycleRow(c), kind: c.kind })),
    days,
    blocks,
    hourly: hourCounts,
    weekdayHour,
    peakHour: peak.count ? peak.hour : null,
    peakCount: peak.count,
    currentShift: summarizeCycles(cycles, shiftWindow(now.getTime(), 0)),
    previousShift: summarizeCycles(cycles, shiftWindow(now.getTime(), -1)),
    forecast,
    generalAreas,
    totalSample: cycles.length,
    rawTerminalRecords: rawTerminal.length,
    recentCycles,
    samplePartial: history.partial,
  };
  analyticsCache = { expiresAt: Date.now() + 5 * 60 * 1000, value };
  return value;
}

export async function loadDischargeTimeline(answerId: number): Promise<DischargeTimeline | null> {
  const history = await fetchAnswers(30);
  const a = history.rows.find((row) => row.id === answerId && isTerminalBed(row));
  if (!a) return null;
  const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
  const status = [4, 7].includes(a.statusAnswer?.id ?? 0)
    ? "Pausada"
    : a.statusAnswer?.id === 5
      ? "Manutenção"
      : a.endTime
        ? "Concluída"
        : a.startTime
          ? "Em execução"
          : a.userName
            ? "A caminho"
            : "Aguardando";
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
    samplePartial: history.partial,
    previous: buildTerminalCycles(history.rows)
      .filter(
        (c) =>
          normalizeKey(c.bed) === normalizeKey(a.locationName || "") &&
          normalizeKey(c.unit) === normalizeKey(unit) &&
          !c.answerIds.includes(answerId) &&
          c.completedAt &&
          c.completedAt < (parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date()),
      )
      .sort((x, y) => y.completedAt!.getTime() - x.completedAt!.getTime())
      .slice(0, 3)
      .map(cycleRow),
  };
}
