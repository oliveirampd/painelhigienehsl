import { useEffect, useState } from "react";
import { MapPin, UserRound, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useBedDetailMotion } from "@/hooks/useBedDetailMotion";

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
  origin = null,
}: {
  discharge: Discharge;
  staffName?: string | null;
  nowMs: number;
  onClose: () => void;
  origin?: HTMLElement | null;
}) {
  const { dialogRef, overlayRef, dismiss, closing } = useBedDetailMotion(origin, onClose);
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

  const effectiveStaff = staffName || null;

  const stageLabel =
    discharge.status === "waiting_cleaning"
      ? "Aguardando atendimento"
      : discharge.status === "en_route"
        ? "Colaborador a caminho"
        : discharge.status === "in_progress"
          ? "Higiene em execução"
          : DISCHARGE_STATUS_LABELS[discharge.status];

  const accent = origin?.style.getPropertyValue("--bed-accent") || "oklch(0.74 0.18 230)";

  return createPortal(
    <div
      ref={overlayRef}
      data-closing={closing || undefined}
      style={{ ["--bed-accent" as string]: accent }}
      className="tv-detail-overlay fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-0 sm:p-3 lg:items-center lg:p-4 text-white"
      onClick={dismiss}
    >
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="bed-detail-title"
        aria-describedby="bed-detail-unit"
        className="tv-bed-detail scrollbar-hidden w-full max-w-xl overflow-y-auto rounded-t-2xl border border-white/15 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tv-detail-header flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-white/55 sm:text-xs">
              Visão operacional do leito
            </div>
            <h3
              id="bed-detail-title"
              data-bed-identity
              className="mt-2 break-words text-3xl font-bold tracking-tight sm:text-4xl"
            >
              {discharge.bed_number}
            </h3>
            <div
              id="bed-detail-unit"
              className="mt-2 flex items-start gap-1.5 text-sm text-white/60"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{discharge.unit}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Fechar detalhes do leito"
            className="tv-detail-close sticky top-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="tv-detail-body">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tv-detail-status rounded-full border px-2.5 py-1 text-xs font-semibold">
                {stageLabel}
              </span>
            </div>

            <div className="mt-3 flex items-start gap-2 text-sm">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
              <div className="min-w-0 break-words">
                <div className="text-[11px] uppercase tracking-wide text-white/55 sm:text-xs">
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

          <section className="tv-detail-history mt-5 rounded-xl border border-white/10 p-3 sm:p-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-white/55 sm:text-xs">
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
              <article className="tv-timeline-reveal mt-4 min-w-0 break-words text-sm">
                <div className="font-semibold">
                  {new Date(lastCompleted.completedAt).toLocaleDateString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  · {lastCompleted.staffName || "Colaborador não informado"}
                </div>
                <ol className="tv-detail-timeline mt-4">
                  <li>
                    <span className="tv-timeline-dot" />
                    <span className="text-white/60">Início</span>
                    <time className="font-mono tabular-nums">
                      {lastCompleted.startedAt ? formatClockTime(lastCompleted.startedAt) : "—"}
                    </time>
                  </li>
                  <li>
                    <span className="tv-timeline-dot" />
                    <span className="text-white/60">Fim</span>
                    <time className="font-mono tabular-nums">
                      {formatClockTime(lastCompleted.completedAt)}
                    </time>
                  </li>
                </ol>
                <div className="mt-3 flex flex-wrap justify-between gap-2 rounded-lg bg-white/[0.035] px-3 py-2">
                  <span className="text-white/60">Duração</span>
                  <span className="font-mono tabular-nums">
                    {durationLabel(lastCompleted.durationMinutes)}
                  </span>
                </div>
                <details className="mt-2 text-xs text-white/45">
                  <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-white">
                    Conferir origem do registro
                  </summary>
                  <div className="mt-1 break-words">Listo #{lastCompleted.sourceAnswerId}</div>
                </details>
              </article>
            )}
          </section>
          {discharge.pause_reason && (
            <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-100/45 sm:text-xs">
                Observação
              </div>
              <div className="mt-1 break-words text-sm text-amber-50/80">
                {discharge.pause_reason}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/55 sm:text-xs">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-white/85 sm:text-base">
        {value}
      </div>
    </div>
  );
}
