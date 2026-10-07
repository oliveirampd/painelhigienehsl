import { HOSPITAL_BEDS, bedFloor } from "@/lib/beds";
import {
  ACTIVE_DAILY_BEDS,
  isDailyConcurrentEligibleBed,
} from "@/lib/dailyScope";

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  statusAnswer: { id: number; displayName?: string | null } | null;
};

export type DailyHistoryRecord = {
  key: string;
  bed: string;
  block: string;
  unit: string;
  kind: "concorrente" | "camareira";
  staff: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
};

export type DailyStaffProductivity = {
  name: string;
  concorrentes: number;
  camareiras: number;
  completed: number;
  avgDurationMin: number | null;
  medianDurationMin: number | null;
  avgConcurrentMin: number | null;
  avgCamareiraMin: number | null;
  durationSamples: number;
  activeDays: number;
  lastActivity: string;
};

export type DailyCoveragePoint = {
  label: string;
  offsetMin: number;
  currentConcurrentPct: number | null;
  historicalConcurrentPct: number | null;
  currentCamareiraPct: number | null;
  historicalCamareiraPct: number | null;
};

export type DailyShiftClosure = {
  key: string;
  date: string;
  label: string;
  start: string;
  end: string;
  concurrentDone: number;
  concurrentEligible: number;
  concurrentPct: number;
  camareiraApplicable: boolean;
  camareiraDone: number;
  camareiraEligible: number;
  camareiraPct: number | null;
  blocks: Array<{
    block: string;
    concurrentDone: number;
    concurrentEligible: number;
    concurrentPct: number;
    camareiraApplicable: boolean;
    camareiraDone: number;
    camareiraEligible: number;
    camareiraPct: number | null;
  }>;
};

export type DailyOperationsAnalytics = {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  samplePartial: boolean;
  rawRecords: number;
  uniqueRoutines: number;
  currentShiftLabel: string;
  currentShiftStart: string;
  currentShiftEnd: string;
  currentConcurrentPct: number;
  historicalConcurrentPct: number | null;
  currentCamareiraApplicable: boolean;
  currentCamareiraPct: number;
  historicalCamareiraPct: number | null;
  coverageTrend: DailyCoveragePoint[];
  staffProductivity: DailyStaffProductivity[];
  shiftClosures: DailyShiftClosure[];
};

type DailyRoutine = {
  key: string;
  answerIds: number[];
  bed: string;
  block: string;
  unit: string;
  kind: "concorrente" | "camareira";
  staff: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  anchorAt: Date;
};

let answersCache:
  | {
      expiresAt: number;
      startMs: number;
      rows: ListoAnswer[];
      partial: boolean;
      fetchedAt: string;
    }
  | null = null;

let analyticsCache:
  | { expiresAt: number; value: DailyOperationsAnalytics }
  | null = null;

function parseBRT(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const parsed = new Date(hasTz ? value : `${value}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function brtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function bedNumber(answer: ListoAnswer): string | null {
  const match = (answer.locationName || "").match(/^\s*leito\s*0*(\d+)/i);
  return match ? String(Number(match[1])) : null;
}

function kindOf(answer: ListoAnswer): "concorrente" | "camareira" | null {
  const route = (answer.routeName || "").toLowerCase();
  const inspection = (answer.inspectionName || "").toLowerCase();
  if (route.startsWith("rotina camareira") || inspection.startsWith("camareira"))
    return "camareira";
  if (route.startsWith("limpeza concorrente")) return "concorrente";
  return null;
}

function unitOf(answer: ListoAnswer): string {
  return [answer.sectorName, answer.sectorDescription].filter(Boolean).join(" · ") || "—";
}

function validEnd(answer: ListoAnswer, start: Date | null): Date | null {
  if ([4, 5, 7].includes(answer.statusAnswer?.id ?? 0)) return null;
  const end = parseBRT(answer.endTime);
  if (!end || end.getTime() > Date.now()) return null;
  if (start && end < start) return null;
  return end;
}

function validDuration(start: Date | null, end: Date | null): number | null {
  if (!start || !end || end < start) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes >= 0 && minutes <= 8 * 60 ? minutes : null;
}

function avg(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!clean.length) return null;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function median(values: Array<number | null>): number | null {
  const clean = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : Math.round((clean[middle - 1] + clean[middle]) / 2);
}

async function login(): Promise<string> {
  const response = await fetch(`${LISTO_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env["LISTO360_EMAIL"],
      password: process.env["LISTO360_PASSWORD"],
    }),
  });
  if (!response.ok) throw new Error("Falha ao autenticar na origem dos dados");
  const body = (await response.json()) as { token?: string; accessToken?: string };
  const token = body.token || body.accessToken;
  if (!token) throw new Error("Falha ao autenticar na origem dos dados");
  return token;
}

