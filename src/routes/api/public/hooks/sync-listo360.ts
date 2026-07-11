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

function mapStatus(id?: number): DischargeStatus {
  switch (id) {
    case 1: return "waiting_cleaning";
    case 2: return "in_progress";
    case 4: return "completed_with_issues";
    case 5: return "maintenance";
    case 7: return "paused";
    case 3:
    case 6: return "completed";
    default: return "waiting_cleaning";
  }
}

// Filtra apenas rotinas de Limpeza Terminal de Leitos (ignora camareira, áreas comuns, etc.)
function isTerminalBed(a: ListoAnswer): boolean {
  const route = (a.routeName || "").toLowerCase();
  const insp = (a.inspectionName || "").toLowerCase();
  const loc = (a.locationName || "").toLowerCase();
  const isBed = loc.startsWith("leito");
  const isTerminal = route.includes("limpeza terminal") || insp.includes("terminal");
  return isBed && isTerminal;
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

    // 1) upsert staff (unique per userName)
    const staffNames = Array.from(new Set(
      answers.map((a) => (a.userName || "").trim()).filter(Boolean),
    ));

    if (staffNames.length) {
      const staffRows = staffNames.map((name) => ({
        external_id: `listo:user:${name}`,
        name,
        status: "available" as const,
      }));
      await supabase.from("staff").upsert(staffRows, {
        onConflict: "external_id",
        ignoreDuplicates: true, // do not overwrite manual status
      });
    }

    const { data: staffAll } = await supabase
      .from("staff")
      .select("id, external_id, name");
    const staffByName = new Map<string, string>();
    for (const s of staffAll ?? []) {
      if (s.name) staffByName.set(s.name, s.id);
    }

    // 2) upsert discharges
    const dischargeRows = answers.map((a) => {
      const status = mapStatus(a.statusAnswer?.id);
      const assigned = a.userName ? staffByName.get(a.userName.trim()) ?? null : null;
      // Número do leito vem de `locationName` (campo "Local" no Listo).
      const bed = (a.locationName || `Leito ${a.id}`).trim();
      const unit = (a.sectorName || a.routeName || "—").trim();
      const statusUpdatedAt = a.endTime || a.startTime || a.date || new Date().toISOString();
      return {
        external_id: `listo:answer:${a.id}`,
        bed_number: bed,
        unit,
        status,
        priority: !!a.isPriority,
        pause_reason: a.answerComment || null,
        assigned_staff_id: assigned,
        status_updated_at: statusUpdatedAt,
      };
    });

    if (dischargeRows.length) {
      const { error } = await supabase
        .from("discharges")
        .upsert(dischargeRows, { onConflict: "external_id" });
      if (error) throw error;
    }

    // 3) recompute staff status: assigned if has active discharge, else available
    const activeIds = new Set(
      dischargeRows
        .filter((d) => d.status === "in_progress" || d.status === "waiting_cleaning" || d.status === "en_route")
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
        // only reset if currently 'assigned' to avoid clobbering manual break statuses
        await supabase.from("staff").update({ status: "available" }).in("id", toFree).eq("status", "assigned");
      }
    }

    return Response.json({
      ok: true,
      answers: answers.length,
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
