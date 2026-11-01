import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  isTerminalBoxLocation,
  isTerminalBoxRoutine,
  isTerminalUtiBoxUnit,
  operationalBedKey,
} from "@/lib/operationalScope";
import {
  computeSyncBackoffMs,
  isSuspiciousPartialResponse,
  parseMissingSyncState,
  removeMissingSyncIds,
  updateMissingSyncState,
} from "@/lib/listoSyncSafety";

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const LISTO_REQUEST_BUDGET_MS = 25 * 1000;
const SYNC_LOCK_LEASE_MS = 50 * 1000;
const EPOCH_ISO = new Date(0).toISOString();

let tokenCache: { token: string; expiresAt: number } | null = null;

class ListoHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ListoHttpError";
    this.status = status;
  }
}

type SyncRuntimeState = {
  key: string;
  lock_until: string;
  backoff_until: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_duration_ms: number | null;
  last_answers_count: number | null;
  last_relevant_count: number | null;
  last_pages: number | null;
  consecutive_failures: number;
  last_error: string | null;
  missing_external_ids: unknown;
  updated_at: string;
};

type ListoAnswer = {
  id: number;
  sectorName: string | null;
  sectorDescription: string | null;
  locationName: string | null;
  routeName: string | null;
  inspectionName: string | null;
  userName: string | null;
  isPriority: boolean;
  answerComment: { comment?: string | null } | string | null;
  startTime: string | null;
  endTime: string | null;
  date: string | null;
  statusAnswer: { id: number; name: string } | null;
};

type DischargeStatus =
  | "waiting_cleaning"
  | "en_route"
  | "in_progress"
  | "paused"
  | "maintenance"
  | "completed"
  | "completed_with_issues";

