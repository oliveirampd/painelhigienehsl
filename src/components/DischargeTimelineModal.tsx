import { useEffect, useState } from "react";
import { MapPin, UserRound, X } from "lucide-react";

import {
  getLastCompletedDischarge,
  type LastCompletedDischarge,
} from "@/lib/lastDischarge.functions";
import {
  DISCHARGE_STATUS_LABELS,
  formatClockTime,
  formatElapsed,
  type Discharge,
} from "@/lib/hospital";

function durationLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function DischargeTimelineModal({
  discharge,
  staffName,
  nowMs,
  onClose,
}: {
  discharge: Discharge;
  staffName?: string | null;
  nowMs: number;
  onClose: () => void;
}) {
  const [lastCompleted, setLastCompleted] = useState<LastCompletedDischarge | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLastCompleted(null);
    setError(false);
    setLoading(true);
    getLastCompletedDischarge({
      data: { unit: discharge.unit, bedNumber: discharge.bed_number },
    })
      .then((result) => {
        if (alive) setLastCompleted(result);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [discharge.unit, discharge.bed_number]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const effectiveStaff = staffName || null;

  const stageLabel =
    discharge.status === "waiting_cleaning"
      ? "Aguardando atendimento"
      : discharge.status === "en_route"
        ? "Colaborador a caminho"
        : discharge.status === "in_progress"
          ? "Higiene em execução"
          : DISCHARGE_STATUS_LABELS[discharge.status];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:p-3 lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Visão operacional do leito"
        className="scrollbar-hidden max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-white/15 bg-[oklch(0.18_0.025_265)] p-4 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
              Visão operacional do leito
            </div>
            <h3 className="mt-1 text-2xl font-bold">{discharge.bed_number}</h3>
            <div className="mt-1 flex items-start gap-1.5 text-sm text-white/45">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{discharge.unit}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes do leito"
            className="rounded-full p-1.5 text-white/45 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-xs font-semibold">
              {stageLabel}
            </span>
          </div>

          <div className="mt-3 flex items-start gap-2 text-sm">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/30">
                Colaborador alocado
              </div>
              <div className={effectiveStaff ? "font-semibold text-white/85" : "text-white/45"}>
                {effectiveStaff ??
                  (discharge.status === "waiting_cleaning"
                    ? "Ainda sem colaborador"
                    : "Nome não identificado na origem")}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MetricCard
            label="Nesta etapa desde"
            value={formatClockTime(discharge.status_updated_at)}
          />
          <MetricCard
            label="Tempo nesta etapa"
            value={formatElapsed(discharge.status_updated_at, nowMs)}
          />
        </div>

        <section className="panel-surface mt-4 rounded-xl border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
            Histórico do leito
          </div>
          <h4 className="mt-1 font-semibold">Última Alta concluída</h4>
          <p className="mt-1 text-xs text-white/50">
            Última conclusão sincronizada para este leito · horários de Brasília.
          </p>
          {loading ? (
            <p className="mt-2 text-sm">Carregando histórico…</p>
          ) : error ? (
            <p className="mt-2 text-sm text-amber-100">
              O histórico deste leito está indisponível agora.
            </p>
          ) : !lastCompleted ? (
            <p className="mt-2 text-sm text-white/60">
              Ainda não há uma Alta concluída sincronizada para este leito.
            </p>
          ) : (
            <article className="mt-3 rounded-lg bg-black/10 p-3 text-sm">
              <div className="font-semibold">
                {new Date(lastCompleted.completedAt).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}{" "}
                · {lastCompleted.staffName || "Colaborador não informado"}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <span>
                  Início: {lastCompleted.startedAt ? formatClockTime(lastCompleted.startedAt) : "—"}
                </span>
                <span>Fim: {formatClockTime(lastCompleted.completedAt)}</span>
                <span>Duração: {durationLabel(lastCompleted.durationMinutes)}</span>
              </div>
              <details className="mt-2 text-xs text-white/45">
                <summary className="cursor-pointer">Conferir origem do registro</summary>
                <div className="mt-1 break-words">
                  Listo #{lastCompleted.sourceAnswerId}
                </div>
              </details>
            </article>
          )}
        </section>
        {discharge.pause_reason && (
          <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-amber-100/45">Observação</div>
            <div className="mt-1 text-sm text-amber-50/80">{discharge.pause_reason}</div>
          </div>
        )}

      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-white/30">{label}</div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-white/85">
        {value}
      </div>
    </div>
  );
}
