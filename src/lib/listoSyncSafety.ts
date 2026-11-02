const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function formatListoDateBRT(date: Date): string {
  return new Date(date.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 19);
}

export type MissingSyncRecord = {
  count: number;
  firstMissingAt: string;
  lastMissingAt: string;
};

export type MissingSyncState = Record<string, MissingSyncRecord>;

export function parseMissingSyncState(value: unknown): MissingSyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed: MissingSyncState = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Partial<MissingSyncRecord>;
    if (
      typeof item.count !== "number" ||
      !Number.isFinite(item.count) ||
      item.count < 1 ||
      typeof item.firstMissingAt !== "string" ||
      typeof item.lastMissingAt !== "string"
    ) {
      continue;
    }
    parsed[key] = {
      count: Math.floor(item.count),
      firstMissingAt: item.firstMissingAt,
      lastMissingAt: item.lastMissingAt,
    };
  }
  return parsed;
}

export function isSuspiciousPartialResponse(
  currentRelevant: number,
  previousRelevant: number | null | undefined,
): boolean {
  if (currentRelevant === 0) return true;
  if (!previousRelevant || previousRelevant < 10) return false;
  return currentRelevant < Math.floor(previousRelevant * 0.65);
}

export function selectRelevantBaseline(
  currentRelevant: number,
  previousRelevant: number | null | undefined,
  suspiciousPartial: boolean,
): number {
  if (suspiciousPartial && previousRelevant && previousRelevant > 0) {
    return previousRelevant;
  }
  return currentRelevant;
}

export function updateMissingSyncState({
  previous,
  freshIds,
  staleIds,
  nowMs,
  allowMissIncrement,
  minMisses = 3,
  minAgeMs = 90_000,
}: {
  previous: MissingSyncState;
  freshIds: Set<string>;
  staleIds: string[];
  nowMs: number;
  allowMissIncrement: boolean;
  minMisses?: number;
  minAgeMs?: number;
}): { next: MissingSyncState; deleteIds: string[] } {
  const next: MissingSyncState = { ...previous };

  for (const id of freshIds) delete next[id];

  if (allowMissIncrement) {
    const nowIso = new Date(nowMs).toISOString();
    for (const id of staleIds) {
      const prev = next[id];
      next[id] = prev
        ? { ...prev, count: prev.count + 1, lastMissingAt: nowIso }
        : { count: 1, firstMissingAt: nowIso, lastMissingAt: nowIso };
    }
  }

  const deleteIds = staleIds.filter((id) => {
    const record = next[id];
    if (!record || record.count < minMisses) return false;
    const firstMissingMs = new Date(record.firstMissingAt).getTime();
    return Number.isFinite(firstMissingMs) && nowMs - firstMissingMs >= minAgeMs;
  });

  return { next, deleteIds };
}

export function removeMissingSyncIds(
  state: MissingSyncState,
  ids: Iterable<string>,
): MissingSyncState {
  const next = { ...state };
  for (const id of ids) delete next[id];
  return next;
}

export function computeSyncBackoffMs(
  consecutiveFailures: number,
  httpStatus?: number | null,
): number {
  if (httpStatus === 429) return 115_000;
  if (consecutiveFailures <= 1) return 55_000;
  if (consecutiveFailures === 2) return 115_000;
  return 235_000;
}
/** A resolução manual só pode ser reaberta por um início explícito posterior. */
export function hasProvenNewCycle(sourceStart: Date | null, resolvedAt: string): boolean {
  const resolvedMs = Date.parse(resolvedAt);
  return !!sourceStart && Number.isFinite(resolvedMs) && sourceStart.getTime() > resolvedMs;
}

/**
 * Reconhece um novo ciclo de alta mesmo antes do início da higienização.
 *
 * O Listo pode enviar uma nova resposta sem startTime (Alta Parada/A Caminho).
 * Para não ressuscitar uma resposta antiga já concluída, a reabertura nesses
 * casos exige simultaneamente um answer ID novo E a data/hora de registro
 * posterior à resolução do ciclo anterior. Datas vagas/futuras não servem.
 */
export function hasProvenNewCycleFromAnswer({
  sourceStart,
  sourceRecorded,
  previousResolvedAt,
  sourceAnswerId,
  previousAnswerId,
  nowMs,
}: {
  sourceStart: Date | null;
  sourceRecorded: Date | null;
  previousResolvedAt: string;
  sourceAnswerId: number;
  previousAnswerId: string | null;
  nowMs: number;
}): boolean {
  if (hasProvenNewCycle(sourceStart, previousResolvedAt)) return true;

  const prevMs = Date.parse(previousResolvedAt);
  const sourceMs = sourceRecorded?.getTime();
  const previousId = previousAnswerId == null ? NaN : Number(previousAnswerId);
  if (
    !Number.isFinite(prevMs) ||
    sourceMs == null ||
    !Number.isFinite(sourceMs) ||
    !Number.isFinite(previousId) ||
    !Number.isFinite(sourceAnswerId)
  ) return false;

  return (
    sourceAnswerId > previousId &&
    sourceMs > prevMs + 60_000 &&
    sourceMs >= nowMs - 24 * 60 * 60_000 &&
    sourceMs <= nowMs + 60_000
  );
}
