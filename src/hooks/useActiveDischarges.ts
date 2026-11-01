import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Discharge } from "@/lib/hospital";
import { fetchPages } from "@/lib/fetchPages";

export type ActiveDischarge = Pick<
  Discharge,
  "id" | "external_id" | "bed_number" | "unit" | "status"
>;

const ACTIVE_STATUSES = new Set<Discharge["status"]>(["waiting_cleaning", "in_progress"]);
const PAGE_SIZE = 500;

function toActive(row: Discharge): ActiveDischarge {
  return {
    id: row.id,
    external_id: row.external_id,
    bed_number: row.bed_number,
    unit: row.unit,
    status: row.status,
  };
}

function applyActiveChange(
  prev: ActiveDischarge[],
  payload: { eventType: string; new: unknown; old: unknown },
): ActiveDischarge[] {
  const oldRow = payload.old as Partial<Discharge> | null;
  if (payload.eventType === "DELETE") {
    return oldRow?.id ? prev.filter((row) => row.id !== oldRow.id) : prev;
  }
  const next = payload.new as Discharge | null;
  if (!next) return prev;
  if (!ACTIVE_STATUSES.has(next.status)) return prev.filter((row) => row.id !== next.id);
  const active = toActive(next);
  const index = prev.findIndex((row) => row.id === next.id);
  if (index < 0) return [active, ...prev];
  return prev.map((row) => row.id === next.id ? active : row);
}

async function fetchActive(): Promise<ActiveDischarge[]> {
  return fetchPages<ActiveDischarge>((from, to) =>
    supabase.from("discharges")
      .select("id,external_id,bed_number,unit,status")
      .in("status", ["waiting_cleaning", "in_progress"])
      .order("id", { ascending: true })
      .range(from, to),
  PAGE_SIZE);
}

/** Consulta enxuta da Diária, reconciliada após assinatura e reconexão. */
export function useActiveDischarges() {
  const [discharges, setDischarges] = useState<ActiveDischarge[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    let loading = false;
    let reloadRequested = false;
    let buffered: Array<{ eventType: string; new: unknown; old: unknown }> = [];
    async function load() {
      if (loading) { reloadRequested = true; return; }
      loading = true;
      buffered = [];
      try {
        const rows = await fetchActive();
        if (!mounted) return;
        setDischarges(buffered.reduce(applyActiveChange, rows));
        setError(null);
      } catch (cause) {
        console.error("[useActiveDischarges]", cause);
        if (mounted) {
          setDischarges((prev) => buffered.reduce(applyActiveChange, prev));
          setError("Altas da Diária não atualizadas. Tentando novamente.");
        }
      } finally {
        loading = false;
        if (mounted && reloadRequested) {
          reloadRequested = false;
          void load();
        }
      }
    }

    const channel = supabase.channel("daily-active-discharges")
      .on("postgres_changes", { event: "*", schema: "public", table: "discharges" }, (payload) => {
        if (loading) buffered.push(payload);
        else setDischarges((prev) => applyActiveChange(prev, payload));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (mounted) setError("Conexão das altas interrompida. Reconectando.");
        }
      });
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", onVisible);
    const reconcile = window.setInterval(() => void load(), 60_000);
    return () => {
      mounted = false;
      window.clearInterval(reconcile);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, []);
  return { discharges, error };
}
