import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Discharge } from "@/lib/hospital";

export type ActiveDischarge = Pick<
  Discharge,
  "id" | "external_id" | "bed_number" | "unit" | "status"
>;

const ACTIVE_STATUSES = new Set<Discharge["status"]>(["waiting_cleaning", "in_progress"]);

function toActive(row: Discharge): ActiveDischarge {
  return {
    id: row.id,
    external_id: row.external_id,
    bed_number: row.bed_number,
    unit: row.unit,
    status: row.status,
  };
}

/**
 * Versão enxuta para a Diária: carrega só as altas que realmente interferem
 * no mapa e mantém essas linhas via Realtime, sem baixar histórico nem staff.
 */
export function useActiveDischarges() {
  const [discharges, setDischarges] = useState<ActiveDischarge[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadActive() {
      const { data } = await supabase
        .from("discharges")
        .select("id,external_id,bed_number,unit,status")
        .in("status", ["waiting_cleaning", "in_progress"]);

      if (mounted && data) setDischarges(data);
    }

    void loadActive();

    const channel = supabase
      .channel("daily-active-discharges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discharges" },
        (payload) => {
          const next = payload.new as Discharge | null;
          const old = payload.old as Partial<Discharge> | null;

          setDischarges((prev) => {
            if (payload.eventType === "DELETE") {
              return old?.id ? prev.filter((row) => row.id !== old.id) : prev;
            }
            if (!next) return prev;

            const isActive = ACTIVE_STATUSES.has(next.status);
            const index = prev.findIndex((row) => row.id === next.id);

            if (!isActive) {
              return index >= 0 ? prev.filter((row) => row.id !== next.id) : prev;
            }

            const active = toActive(next);
            if (index < 0) return [active, ...prev];

            const copy = [...prev];
            copy[index] = active;
            return copy;
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  return discharges;
}