// Listo devolve datas em horário local de Brasília (UTC-3) sem timezone.
// Normaliza para ISO com offset -03:00 para que o painel calcule o tempo real.
function parseBRT(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const iso = hasTz ? s : `${s}-03:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// Em "Altas Paradas", a primeira consulta não é necessariamente o horário da
// saída do paciente. Quando o Listo fornece um registro com hora explícita,
// podemos usar esse marco mais antigo, sem inventar uma alta no instante do cron.
// Datas sem hora ou com meia-noite artificial não são marcos confiáveis.
function pendingRecordedAt(a: ListoAnswer, nowMs: number): Date | null {
  const raw = a.date?.trim().replace(" ", "T");
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return null;
  const parsed = parseBRT(raw);
  if (!parsed) return null;
  const time = parsed.getTime();
  if (time > nowMs + 60_000 || time < nowMs - 24 * 60 * 60_000) return null;
  // Um dia cadastrado como 00:00:00 não prova que o paciente saiu à meia-noite.
  if (/T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(raw)) return null;
  return parsed;
}

function mapStatus(a: ListoAnswer): DischargeStatus {
  const id = a.statusAnswer?.id;
  const hasEnd = !!a.endTime;
  const hasStart = !!a.startTime;
  const hasUser = !!(a.userName && a.userName.trim());

  // "Pendente" no Listo (id 4 ou 7): vira "Leitos Pausados" no /tv, independente de ter
  // endTime ou não — é o mesmo status "paused" nos dois casos agora.
  if (id === 4 || id === 7) return "paused";
  if (id === 5) return "maintenance";
  if (id === 3 || id === 6) return "completed";
  if (id === 2) return hasEnd ? "completed" : "in_progress";

  // Demais casos (ex: id 1) — deriva pelo estado real do processo, não pelo id:
  if (hasEnd) return "completed";
  if (hasStart) return "in_progress";
  if (hasUser) return "en_route"; // colaborador alocado, ainda não iniciou = a caminho
  return "waiting_cleaning"; // sem colaborador alocado ainda = Altas Paradas
}

function isBedLocation(a: ListoAnswer): boolean {
  return (a.locationName || "").toLowerCase().startsWith("leito");
}

function isTerminalBed(a: ListoAnswer): boolean {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  return isBedLocation(a) && (route.includes("limpeza terminal") || insp.includes("terminal"));
}

function isTerminalUtiBox(a: ListoAnswer): boolean {
  return (
    isTerminalBoxLocation(a.locationName) &&
    isTerminalBoxRoutine(a.routeName, a.inspectionName) &&
    isTerminalUtiBoxUnit(unitOf(a))
  );
}

function isDismantleBed(a: ListoAnswer): boolean {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  return isBedLocation(a) && (route.includes("desmontagem") || insp.includes("desmontagem"));
}

function extractComment(c: ListoAnswer["answerComment"]): string | null {
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.comment ?? null;
}

function unitOf(a: ListoAnswer): string {
  return [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  deadlineMs: number,
  label: string,
): Promise<Response> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw new Error(`Tempo limite do Listo excedido antes de ${label}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Tempo limite do Listo excedido em ${label}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function login(
  forceRefresh = false,
  deadlineMs = Date.now() + LISTO_REQUEST_BUDGET_MS,
): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  if (!process.env.LISTO360_EMAIL || !process.env.LISTO360_PASSWORD) {
    throw new Error("Credenciais Listo360 ausentes: configure LISTO360_EMAIL e LISTO360_PASSWORD nos segredos do Cloudflare");
  }

  const res = await fetchWithDeadline(
    `${LISTO_BASE}/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.LISTO360_EMAIL,
        password: process.env.LISTO360_PASSWORD,
      }),
    },
    deadlineMs,
    forceRefresh ? "login-refresh" : "login",
  );
  if (!res.ok) throw new ListoHttpError(`Login Listo360 falhou: ${res.status}`, res.status);
  const data = (await res.json()) as { token?: string; accessToken?: string };
  const token = data.token || data.accessToken;
  if (!token) throw new Error("Login Listo360 sem token");
  tokenCache = { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS };
  return token;
}

async function fetchAnswers(deadlineMs: number): Promise<{
  answers: ListoAnswer[];
  pages: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const all: ListoAnswer[] = [];
  const pageSize = 500;
  let pages = 0;
  let token = await login(false, deadlineMs);

  for (let page = 1; page <= 50; page++) {
    const url = `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}&pageSize=${pageSize}&pageNumber=${page}&startDate=${fmt(start)}&endDate=${fmt(end)}`;
    let res = await fetchWithDeadline(
      url,
      { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
      deadlineMs,
      `answers-page-${page}`,
    );

    if (res.status === 401 || res.status === 403) {
      token = await login(true, deadlineMs);
      res = await fetchWithDeadline(
        url,
        { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
        deadlineMs,
        `answers-page-${page}-retry`,
      );
    }

    if (!res.ok) throw new ListoHttpError(`all-answers p${page} ${res.status}`, res.status);
    const body = (await res.json()) as ListoAnswer[] | { data?: ListoAnswer[] };
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    pages = page;
    all.push(...rows);
    if (rows.length < pageSize) break;
    // Evita persistir/limpar leitos com uma resposta truncada do Listo.
    if (page === 50) throw new Error("Listo360 excedeu o limite seguro de paginação");
  }

  return { answers: all, pages, durationMs: Date.now() - startedAt };
}

export const Route = createFileRoute("/api/public/hooks/sync-listo360")({
  server: {
    handlers: {
      GET: ({ request }) => forwardListo360Sync(request),
      POST: ({ request }) => forwardListo360Sync(request),
    },
  },
});

type TerminalSyncNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

async function forwardListo360Sync(request: Request): Promise<Response> {
  const namespace = (cloudflareEnv as unknown as { TERMINAL_SYNC_DO?: TerminalSyncNamespace })
    .TERMINAL_SYNC_DO;

  if (!namespace) {
    console.error("[sync-listo360] TERMINAL_SYNC_DO binding ausente");
    return Response.json(
      { ok: false, error: "Executor de sincronização indisponível" },
      { status: 503 },
    );
  }

  const id = namespace.idFromName("listo360");
  return namespace.get(id).fetch(request);
}

export async function handleListo360Sync(request: Request) {
  // Pode ser habilitado sem mudar a URL do cron. Configure a mesma chave no
  // agendador e no Cloudflare (X-Cron-Secret). Sem a chave, mantém compatibilidade.
  const cronSecret = process.env.SYNC_CRON_SECRET;
  if (cronSecret) {
    const supplied = request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (supplied !== cronSecret) {
      return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }
  }

  const syncStartedAt = Date.now();
  let supabase: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"] | null = null;
  let runtimeState: SyncRuntimeState | null = null;
  let lockAcquired = false;

  try {
    // O cliente admin central adapta os cabeçalhos tanto para a chave JWT
    // service_role quanto para a nova sb_secret_ (não usa Bearer com chave opaca).
    ({ supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server"));

    const nowIso = new Date(syncStartedAt).toISOString();
    const stateResult = await supabase
      .from("sync_runtime_state")
      .select("*")
      .eq("key", "listo360")
      .single();
    if (stateResult.error) throw stateResult.error;
    runtimeState = stateResult.data as SyncRuntimeState;

    const backoffUntilMs = new Date(runtimeState.backoff_until).getTime();
    if (Number.isFinite(backoffUntilMs) && backoffUntilMs > syncStartedAt) {
      const retryAfterSeconds = Math.ceil((backoffUntilMs - syncStartedAt) / 1000);
      console.warn("[sync-listo360]", {
        skipped: true,
        reason: "backoff",
        retryAfterSeconds,
      });
      return Response.json({
        ok: true,
        skipped: true,
        reason: "backoff",
        retry_after_s: retryAfterSeconds,
      });
    }

    const lockUntil = new Date(syncStartedAt + SYNC_LOCK_LEASE_MS).toISOString();
    const lockResult = await supabase
      .from("sync_runtime_state")
      .update({
        lock_until: lockUntil,
        last_started_at: nowIso,
        updated_at: nowIso,
      })
      .eq("key", "listo360")
      .lte("lock_until", nowIso)
      .select("*")
      .maybeSingle();
    if (lockResult.error) throw lockResult.error;
    if (!lockResult.data) {
      console.warn("[sync-listo360]", { skipped: true, reason: "sync_in_progress" });
      return Response.json({ ok: true, skipped: true, reason: "sync_in_progress" });
    }

    runtimeState = lockResult.data as SyncRuntimeState;
    lockAcquired = true;

    const deadlineMs = Date.now() + LISTO_REQUEST_BUDGET_MS;
    const source = await fetchAnswers(deadlineMs);
    const answers = source.answers;

    const bedAnswers = answers.filter(isTerminalBed);
    const boxAnswers = answers.filter(isTerminalUtiBox);
    const dismantleAnswers = answers.filter(isDismantleBed);
    const relevant = [...bedAnswers, ...boxAnswers, ...dismantleAnswers];

    // 1) upsert staff (unique per userName) — inclui quem está em desmontagem
    const staffNames = Array.from(
      new Set(relevant.map((a) => (a.userName || "").trim()).filter(Boolean)),
    );

    // Lê o estado antes de escrever. Inserir a mesma equipe a cada minuto
    // ainda passa pelo banco e, dependendo da operação, gera carga desnecessária.
    const initialStaff = await supabase
      .from("staff")
      .select("id, external_id, name, status");
    if (initialStaff.error) throw initialStaff.error;
    let staffAll = initialStaff.data ?? [];

    // Reset diário do Time Altas, apenas se houver registros a remover.
    const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000);
    if (nowBRT.getUTCHours() === 0 && nowBRT.getUTCMinutes() < 5 &&
        staffAll.some((s) => s.external_id?.startsWith("painel:staff:"))) {
      const reset = await supabase.from("staff")
        .delete().like("external_id", "painel:staff:%");
      if (reset.error) throw reset.error;
      staffAll = staffAll.filter((s) => !s.external_id?.startsWith("painel:staff:"));
    }

    const knownStaffIds = new Set(staffAll.map((s) => s.external_id));
    const newStaffRows = staffNames
      .map((name) => ({
        external_id: `listo:user:${name}`,
        name,
        status: "available" as const,
      }))
      .filter((row) => !knownStaffIds.has(row.external_id));
    if (newStaffRows.length) {
      const inserted = await supabase.from("staff").upsert(newStaffRows, {
        onConflict: "external_id",
        ignoreDuplicates: true,
      });
      if (inserted.error) throw inserted.error;
      // Recarrega os IDs reais apenas quando houve nomes novos.
      const refreshed = await supabase
        .from("staff")
        .select("id, external_id, name, status");
      if (refreshed.error) throw refreshed.error;
      staffAll = refreshed.data ?? [];
    }

    const staffByName = new Map<string, string>();
    for (const s of staffAll) {
      if (s.name) staffByName.set(s.name, s.id);
    }

    // 2) upsert discharges (terminal de leito + box UTI + desmontagem, distinguíveis pelo external_id)
    //    Dedup por leito: o Listo pode gerar várias respostas pro mesmo leito no mesmo
    //    dia — sem isso, um leito pode aparecer em "A Caminho" E "Em Limpeza" ao mesmo
    //    tempo, um contradizendo o outro. Só a resposta mais recente por leito importa.
    const refTime = (a: ListoAnswer): number => {
      const d = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date);
      return d ? d.getTime() : a.id;
    };

    function dedupByBed(list: ListoAnswer[]): ListoAnswer[] {
      const byBed = new Map<string, ListoAnswer>();
      for (const a of list) {
        const bedKey = operationalBedKey(unitOf(a), a.locationName || `leito-${a.id}`);
        const prev = byBed.get(bedKey);
        if (!prev || refTime(a) > refTime(prev)) {
          byBed.set(bedKey, a);
        }
      }
      return Array.from(byBed.values());
    }

    const bedAnswersDedup = dedupByBed(bedAnswers);
    const boxAnswersDedup = dedupByBed(boxAnswers);
    const dismantleAnswersDedup = dedupByBed(dismantleAnswers);

    // Estado atual no banco, pra manter o horário estável quando o status não muda
    // entre sincronizações (importante pro "A Caminho"/"Altas Paradas", que não têm
    // um campo de horário confiável vindo do Listo).
    // Busca todos os campos que o sincronizador realmente pode alterar.
    // Paginação evita o limite padrão de 1000 linhas do Supabase.
    async function fetchAllDischarges() {
      const pageSize = 1000;
      let from = 0;
      const all: {
        external_id: string;
        bed_number: string;
        unit: string;
        status: DischargeStatus;
        priority: boolean;
        pause_reason: string | null;
        assigned_staff_id: string | null;
        status_updated_at: string;
        last_answer_id: number | null;
        completed_at: string | null;
      }[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("discharges")
          .select("external_id, bed_number, unit, status, priority, pause_reason, assigned_staff_id, status_updated_at, last_answer_id, completed_at")
          .like("external_id", "listo:%")
          .order("external_id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as typeof all));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    const existingDischarges = await fetchAllDischarges();
    const existingByExternalId = new Map(existingDischarges.map((d) => [d.external_id, d]));

    const NO_RELIABLE_TIMESTAMP: DischargeStatus[] = ["en_route", "waiting_cleaning"];

    // Limites de "travado" por status — depois disso, vira "completed" sozinho e some
    // do painel/control, sem precisar de ninguém clicar em nada. Não é o Listo que
    // fecha o registro, é só o nosso painel que para de mostrar.
    const STALE_LIMIT_MIN: Partial<Record<DischargeStatus, number>> = {
      in_progress: 4 * 60, // Em Limpeza Terminal: 4h
      en_route: 40, // A Caminho: 40min
      waiting_cleaning: 20 * 60, // Altas Paradas: 20h
      paused: 4 * 24 * 60, // Leitos Pausados: 4 dias
    };

    const buildRow = (a: ListoAnswer, kind: "answer" | "box" | "desmont") => {
      const rawStatus = mapStatus(a);
      const assigned = a.userName ? (staffByName.get(a.userName.trim()) ?? null) : null;
      const bed = (a.locationName || `Leito ${a.id}`).trim();
      const unit = unitOf(a);
      const externalId = `listo:${kind}:bed:${operationalBedKey(unit, bed)}`;

      let statusUpdatedAt: string;
      let debugInfo: string | null = null;

      const prevRow = existingByExternalId.get(externalId);

      // Só pra "Leitos Pausados": se já foi resolvido (manual via botão "concluir"
      // -> completed_with_issues, ou automático -> completed), só volta a
      // aparecer se o Listo mostrar um horário realmente mais novo — sem isso, a
      // mesma pendência antiga reaparecia toda hora mesmo já resolvida (o Listo
      // continua mandando a mesma resposta "pausada" de antes, sem novidade real).
      // As outras categorias (Em Limpeza, A Caminho, Altas Paradas) não têm essa
      // trava — funcionam do jeito simples de sempre.
      if (
        rawStatus === "paused" &&
        prevRow &&
        (prevRow.status === "completed" || prevRow.status === "completed_with_issues")
      ) {
        const ref = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date();
        const semNovidade = ref.getTime() <= new Date(prevRow.status_updated_at).getTime();
        if (semNovidade) {
          return {
            external_id: externalId,
            bed_number: bed,
            unit,
            // Preserva o status exato de antes — nunca "promove" um
            // completed_with_issues (resolução manual) pra completed (alta
            // real), senão volta a contar errado no contador de altas.
            status: prevRow.status as DischargeStatus,
            priority: !!a.isPriority,
            pause_reason: extractComment(a.answerComment),
            assigned_staff_id: assigned,
            status_updated_at: prevRow.status_updated_at,
            completed_at: prevRow.completed_at,
            last_answer_id: a.id,
            _debug: "mantido resolvido (Leitos Pausados sem novidade real do Listo)",
          };
        }
      }

      // Uma desmontagem antiga pode continuar aparecendo como "em andamento" no
      // Listo mesmo depois de encerrada pelo início da limpeza terminal. Se já
      // fechamos esse mesmo ciclo antes, não deixe a fonte antiga reabri-lo.
      if (
        kind === "desmont" &&
        rawStatus === "in_progress" &&
        prevRow?.status === "completed"
      ) {
        const sourceStart =
          parseBRT(a.startTime) ?? parseBRT(a.date) ?? parseBRT(a.endTime);
        const previousStart = parseBRT(prevRow.status_updated_at);
        const previousAnswerId =
          prevRow.last_answer_id == null ? null : Number(prevRow.last_answer_id);
        const hasNewerStart =
          !!sourceStart &&
          !!previousStart &&
          sourceStart.getTime() > previousStart.getTime();
        const hasNewerAnswer =
          previousAnswerId != null &&
          Number.isFinite(previousAnswerId) &&
          a.id > previousAnswerId;
        const isNewCycle = hasNewerStart || hasNewerAnswer;

        if (!isNewCycle) {
          return {
            external_id: externalId,
            bed_number: bed,
            unit,
            status: "completed" as DischargeStatus,
            priority: !!a.isPriority,
            pause_reason: extractComment(a.answerComment),
            assigned_staff_id: assigned ?? prevRow.assigned_staff_id,
            status_updated_at: prevRow.status_updated_at,
            completed_at: prevRow.completed_at,
            last_answer_id: a.id,
            _debug: "mantida desmontagem concluída (fonte antiga sem novo ciclo)",
          };
        }
      }

      if (NO_RELIABLE_TIMESTAMP.includes(rawStatus)) {
        const prev = prevRow;
        const detectedAt = new Date();
        const previousTime = prev?.status === rawStatus ? parseBRT(prev.status_updated_at) : null;
        // Para Alta Parada, aproveita um horário explícito anterior do Listo,
        // se existir. Em registros antigos, corrige também o horário que havia
        // sido iniciado tardiamente na primeira sincronização após a migração.
        const sourceTime = rawStatus === "waiting_cleaning"
          ? pendingRecordedAt(a, detectedAt.getTime())
          : null;
        const candidates = [previousTime, sourceTime].filter(
          (d): d is Date => !!d && Number.isFinite(d.getTime()),
        );
        const best = candidates.length
          ? new Date(Math.min(...candidates.map((d) => d.getTime())))
          : detectedAt;
        statusUpdatedAt = best.toISOString();
        debugInfo = sourceTime && best.getTime() === sourceTime.getTime()
          ? "registro do Listo (sem garantia de horário de saída do paciente)"
          : previousTime
            ? "mantido início anterior do status"
            : "primeira detecção pelo painel (alta sem horário confiável)";
      } else {
        // Para desmontagem, o painel precisa preservar o marco de INÍCIO mesmo
        // depois que a atividade termina. O fim continua em completed_at.
        const ref =
          kind === "desmont"
            ? parseBRT(a.startTime) ?? parseBRT(a.date) ?? parseBRT(a.endTime)
            : parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date);
        // Quando a origem não fornece nenhum marco, mantém o horário existente
        // enquanto o status não muda, para não regravar toda execução.
        statusUpdatedAt = (ref ??
          (prevRow?.status === rawStatus ? new Date(prevRow.status_updated_at) : new Date())
        ).toISOString();
      }

      // Registro travado (parado além do limite pra esse status) -> conclui sozinho
      const ageMin = (Date.now() - new Date(statusUpdatedAt).getTime()) / 60000;
      const limit = STALE_LIMIT_MIN[rawStatus];
      const status: DischargeStatus =
        limit !== undefined && ageMin >= limit ? "completed" : rawStatus;

      // Horário real da conclusão: usa endTime do Listo quando disponível.
      const completedAt: string | null =
        status === "completed"
          ? (
              parseBRT(a.endTime) ??
              parseBRT(a.startTime) ??
              parseBRT(a.date) ??
              (prevRow?.completed_at ? new Date(prevRow.completed_at) : new Date(statusUpdatedAt))
            ).toISOString()
          : null;

      if (status === "completed" && status !== rawStatus) {
        debugInfo = `auto-concluido (travado ha ${Math.round(ageMin / 60)}h, limite era ${Math.round((limit ?? 0) / 60)}h)`;
      }

      return {
        external_id: externalId,
        bed_number: bed,
        unit,
        status,
        priority: !!a.isPriority,
        pause_reason: extractComment(a.answerComment),
        assigned_staff_id: assigned,
        status_updated_at: statusUpdatedAt,
        completed_at: completedAt,
        last_answer_id: a.id,
        _debug: debugInfo,
      };
    };

    // Campo manual como service_order fica deliberadamente fora do payload.
    // Assim, uma edição feita durante o sync nunca pode ser sobrescrita por uma
    // cópia antiga lida no início da execução.
    const dischargeRowsWithDebugRaw = [
      ...bedAnswersDedup.map((a) => buildRow(a, "answer")),
      ...boxAnswersDedup.map((a) => buildRow(a, "box")),
      ...dismantleAnswersDedup.map((a) => buildRow(a, "desmont")),
    ];

    // A limpeza terminal é posterior à desmontagem no fluxo operacional.
    // Quando a terminal inicia ou conclui, encerra a desmontagem correspondente
    // mesmo que o Listo ainda devolva a resposta de desmontagem como "em andamento".
    const terminalProgressByBed = new Map<string, (typeof dischargeRowsWithDebugRaw)[number]>();
    for (const row of dischargeRowsWithDebugRaw) {
      const isTerminalRow =
        row.external_id.startsWith("listo:answer:") ||
        row.external_id.startsWith("listo:box:");
      if (!isTerminalRow || (row.status !== "in_progress" && row.status !== "completed")) {
        continue;
      }
      terminalProgressByBed.set(operationalBedKey(row.unit, row.bed_number), row);
    }

    const dischargeRowsWithDebug = dischargeRowsWithDebugRaw.map((row) => {
      if (!row.external_id.startsWith("listo:desmont:") || row.status !== "in_progress") {
        return row;
      }
      const terminal = terminalProgressByBed.get(operationalBedKey(row.unit, row.bed_number));
      if (!terminal) return row;

      const dismantleStartedMs = new Date(row.status_updated_at).getTime();
      const terminalMomentRaw =
        terminal.status === "completed"
          ? terminal.completed_at ?? terminal.status_updated_at
          : terminal.status_updated_at;
      const terminalMomentMs = new Date(terminalMomentRaw).getTime();
      const toleranceMs = 10 * 60 * 1000;
      if (
        !Number.isFinite(dismantleStartedMs) ||
        !Number.isFinite(terminalMomentMs) ||
        terminalMomentMs < dismantleStartedMs - toleranceMs
      ) {
        return row;
      }

      return {
        ...row,
        status: "completed" as DischargeStatus,
        completed_at: new Date(Math.max(dismantleStartedMs, terminalMomentMs)).toISOString(),
        _debug: "desmontagem encerrada pelo avanço da limpeza terminal",
      };
    });

    const dischargeRows = dischargeRowsWithDebug.map(({ _debug, ...row }) => row);

    // Realtime cobra mensagens para cada alteração publicada. Um upsert
    // idêntico não deve acontecer: além da banda, ele dispara eventos UPDATE.
    const sameTime = (oldValue: string | null, next: string | null) =>
      oldValue === next ||
      (!!oldValue && !!next && new Date(oldValue).getTime() === new Date(next).getTime());

    const changedRows = dischargeRows.filter((row) => {
      const prev = existingByExternalId.get(row.external_id);
      if (!prev) return true;
      return prev.bed_number !== row.bed_number ||
        prev.unit !== row.unit ||
        prev.status !== row.status ||
        prev.priority !== row.priority ||
        prev.pause_reason !== row.pause_reason ||
        prev.assigned_staff_id !== row.assigned_staff_id ||
        !sameTime(prev.status_updated_at, row.status_updated_at) ||
        !sameTime(prev.completed_at, row.completed_at) ||
        // O banco antigo armazena last_answer_id como TEXT, enquanto a API
        // Listo entrega número. Compare o valor normalizado, não o tipo JS.
        (prev.last_answer_id == null ? null : String(prev.last_answer_id)) !==
          (row.last_answer_id == null ? null : String(row.last_answer_id));
    });

    if (changedRows.length) {
      const { error } = await supabase
        .from("discharges")
        .upsert(changedRows, { onConflict: "external_id" });
      if (error) throw error;
    }

    // Mantém somente a última Alta realmente concluída de cada unidade + leito.
    // O snapshot usa uma linha reservada na tabela já existente. O volume máximo
    // é a quantidade de leitos distintos, não a quantidade histórica de Altas.
    let lastCompletedUpdated = 0;
    let lastCompletedError: string | null = null;
    try {
      const latestByBed = new Map<
        string,
        {
          external_id: string;
          unit: string;
          bed_number: string;
          last_answer_id: number;
          assigned_staff_id: string | null;
          status: "completed";
          priority: false;
          pause_reason: null;
          status_updated_at: string;
          completed_at: string;
        }
      >();

      for (const answer of bedAnswers) {
        if (mapStatus(answer) !== "completed") continue;
        const completedAt = parseBRT(answer.endTime);
        if (!completedAt || completedAt.getTime() > Date.now()) continue;

        const startedAt = parseBRT(answer.startTime);
        const bed = (answer.locationName || `Leito ${answer.id}`).trim();
        const unit = unitOf(answer);
        const bedKey = operationalBedKey(unit, bed);
        const candidate = {
          external_id: `snapshot:last-completed:${bedKey}`,
          unit,
          bed_number: bed,
          last_answer_id: answer.id,
          assigned_staff_id: answer.userName
            ? (staffByName.get(answer.userName.trim()) ?? null)
            : null,
          status: "completed" as const,
          priority: false as const,
          pause_reason: null,
          status_updated_at: (startedAt ?? completedAt).toISOString(),
          completed_at: completedAt.toISOString(),
        };
        const previous = latestByBed.get(bedKey);
        if (!previous || candidate.completed_at > previous.completed_at) {
          latestByBed.set(bedKey, candidate);
        }
      }

      if (latestByBed.size) {
        const { data: stored, error: storedError } = await supabase
          .from("discharges")
          .select("external_id, completed_at")
          .like("external_id", "snapshot:last-completed:%");
        if (storedError) throw storedError;

        const storedByBed = new Map(
          (stored ?? []).map((row) => [row.external_id, row.completed_at]),
        );
        const updates = Array.from(latestByBed.values()).filter((row) => {
          const storedCompletedAt = storedByBed.get(row.external_id);
          return !storedCompletedAt || row.completed_at > storedCompletedAt;
        });

        if (updates.length) {
          const { error: updateError } = await supabase
            .from("discharges")
            .upsert(updates, { onConflict: "external_id" });
          if (updateError) throw updateError;
          lastCompletedUpdated = updates.length;
        }
      }
    } catch (historyError) {
      // A TV continua sincronizando mesmo se o snapshot auxiliar estiver
      // temporariamente indisponível.
      lastCompletedError = (historyError as Error).message;
      console.error("[sync-listo360:last-completed]", historyError);
    }

    // Limpa registros órfãos com tolerância a respostas parciais.
    // Um item precisa faltar em 3 sincronizações e por pelo menos 90s antes de
    // ser removido. Se o volume relevante cair abruptamente, nem contabilizamos
    // a ausência naquela rodada.
    const freshIds = new Set(dischargeRows.map((d) => d.external_id));
    const staleIds = existingDischarges
      .map((d) => d.external_id)
      .filter((id) => !freshIds.has(id));
    const suspiciousPartial = isSuspiciousPartialResponse(
      relevant.length,
      runtimeState.last_relevant_count,
    );
    const previousMissing = parseMissingSyncState(runtimeState.missing_external_ids);
    const missingUpdate = updateMissingSyncState({
      previous: previousMissing,
      freshIds,
      staleIds,
      nowMs: Date.now(),
      allowMissIncrement: !suspiciousPartial,
    });
    let missingState = missingUpdate.next;
    const deleteIds = suspiciousPartial ? [] : missingUpdate.deleteIds;

    let removedCount = 0;
    for (let i = 0; i < deleteIds.length; i += 100) {
      const chunk = deleteIds.slice(i, i + 100);
      const removed = await supabase.from("discharges")
        .delete().in("external_id", chunk);
      if (removed.error) throw removed.error;
      removedCount += chunk.length;
    }
    if (deleteIds.length) {
      missingState = removeMissingSyncIds(missingState, deleteIds);
    }
    const cleanupSkipped = suspiciousPartial;

    // 3) recompute staff status server-side (fallback — /tv também deriva ao vivo)
    const activeIds = new Set(
      dischargeRows
        .filter((d) => d.status === "in_progress")
        .map((d) => d.assigned_staff_id)
        .filter(Boolean) as string[],
    );

    if (staffAll) {
      const toAssign = staffAll
        .filter((s) => activeIds.has(s.id) && s.status !== "assigned")
        .map((s) => s.id);
      const toFree = staffAll
        .filter((s) => !activeIds.has(s.id) &&
          s.external_id?.startsWith("listo:user:") && s.status === "assigned")
        .map((s) => s.id);
      if (toAssign.length) {
        const assigned = await supabase.from("staff")
          .update({ status: "assigned" }).in("id", toAssign)
          .neq("status", "assigned");
        if (assigned.error) throw assigned.error;
      }
      if (toFree.length) {
        const freed = await supabase.from("staff")
          .update({ status: "available" })
          .in("id", toFree).eq("status", "assigned");
        if (freed.error) throw freed.error;
      }
    }

    const debugSample = dischargeRowsWithDebug
      .filter((d) => d._debug)
      .slice(0, 8)
      .map((d) => ({ external_id: d.external_id, status: d.status, _debug: d._debug }));

    const finishedAt = Date.now();
    const durationMs = finishedAt - syncStartedAt;
    const finishedIso = new Date(finishedAt).toISOString();
    const stateUpdate = await supabase
      .from("sync_runtime_state")
      .update({
        lock_until: EPOCH_ISO,
        backoff_until: EPOCH_ISO,
        last_finished_at: finishedIso,
        last_success_at: finishedIso,
        last_duration_ms: durationMs,
        last_answers_count: answers.length,
        last_relevant_count: relevant.length,
        last_pages: source.pages,
        consecutive_failures: 0,
        last_error: null,
        missing_external_ids: missingState,
        updated_at: finishedIso,
      })
      .eq("key", "listo360");
    if (stateUpdate.error) throw stateUpdate.error;
    lockAcquired = false;

    console.info("[sync-listo360]", {
      ok: true,
      durationMs,
      listoDurationMs: source.durationMs,
      pages: source.pages,
      answers: answers.length,
      relevant: relevant.length,
      changedRows: changedRows.length,
      removedCount,
      suspiciousPartial,
    });

    return Response.json({
      ok: true,
      duration_ms: durationMs,
      listo_duration_ms: source.durationMs,
      listo_pages: source.pages,
      answers: answers.length,
      terminal: bedAnswersDedup.length,
      terminal_bruto: bedAnswers.length,
      boxes_uti: boxAnswersDedup.length,
      boxes_uti_bruto: boxAnswers.length,
      desmontagem: dismantleAnswersDedup.length,
      staff: staffNames.length,
      colaboradores_novos: newStaffRows.length,
      leitos_alterados: changedRows.length,
      leitos_inalterados: dischargeRows.length - changedRows.length,
      removidos_orfaos: removedCount,
      limpeza_pulada_resposta_suspeita: cleanupSkipped,
      ausencias_em_observacao: Object.keys(missingState).length,
      ultimas_altas_atualizadas: lastCompletedUpdated,
      erro_ultima_alta: lastCompletedError,
      debug_estabilidade_horario: debugSample,
      at: finishedIso,
    });
  } catch (err) {
    const error = err as Error;
    const httpStatus = err instanceof ListoHttpError ? err.status : null;
    const failures = (runtimeState?.consecutive_failures ?? 0) + 1;
    const backoffMs = computeSyncBackoffMs(failures, httpStatus);

    if (supabase && lockAcquired) {
      const finishedAt = Date.now();
      const finishedIso = new Date(finishedAt).toISOString();
      const release = await supabase
        .from("sync_runtime_state")
        .update({
          lock_until: EPOCH_ISO,
          backoff_until: new Date(finishedAt + backoffMs).toISOString(),
          last_finished_at: finishedIso,
          last_duration_ms: finishedAt - syncStartedAt,
          consecutive_failures: failures,
          last_error: error.message.slice(0, 1000),
          updated_at: finishedIso,
        })
        .eq("key", "listo360");
      if (release.error) {
        console.error("[sync-listo360:release-lock]", release.error);
      }
    }

    console.error("[sync-listo360]", {
      error: error.message,
      httpStatus,
      consecutiveFailures: failures,
      backoffMs,
      durationMs: Date.now() - syncStartedAt,
    });
    return Response.json(
      {
        ok: false,
        error: error.message,
        backoff_s: Math.ceil(backoffMs / 1000),
      },
      { status: 500 },
    );
  }
}