async function fetchAnswers(
  days: number,
): Promise<{ rows: ListoAnswer[]; partial: boolean; fetchedAt: string; startMs: number }> {
  const today = brtDate(new Date());
  const startMs = new Date(`${today}T00:00:00-03:00`).getTime() - (days - 1) * DAY_MS;
  if (answersCache && answersCache.expiresAt > Date.now() && answersCache.startMs <= startMs) {
    return {
      rows: answersCache.rows,
      partial: answersCache.partial,
      fetchedAt: answersCache.fetchedAt,
      startMs: answersCache.startMs,
    };
  }

  const token = await login();
  const nowMs = Date.now();
  const fmt = (date: Date) =>
    new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const pageSize = 500;
  const maxPagesPerWindow = Math.min(3, Math.max(1, Math.floor(35 / days)));
  const byId = new Map<number, ListoAnswer>();
  let partial = false;

  for (let windowIndex = 0; windowIndex < days; windowIndex++) {
    const windowEndMs = nowMs - windowIndex * DAY_MS;
    const windowStartMs = Math.max(startMs, windowEndMs - DAY_MS);
    let reachedCap = false;
    for (let page = 1; page <= maxPagesPerWindow; page++) {
      const url =
        `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}` +
        `&pageSize=${pageSize}&pageNumber=${page}` +
        `&startDate=${fmt(new Date(windowStartMs))}&endDate=${fmt(new Date(windowEndMs))}`;
      try {
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        });
        if (!response.ok) {
          partial = true;
          break;
        }
        const body = (await response.json()) as ListoAnswer[] | { data?: ListoAnswer[] };
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        for (const row of rows) byId.set(row.id, row);
        if (rows.length < pageSize) {
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

  const rows = [...byId.values()];
  if (!rows.length && answersCache?.rows.length) {
    return {
      rows: answersCache.rows,
      partial: true,
      fetchedAt: answersCache.fetchedAt,
      startMs: answersCache.startMs,
    };
  }
  if (!rows.length) throw new Error("Histórico da Higiene Diária indisponível na origem");

  answersCache = {
    expiresAt: Date.now() + 4 * 60 * 1000,
    startMs,
    rows,
    partial,
    fetchedAt: new Date(nowMs).toISOString(),
  };
  return { rows, partial, fetchedAt: answersCache.fetchedAt, startMs };
}

function buildRoutines(rows: ListoAnswer[]): DailyRoutine[] {
  const activeBeds = new Map(ACTIVE_DAILY_BEDS.map((bed) => [bed.n, bed]));
  const grouped = new Map<string, DailyRoutine>();

  for (const answer of rows) {
    const kind = kindOf(answer);
    if (!kind) continue;
    const bed = bedNumber(answer);
    if (!bed) continue;
    const bedRef = activeBeds.get(bed);
    if (!bedRef) continue;
    if (kind === "concorrente" && !isDailyConcurrentEligibleBed(bed, bedRef.b)) continue;

    const startedAt = parseBRT(answer.startTime);
    const completedAt = validEnd(answer, startedAt);
    const detectedAt = parseBRT(answer.date);
    const anchorAt = startedAt ?? completedAt ?? detectedAt;
    if (!anchorAt || anchorAt.getTime() > Date.now()) continue;

    const unit = unitOf(answer);
    const key =
      `${kind}|${bedRef.b}|${bed}|` +
      `${Math.floor(anchorAt.getTime() / 60000)}`;
    const staff = answer.userName?.trim() || null;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        key,
        answerIds: [answer.id],
        bed,
        block: bedRef.b,
        unit,
        kind,
        staff,
        startedAt,
        completedAt,
        anchorAt: startedAt ?? completedAt ?? anchorAt,
      });
      continue;
    }

    current.answerIds.push(answer.id);
    if (startedAt && (!current.startedAt || startedAt < current.startedAt)) current.startedAt = startedAt;
    if (completedAt && (!current.completedAt || completedAt > current.completedAt))
      current.completedAt = completedAt;
    current.anchorAt = current.startedAt ?? current.completedAt ?? current.anchorAt;
    if (staff && current.staff && normalize(staff) !== normalize(current.staff))
      current.staff = "Atribuição divergente";
    else if (!current.staff && staff) current.staff = staff;
  }

  return [...grouped.values()].sort((a, b) => a.anchorAt.getTime() - b.anchorAt.getTime());
}

