import { useEffect, useState } from "react";

export type TerminalSyncHealth = {
  status: "healthy" | "reconciling" | "degraded" | "stale" | "unavailable";
  checkedAt?: string;
  lastSuccessAt?: string | null;
  ageSeconds?: number | null;
  sourceActive?: number;
  databaseActive?: number;
  inObservation?: number;
  outOfLookback?: number;
  unobserved?: number;
  missingInDatabase?: number;
  /** Falhas seguidas apenas do endpoint de monitoramento (não do Listo). */
  monitorFailures?: number;
};

/** O contador de 60s é apenas uma agenda. Este monitor lê o sucesso REAL. */
export function useTerminalSyncHealth() {
  const [health, setHealth] = useState<TerminalSyncHealth | null>(null);

  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/public/sync-health", { cache: "no-store" });
        if (!response.ok) throw new Error("Monitor indisponível");
        const value = (await response.json()) as TerminalSyncHealth;
        if (!["healthy", "reconciling", "degraded", "stale"].includes(value.status)) {
          throw new Error("Resposta de integridade inválida");
        }
        if (mounted) setHealth({ ...value, monitorFailures: 0 });
      } catch {
        // Uma consulta isolada do monitor pode falhar sem o Listo ter parado.
        // Preservamos o último horário conhecido e contamos apenas erros do monitor.
        if (mounted) setHealth((previous) => ({
          ...previous,
          status: "unavailable",
          monitorFailures: (previous?.monitorFailures ?? 0) + 1,
        }));
      } finally {
        pending = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  return health;
}
