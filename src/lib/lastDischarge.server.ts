import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { operationalBedKey } from "@/lib/operationalScope";

export type LastCompletedDischarge = {
  bedNumber: string;
  unit: string;
  sourceAnswerId: number;
  staffName: string | null;
  startedAt: string | null;
  completedAt: string;
  durationMinutes: number | null;
};

export async function loadLastCompletedDischarge(
  unit: string,
  bedNumber: string,
): Promise<LastCompletedDischarge | null> {
  const { data, error } = await supabaseAdmin
    .from("discharges")
    .select("bed_number, unit, last_answer_id, assigned_staff_id, status_updated_at, completed_at")
    .eq("external_id", `snapshot:last-completed:${operationalBedKey(unit, bedNumber)}`)
    .maybeSingle();

  if (error) {
    console.error("[loadLastCompletedDischarge]", error);
    throw new Error("Não foi possível consultar a última Alta deste leito.");
  }
  if (!data?.completed_at || !data.last_answer_id) return null;

  let staffName: string | null = null;
  if (data.assigned_staff_id) {
    const { data: staff, error: staffError } = await supabaseAdmin
      .from("staff")
      .select("name")
      .eq("id", data.assigned_staff_id)
      .maybeSingle();
    if (staffError) console.error("[loadLastCompletedDischarge:staff]", staffError);
    staffName = staff?.name ?? null;
  }

  const startedAt = data.status_updated_at === data.completed_at ? null : data.status_updated_at;
  const durationMinutes = startedAt
    ? Math.max(
        0,
        Math.round((new Date(data.completed_at).getTime() - new Date(startedAt).getTime()) / 60000),
      )
    : null;

  return {
    bedNumber: data.bed_number,
    unit: data.unit,
    sourceAnswerId: data.last_answer_id,
    staffName,
    startedAt,
    completedAt: data.completed_at,
    durationMinutes,
  };
}