function shiftWindow(instantMs: number): { label: string; start: Date; end: Date } {
  const wall = new Date(instantMs - 3 * 60 * 60 * 1000);
  const minutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  let label = "Noite";
  let startHour = 22;
  let startMinute = 0;
  let dayOffset = minutes < 6 * 60 + 20 ? -1 : 0;
  let durationMin = 8 * 60 + 20;

  if (minutes >= 6 * 60 + 20 && minutes < 13 * 60 + 40) {
    label = "Manhã";
    startHour = 6;
    startMinute = 20;
    dayOffset = 0;
    durationMin = 7 * 60 + 20;
  } else if (minutes >= 13 * 60 + 40 && minutes < 22 * 60) {
    label = "Tarde";
    startHour = 13;
    startMinute = 40;
    dayOffset = 0;
    durationMin = 8 * 60 + 20;
  }

  const wallStart = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + dayOffset,
    startHour,
    startMinute,
  );
  const start = new Date(wallStart + 3 * 60 * 60 * 1000);
  return { label, start, end: new Date(start.getTime() + durationMin * 60 * 1000) };
}

function previousShift(window: { start: Date }): { label: string; start: Date; end: Date } {
  return shiftWindow(window.start.getTime() - 60 * 1000);
}

function routinesInWindow(routines: DailyRoutine[], start: Date, end: Date): DailyRoutine[] {
  return routines.filter((routine) => routine.anchorAt >= start && routine.anchorAt < end);
}

function uniqueBedsUntil(
  routines: DailyRoutine[],
  kind: "concorrente" | "camareira",
  start: Date,
  point: Date,
  block?: string,
): number {
  const beds = new Set<string>();
  for (const routine of routines) {
    if (routine.kind !== kind || routine.anchorAt < start || routine.anchorAt > point) continue;
    if (block && routine.block !== block) continue;
    beds.add(routine.bed);
  }
  return beds.size;
}

function denominators(block?: string) {
  const beds = block ? ACTIVE_DAILY_BEDS.filter((bed) => bed.b === block) : ACTIVE_DAILY_BEDS;
  return {
    camareira: beds.length,
    concorrente: beds.filter((bed) => isDailyConcurrentEligibleBed(bed.n, bed.b)).length,
  };
}

function percent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

function windowCoverage(
  routines: DailyRoutine[],
  window: { start: Date; end: Date },
  point: Date = window.end,
  block?: string,
) {
  const denominator = denominators(block);
  const concurrentDone = uniqueBedsUntil(routines, "concorrente", window.start, point, block);
  const camareiraDone = uniqueBedsUntil(routines, "camareira", window.start, point, block);
  return {
    concurrentDone,
    concurrentEligible: denominator.concorrente,
    concurrentPct: percent(concurrentDone, denominator.concorrente),
    camareiraDone,
    camareiraEligible: denominator.camareira,
    camareiraPct: percent(camareiraDone, denominator.camareira),
  };
}

function historicalAtOffset(
  routines: DailyRoutine[],
  currentWindow: { start: Date; end: Date },
  offsetMin: number,
  kind: "concorrente" | "camareira",
): number | null {
  const denominator = denominators()[kind];
  const samples: number[] = [];
  for (let day = 1; day <= 6; day++) {
    const start = new Date(currentWindow.start.getTime() - day * DAY_MS);
    const end = new Date(currentWindow.end.getTime() - day * DAY_MS);
    const point = new Date(Math.min(end.getTime(), start.getTime() + offsetMin * 60 * 1000));
    const count = uniqueBedsUntil(routines, kind, start, point);
    samples.push(percent(count, denominator));
  }
  return samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null;
}

