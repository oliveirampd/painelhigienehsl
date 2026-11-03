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
 * A mesma cama pode receber diversas respostas no Listo no mesmo dia.
 * O ID da resposta identifica a ordem do registro, inclusive para altas
 * ainda sem startTime/endTime, cujo campo date pode conter só meia-noite.
 */
export function isNewerListoAnswer(
  candidate: { id: number },
  previous: { id: number },
): boolean {
  return candidate.id > previous.id;
}

/**
 * Uma resolução anterior não impede uma NOVA alta: um answer ID mais recente
 * da fonte é prova de um novo registro, mesmo se a limpeza ainda não iniciou.
 * Nunca reabrir pela mesma resposta.
 */
export function isNewListoCycleAnswer(
  sourceAnswerId: number,
  previousAnswerId: string | null,
): boolean {
  const prev = previousAnswerId == null ? NaN : Number(previousAnswerId);
  return Number.isFinite(sourceAnswerId) &&
    Number.isFinite(prev) &&
    sourceAnswerId > prev;
}


/** Estados operacionais que precisam espelhar a origem, não tombstones de conclusão. */
export const RECONCILABLE_ACTIVE_STATUSES = [
  "waiting_cleaning",
  "en_route",
  "in_progress",
  "paused",
  "maintenance",
] as const;

/**
 * A busca all-answers é limitada a 24h. Só a ausência de registros cujo
 * status atual nasceu DENTRO dessa janela pode ser tomada como evidência
 * de que saíram do Listo. Não excluir altas antigas sem consulta abrangente.
 */
export function activeRecordCoveredByLookback(
  status: string,
  statusUpdatedAt: string,
  nowMs: number,
  lookbackHours = 24,
): boolean {
  if (!(RECONCILABLE_ACTIVE_STATUSES as readonly string[]).includes(status)) {
    return false;
  }
  const time = Date.parse(statusUpdatedAt);
  // Margem de 2min na borda de 24h por diferenças de relógio/API.
  return Number.isFinite(time) &&
    time >= nowMs - lookbackHours * 60 * 60_000 + 120_000 &&
    time <= nowMs + 60_000;
}


/**
 * Evita travamento permanente da reconciliação quando a janela móvel de 24h
 * perde respostas antigas de higienização, mas a coleta total segue íntegra.
 *
 * O número de respostas RELEVANTES pode cair naturalmente por tipo de rota.
 * Só tratamos a queda como API incompleta se houver também queda importante
 * no total de respostas ou na paginação, além do caso sem nenhum registro
 * relevante (possível falha na filtragem do Listo).
 */
export function isSuspiciousListoCoverage({
  currentRelevant,
  previousRelevant,
  currentAnswers,
  previousAnswers,
  currentPages,
  previousPages,
}: {
  currentRelevant: number;
  previousRelevant: number | null | undefined;
  currentAnswers: number;
  previousAnswers: number | null | undefined;
  currentPages: number;
  previousPages: number | null | undefined;
}): boolean {
  if (currentRelevant === 0) return true;
  const relevantDropped = isSuspiciousPartialResponse(currentRelevant, previousRelevant);
  if (!relevantDropped) return false;
  const totalDropped = isSuspiciousPartialResponse(currentAnswers, previousAnswers);
  const pagesDropped = previousPages != null && previousPages >= 2 &&
    currentPages < Math.ceil(previousPages * 0.65);
  return totalDropped || pagesDropped;
}
