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
  recordedAt: string;
};

export async function loadLastCompletedDischarge(
  unit: string,
  bedNumber: string,
): Promise<LastCompletedDischarge | null> {
  const { data, error } = await supabaseAdmin
    .from("last_completed_discharges")
    .select(
      "bed_number, unit, source_answer_id, staff_name, started_at, completed_at, duration_minutes, recorded_at",
    )
    .eq("bed_key", operationalBedKey(unit, bedNumber))
    .maybeSingle();

  if (error) {
    console.error("[loadLastCompletedDischarge]", error);
    throw new Error("Não foi possível consultar a última Alta deste leito.");
  }
  if (!data) return null;

  return {
    bedNumber: data.bed_number,
    unit: data.unit,
    sourceAnswerId: Number(data.source_answer_id),
    staffName: data.staff_name,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    durationMinutes: data.duration_minutes,
    recordedAt: data.recorded_at,
  };
}