function staffSummary(routines: DailyRoutine[]): DailyStaffProductivity[] {
  const byStaff = new Map<string, DailyRoutine[]>();
  for (const routine of routines) {
    if (!routine.completedAt || !routine.staff || routine.staff === "Atribuição divergente") continue;
    const list = byStaff.get(routine.staff) ?? [];
    list.push(routine);
    byStaff.set(routine.staff, list);
  }

  return [...byStaff.entries()]
    .map(([name, items]) => {
      const durations = items.map((item) => validDuration(item.startedAt, item.completedAt));
      const concurrentDurations = items
        .filter((item) => item.kind === "concorrente")
        .map((item) => validDuration(item.startedAt, item.completedAt));
      const camareiraDurations = items
        .filter((item) => item.kind === "camareira")
        .map((item) => validDuration(item.startedAt, item.completedAt));
      const last = items.reduce(
        (latest, item) => (item.anchorAt > latest ? item.anchorAt : latest),
        items[0].anchorAt,
      );
      return {
        name,
        concorrentes: items.filter((item) => item.kind === "concorrente").length,
        camareiras: items.filter((item) => item.kind === "camareira").length,
        completed: items.length,
        avgDurationMin: avg(durations),
        medianDurationMin: median(durations),
        avgConcurrentMin: avg(concurrentDurations),
        avgCamareiraMin: avg(camareiraDurations),
        durationSamples: durations.filter((value) => value != null).length,
        activeDays: new Set(items.map((item) => brtDate(item.anchorAt))).size,
        lastActivity: last.toISOString(),
      };
    })
    .sort(
      (a, b) =>
        b.concorrentes + b.camareiras - (a.concorrentes + a.camareiras) ||
        a.name.localeCompare(b.name),
    );
}

function toHistoryRecord(routine: DailyRoutine): DailyHistoryRecord {
  return {
    key: routine.key,
    bed: routine.bed,
    block: routine.block,
    unit: routine.unit,
    kind: routine.kind,
    staff: routine.staff,
    startedAt: routine.startedAt?.toISOString() ?? null,
    completedAt: routine.completedAt?.toISOString() ?? null,
    durationMin: validDuration(routine.startedAt, routine.completedAt),
  };
}

export async function loadDailyBedHistory(bed: string): Promise<DailyHistoryRecord[]> {
  const history = await fetchAnswers(14);
  return buildRoutines(history.rows)
    .filter((routine) => routine.bed === String(Number(bed)) && !!routine.completedAt)
    .sort((a, b) => b.anchorAt.getTime() - a.anchorAt.getTime())
    .slice(0, 3)
    .map(toHistoryRecord);
}

