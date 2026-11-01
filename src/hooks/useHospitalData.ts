import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Discharge, Staff } from "@/lib/hospital";
import { fetchPages } from "@/lib/fetchPages";

const PAGE_SIZE = 500;

async function fetchAllDischarges(): Promise<Discharge[]> {
  return fetchPages<Discharge>((from, to) =>
    supabase.from("discharges").select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  PAGE_SIZE);
}

async function fetchAllStaff(): Promise<Staff[]> {
  return fetchPages<Staff>((from, to) =>
    supabase.from("staff").select("*")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  PAGE_SIZE);
}

export function useHospitalData() {
  const [discharges, setDischarges] = useState<Discharge[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let loadingNow = false;
    let reloadRequested = false;
    let dischargeChanges: Array<{ eventType: string; new: unknown; old: unknown }> = [];
    let staffChanges: Array<{ eventType: string; new: unknown; old: unknown }> = [];

    async function loadAll() {
      if (loadingNow) {
        reloadRequested = true;
        return;
      }
      loadingNow = true;
      dischargeChanges = [];
      staffChanges = [];
      try {
        const [rows, staffRows] = await Promise.all([
          fetchAllDischarges(),
          fetchAllStaff(),
        ]);
        if (!mounted) return;
        setDischarges(dischargeChanges.reduce(applyChange, rows));
        setStaff(staffChanges.reduce(applyChange, staffRows));
        setError(null);
      } catch (cause) {
        console.error("[useHospitalData]", cause);
        if (mounted) {
          setDischarges((prev) => dischargeChanges.reduce(applyChange, prev));
          setStaff((prev) => staffChanges.reduce(applyChange, prev));
          setError("Não foi possível atualizar os dados. Tentando novamente.");
        }
      } finally {
        loadingNow = false;
        if (mounted) {
          setLoading(false);
          if (reloadRequested) {
            reloadRequested = false;
            void loadAll();
          }
        }
      }
    }

    const channel = supabase.channel("hospital-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "discharges" }, (payload) => {
        if (loadingNow) dischargeChanges.push(payload);
        else setDischarges((prev) => applyChange(prev, payload));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, (payload) => {
        if (loadingNow) staffChanges.push(payload);
        else setStaff((prev) => applyChange(prev, payload));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadAll();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (mounted) setError("Conexão em tempo real interrompida. Reconectando.");
        }
      });

    // A leitura iniciada após SUBSCRIBED fecha a janela entre carga e assinatura.
    void loadAll();
    const onVisible = () => { if (document.visibilityState === "visible") void loadAll(); };
    window.addEventListener("online", loadAll);
    document.addEventListener("visibilitychange", onVisible);
    const reconcile = window.setInterval(() => void loadAll(), 60_000);
    return () => {
      mounted = false;
      window.clearInterval(reconcile);
      window.removeEventListener("online", loadAll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, []);

  return { discharges, staff, loading, error };
}

function applyChange<T extends { id: string }>(
  prev: T[],
  payload: { eventType: string; new: unknown; old: unknown },
): T[] {
  const newRow = payload.new as T | null;
  const oldRow = payload.old as T | null;
  if (payload.eventType === "INSERT" && newRow) {
    if (prev.some((r) => r.id === newRow.id)) return prev.map((r) => r.id === newRow.id ? newRow : r);
    return [newRow, ...prev];
  }
  if (payload.eventType === "UPDATE" && newRow) {
    if (!prev.some((r) => r.id === newRow.id)) return [newRow, ...prev];
    return prev.map((r) => (r.id === newRow.id ? newRow : r));
  }
  if (payload.eventType === "DELETE" && oldRow) {
    return prev.filter((r) => r.id !== oldRow.id);
  }
  return prev;
}
