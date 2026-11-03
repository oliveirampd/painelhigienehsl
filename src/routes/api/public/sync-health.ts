import { createFileRoute } from "@tanstack/react-router";
import {
  assessTerminalSyncHealth,
  RECONCILABLE_ACTIVE_STATUSES,
} from "@/lib/listoSyncSafety";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};
const PAGE_SIZE = 500;

// Agregados apenas. NUNCA retornar leitos, nomes, segredos ou logs do Listo.
// A rota serve para a TV distinguir "cron executando" de "dados confirmados".
export const Route = createFileRoute("/api/public/sync-health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: state, error: stateError } = await supabaseAdmin
            .from("sync_runtime_state")
            .select("last_success_at,last_error,consecutive_failures,missing_external_ids,last_active_source")
            .eq("key", "listo360")
            .single();
          if (stateError || !state) throw new Error("Estado da sincronização indisponível");

          const activeRows: Array<{
            external_id: string;
            status: string;
            status_updated_at: string;
          }> = [];
          for (let from = 0; from < 5000; from += PAGE_SIZE) {
            const { data, error } = await supabaseAdmin
              .from("discharges")
              .select("external_id,status,status_updated_at")
              .like("external_id", "listo:%")
              .in("status", [...RECONCILABLE_ACTIVE_STATUSES])
              .order("external_id", { ascending: true })
              .range(from, from + PAGE_SIZE - 1);
            if (error) throw error;
            for (const row of data ?? []) {
              if (typeof row.external_id === "string") {
                activeRows.push({
                  external_id: row.external_id,
                  status: row.status,
                  status_updated_at: row.status_updated_at,
                });
              }
            }
            if (!data || data.length < PAGE_SIZE) break;
            if (from + PAGE_SIZE >= 5000) throw new Error("Limite de leitura do monitor excedido");
          }

          const sourceSnapshot = Array.isArray(state.last_active_source)
            ? state.last_active_source
            : [];
          const activeSourceIds = sourceSnapshot
            .filter((item): item is { external_id: string } =>
              !!item && typeof item === "object" && !Array.isArray(item) &&
              "external_id" in item && typeof item.external_id === "string",
            )
            .map((item) => item.external_id);

          const health = assessTerminalSyncHealth({
            lastSuccessAt: state.last_success_at,
            lastError: state.last_error,
            consecutiveFailures: state.consecutive_failures,
            activeSourceIds,
            activeRows,
            missingState: state.missing_external_ids,
            nowMs: Date.now(),
          });
          return Response.json({
            ...health,
            checkedAt: new Date().toISOString(),
            lastSuccessAt: state.last_success_at,
          }, { headers: HEADERS });
        } catch (error) {
          console.error("[sync-health] Falha ao consultar integridade:", error);
          return Response.json(
            { status: "unavailable", checkedAt: new Date().toISOString() },
            { status: 503, headers: HEADERS },
          );
        }
      },
    },
  },
});
