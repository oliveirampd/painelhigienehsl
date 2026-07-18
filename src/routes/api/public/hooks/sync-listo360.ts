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
  for (let page = 1; page <= 6; page++) {
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
    const buildRow = (a: ListoAnswer, kind: "answer" | "desmont") => {
      const status = mapStatus(a);
      const assigned = a.userName ? staffByName.get(a.userName.trim()) ?? null : null;
      const bed = (a.locationName || `Leito ${a.id}`).trim();
      const unit = [a.sectorName, a.sectorDescription].filter(Boolean).join(" · ") || "—";
      const ref = parseBRT(a.endTime) ?? parseBRT(a.startTime) ?? parseBRT(a.date) ?? new Date();
      const statusUpdatedAt = ref.toISOString();
      return {
        external_id: `listo:${kind}:${a.id}`,
        bed_number: bed,
        unit,
        status,
        priority: !!a.isPriority,
        pause_reason: extractComment(a.answerComment),
        assigned_staff_id: assigned,
        status_updated_at: statusUpdatedAt,
      };
    };

    const dischargeRows = [
      ...bedAnswers.map((a) => buildRow(a, "answer")),
      ...dismantleAnswers.map((a) => buildRow(a, "desmont")),
    ];

    if (dischargeRows.length) {
      const { error } = await supabase
        .from("discharges")
        .upsert(dischargeRows, { onConflict: "external_id" });
      if (error) throw error;
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

    return Response.json({
      ok: true,
      answers: answers.length,
      terminal: bedAnswers.length,
      desmontagem: dismantleAnswers.length,
      staff: staffNames.length,
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
