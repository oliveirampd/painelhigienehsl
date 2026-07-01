import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Discharge, Staff } from "@/lib/hospital";

/**
 * Subscribes to discharges + staff via Supabase Realtime and keeps local state
 * in sync. Any UI change on /control reflects instantly on /tv.
 */
export function useHospitalData() {
  const [discharges, setDischarges] = useState<Discharge[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadAll() {
      const [dRes, sRes] = await Promise.all([
        supabase.from("discharges").select("*").order("created_at", { ascending: false }),
        supabase.from("staff").select("*").order("name", { ascending: true }),
      ]);
      if (!mounted) return;
      if (dRes.data) setDischarges(dRes.data);
      if (sRes.data) setStaff(sRes.data);
      setLoading(false);
    }
    loadAll();

    const channel = supabase
      .channel("hospital-ops")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discharges" },
        (payload) => {
          setDischarges((prev) => applyChange(prev, payload));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff" },
        (payload) => {
          setStaff((prev) => applyChange(prev, payload));
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { discharges, staff, loading };
}

function applyChange<T extends { id: string }>(
  prev: T[],
  payload: { eventType: string; new: unknown; old: unknown },
): T[] {
  const newRow = payload.new as T | null;
  const oldRow = payload.old as T | null;
  if (payload.eventType === "INSERT" && newRow) {
    if (prev.some((r) => r.id === newRow.id)) return prev;
    return [newRow, ...prev];
  }
  if (payload.eventType === "UPDATE" && newRow) {
    return prev.map((r) => (r.id === newRow.id ? newRow : r));
  }
  if (payload.eventType === "DELETE" && oldRow) {
    return prev.filter((r) => r.id !== oldRow.id);
  }
  return prev;
}
