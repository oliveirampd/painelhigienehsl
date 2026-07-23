import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const LISTO_BASE = "https://api.listo360.com.br/api/backoffice";
const ESTABLISHMENT_ID = 1;

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

async function login(): Promise<string> {
  const res = await fetch(`${LISTO_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.LISTO360_EMAIL,
      password: process.env.LISTO360_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Login Listo360 falhou: ${res.status}`);
  const data = await res.json() as { token?: string; accessToken?: string };
  const token = data.token || data.accessToken;
  if (!token) throw new Error("Login Listo360 sem token");
  return token;
}

async function fetchAnswers(token: string): Promise<ListoAnswer[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const all: ListoAnswer[] = [];
  const pageSize = 500;
  for (let page = 1; page <= 50; page++) {
    const url = `${LISTO_BASE}/answer/all-answers?establishmentId=${ESTABLISHMENT_ID}&pageSize=${pageSize}&pageNumber=${page}&startDate=${fmt(start)}&endDate=${fmt(end)}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`all-answers p${page} ${res.status}`);
    const body = await res.json() as ListoAnswer[] | { data?: ListoAnswer[] };
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export const Route = createFileRoute("/api/public/hooks/sync-listo360")({
  server: {
    handlers: {
      GET: () => handle(),
      POST: () => handle(),
    },
  },
});

async function handle() {
  try {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const token = await login();
    const answers = await fetchAnswers(token);

    const bedAnswers = answers.filter(isTerminalBed);
    const dismantleAnswers = answers.filter(isDismantleBed);
    const relevant = [...bedAnswers, ...dismantleAnswers];

    // 1) upsert staff (unique per userName) — inclui quem está em desmontagem
    const staffNames = Array.from(new Set(
      relevant.map((a) => (a.userName || "").trim()).filter(Boolean),
    ));

    if (staffNames.length) {
      const staffRows = staffNames.map((name) => ({
        external_id: `listo:user:${name}`,
        name,
        status: "available" as const,
      }));
      await supabase.from("staff").upsert(staffRows, {
        onConflict: "external_id",
        ignoreDuplicates: true,
      });
    }

    const { data: staffAll } = await supabase
      .from("staff")
      .select("id, external_id, name");
    const staffByName = new Map<string, string>();
    for (const s of staffAll ?? []) {
      if (s.name) staffByName.set(s.name, s.id);
    }

    // 2) upsert discharges (terminal + desmontagem, distinguíveis pelo external_id)
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
        const bedKey = (a.locationName || `leito-${a.id}`).trim().toLowerCase();
        const prev = byBed.get(bedKey);
        if (!prev || refTime(a) > refTime(prev)) {
          byBed.set(bedKey, a);
        }
      }
      return Array.from(byBed.values());
    }

    const bedAnswersDedup = dedupByBed(bedAnswers);
    const dismantleAnswersDedup = dedupByBed(dismantleAnswers);

    // Estado atual no banco, pra manter o horário estável quando o status não muda
    // entre sincronizações (importante pro "A Caminho"/"Altas Paradas", que não têm
    // um campo de horário confiável vindo do Listo).
    // IMPORTANTE: o Supabase só devolve até 1000 linhas por consulta por padrão —
    // sem paginar aqui, registros além dos primeiros 1000 "somem" da nossa visão,
    // fazendo o horário resetar à toa e a limpeza de órfãos apagar coisa demais.
    async function fetchAllDischarges() {
      const pageSize = 1000;
      let from = 0;
      const all: { external_id: string; status: string; status_updated_at: string }[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("discharges")
          .select("external_id, status, status_updated_at")
          .like("external_id", "listo:%")
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
    const existingByExternalId = new Map(
      existingDischarges.map((d) => [d.external_id, d]),
    );

    const NO_RELIABLE_TIMESTAMP: DischargeStatus[] = ["en_route", "waiting_cleaning"];

    // Limites de "travado" por status — depois disso, vira "completed" sozinho e some
    // do painel/control, sem precisar de ninguém clicar em nada. Não é o Listo que
    // fecha o registro, é só o nosso painel que para de mostrar.
    const STALE_LIMIT_MIN: Partial<Record<DischargeStatus, number>> = {
      in_progress: 4 * 60,       // Em Limpeza Terminal: 4h
      en_route: 40,               // A Caminho: 40min
      waiting_cleaning: 20 * 60,  // Altas Paradas: 20h
      paused: 4 * 24 * 60,        // Leitos Pausados: 4 dias
    };

    const buildRow = (a: ListoAnswer, kind: "answer" | "desmont") => {
      const rawStatus = mapStatus(a);
      const assigned = a.userName ? staffByName.get(a.userName.trim()) ?? null : null;
      const bed = (a.locationName || `Leito ${a.id}`).trim();
      const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
      const bedSlug = bed.toLowerCase().replace(/\s+/g, "-");
      const externalId = `listo:${kind}:bed:${bedSlug}`;

      let statusUpdatedAt: string;
      let debugInfo: string | null = null;

      const prevRow = existingByExternalId.get(externalId);

      // Já tinha sido concluído por estagnação (auto-conclusão) — não reviver só
      // porque o Listo ainda mostra o mesmo estado antigo de sempre. Isso evita o
      // ciclo "conclui -> Listo ainda mostra igual -> reseta relógio -> desfaz a
      // conclusão -> conclui de novo depois -> repete pra sempre".
      if (prevRow && prevRow.status === "completed" && NO_RELIABLE_TIMESTAMP.includes(rawStatus)) {
        return {
          external_id: externalId,
          bed_number: bed,
          unit,
          status: "completed" as DischargeStatus,
          priority: !!a.isPriority,
          pause_reason: extractComment(a.answerComment),
          assigned_staff_id: assigned,
          status_updated_at: prevRow.status_updated_at,
          _debug: "mantido concluido (ja tinha sido auto-concluido antes)",
        };
      }

      if (NO_RELIABLE_TIMESTAMP.includes(rawStatus)) {
        const prev = prevRow;
        if (prev && prev.status === rawStatus) {
          statusUpdatedAt = prev.status_updated_at;
          debugInfo = `mantido (prev status=${prev.status})`;
        } else {
          statusUpdatedAt = new Date().toISOString();
          debugInfo = prev
            ? `resetado (prev status=${prev.status} != novo=${rawStatus})`
            : "resetado (nenhum registro anterior encontrado)";
        }
      } else {
        const ref = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date();
        statusUpdatedAt = ref.toISOString();
      }

      // Registro travado (parado além do limite pra esse status) -> conclui sozinho
      const ageMin = (Date.now() - new Date(statusUpdatedAt).getTime()) / 60000;
      const limit = STALE_LIMIT_MIN[rawStatus];
      const status: DischargeStatus =
        limit !== undefined && ageMin >= limit ? "completed" : rawStatus;
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
        _debug: debugInfo,
      };
    };

    const dischargeRowsWithDebug = [
      ...bedAnswersDedup.map((a) => buildRow(a, "answer")),
      ...dismantleAnswersDedup.map((a) => buildRow(a, "desmont")),
    ];

    const dischargeRows = dischargeRowsWithDebug.map(({ _debug, ...row }) => row);

    if (dischargeRows.length) {
      const { error } = await supabase
        .from("discharges")
        .upsert(dischargeRows, { onConflict: "external_id" });
      if (error) throw error;
    }

    // Limpa registros órfãos: leitos que não vieram mais nesta sincronização
    // (inclui registros antigos, de antes da deduplicação, com external_id por id).
    const freshIds = new Set(dischargeRows.map((d) => d.external_id));
    const staleIds = (existingDischarges ?? [])
      .map((d) => d.external_id as string)
      .filter((id) => !freshIds.has(id));
    if (staleIds.length) {
      await supabase.from("discharges").delete().in("external_id", staleIds);
    }

    // 3) recompute staff status server-side (fallback — /tv também deriva ao vivo)
    const activeIds = new Set(
      dischargeRows
        .filter((d) => d.status === "in_progress")
        .map((d) => d.assigned_staff_id)
        .filter(Boolean) as string[],
    );

    if (staffAll) {
      const toAssign = staffAll.filter((s) => activeIds.has(s.id)).map((s) => s.id);
      const toFree = staffAll.filter((s) => !activeIds.has(s.id) && s.external_id?.startsWith("listo:user:")).map((s) => s.id);
      if (toAssign.length) {
        await supabase.from("staff").update({ status: "assigned" }).in("id", toAssign);
      }
      if (toFree.length) {
        await supabase.from("staff").update({ status: "available" }).in("id", toFree).eq("status", "assigned");
      }
    }

    const debugSample = dischargeRowsWithDebug
      .filter((d) => d._debug)
      .slice(0, 8)
      .map((d) => ({ external_id: d.external_id, status: d.status, _debug: d._debug }));

    return Response.json({
      ok: true,
      answers: answers.length,
      terminal: bedAnswersDedup.length,
      terminal_bruto: bedAnswers.length,
      desmontagem: dismantleAnswersDedup.length,
      staff: staffNames.length,
      removidos_orfaos: staleIds.length,
      debug_estabilidade_horario: debugSample,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[sync-listo360]", err);
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