export async function loadDailyOperationsAnalytics(): Promise<DailyOperationsAnalytics> {
  if (analyticsCache && analyticsCache.expiresAt > Date.now()) return analyticsCache.value;

  const history = await fetchAnswers(7);
  const routines = buildRoutines(history.rows);
  const now = new Date(history.fetchedAt);
  const currentWindow = shiftWindow(now.getTime());
  const currentPoint =
    now < currentWindow.end ? now : currentWindow.end;
  const durationMin = Math.round(
    (currentWindow.end.getTime() - currentWindow.start.getTime()) / 60000,
  );
  const elapsedMin = Math.max(
    0,
    Math.min(
      durationMin,
      Math.round((currentPoint.getTime() - currentWindow.start.getTime()) / 60000),
    ),
  );

  const offsets: number[] = [];
  for (let offset = 0; offset <= durationMin; offset += 60) offsets.push(offset);
  if (offsets[offsets.length - 1] !== durationMin) offsets.push(durationMin);

  const overallDenominator = denominators();
  const coverageTrend: DailyCoveragePoint[] = offsets.map((offsetMin) => {
    const point = new Date(currentWindow.start.getTime() + offsetMin * 60 * 1000);
    const visible = point <= currentPoint;
    return {
      label: point.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }),
      offsetMin,
      currentConcurrentPct: visible
        ? percent(
            uniqueBedsUntil(routines, "concorrente", currentWindow.start, point),
            overallDenominator.concorrente,
          )
        : null,
      historicalConcurrentPct: historicalAtOffset(
        routines,
        currentWindow,
        offsetMin,
        "concorrente",
      ),
      currentCamareiraPct: visible
        ? percent(
            uniqueBedsUntil(routines, "camareira", currentWindow.start, point),
            overallDenominator.camareira,
          )
        : null,
      historicalCamareiraPct: historicalAtOffset(
        routines,
        currentWindow,
        offsetMin,
        "camareira",
      ),
    };
  });

  const currentCoverage = windowCoverage(routines, currentWindow, currentPoint);
  const historicalConcurrentPct = historicalAtOffset(
    routines,
    currentWindow,
    elapsedMin,
    "concorrente",
  );
  const currentCamareiraApplicable = currentWindow.label === "Tarde";
  const historicalCamareiraPct = currentCamareiraApplicable
    ? historicalAtOffset(routines, currentWindow, elapsedMin, "camareira")
    : null;

  const shiftClosures: DailyShiftClosure[] = [];
  let cursor = previousShift(currentWindow);
  for (let index = 0; index < 6; index++) {
    const coverage = windowCoverage(routines, cursor);
    const camareiraApplicable = cursor.label === "Tarde";
    const blocks = ["D", "E", "C", "B"]
      .map((block) => {
        const blockCoverage = windowCoverage(routines, cursor, cursor.end, block);
        return {
          block,
          concurrentDone: blockCoverage.concurrentDone,
          concurrentEligible: blockCoverage.concurrentEligible,
          concurrentPct: blockCoverage.concurrentPct,
          camareiraApplicable,
          camareiraDone: camareiraApplicable ? blockCoverage.camareiraDone : 0,
          camareiraEligible: camareiraApplicable ? blockCoverage.camareiraEligible : 0,
          camareiraPct: camareiraApplicable ? blockCoverage.camareiraPct : null,
        };
      })
      .filter((block) => block.concurrentEligible > 0 || block.camareiraEligible > 0);

    shiftClosures.push({
      key: `${cursor.label}|${cursor.start.toISOString()}`,
      date: brtDate(cursor.start),
      label: cursor.label,
      start: cursor.start.toISOString(),
      end: cursor.end.toISOString(),
      concurrentDone: coverage.concurrentDone,
      concurrentEligible: coverage.concurrentEligible,
      concurrentPct: coverage.concurrentPct,
      camareiraApplicable,
      camareiraDone: camareiraApplicable ? coverage.camareiraDone : 0,
      camareiraEligible: camareiraApplicable ? coverage.camareiraEligible : 0,
      camareiraPct: camareiraApplicable ? coverage.camareiraPct : null,
      blocks,
    });
    cursor = previousShift(cursor);
  }

  const relevantRoutines = routines.filter(
    (routine) => routine.anchorAt.getTime() >= history.startMs && routine.anchorAt <= now,
  );

  const value: DailyOperationsAnalytics = {
    generatedAt: new Date().toISOString(),
    periodStart: new Date(history.startMs).toISOString(),
    periodEnd: now.toISOString(),
    samplePartial: history.partial,
    rawRecords: history.rows.filter((answer) => kindOf(answer) != null).length,
    uniqueRoutines: relevantRoutines.length,
    currentShiftLabel: currentWindow.label,
    currentShiftStart: currentWindow.start.toISOString(),
    currentShiftEnd: currentWindow.end.toISOString(),
    currentConcurrentPct: currentCoverage.concurrentPct,
    historicalConcurrentPct,
    currentCamareiraApplicable,
    currentCamareiraPct: currentCoverage.camareiraPct,
    historicalCamareiraPct,
    coverageTrend,
    staffProductivity: staffSummary(relevantRoutines),
    shiftClosures,
  };

  analyticsCache = { expiresAt: Date.now() + 5 * 60 * 1000, value };
  return value;
}
