import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BedDouble, CheckCircle2, Clock3, Database, History, MapPin,
  ShieldCheck, Timer, UserRound, X,
} from "lucide-react";
import { useModalFocus } from "@/hooks/useModalFocus";
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

type OriginRect = { x: number; y: number; width: number; height: number };

const STATUS_TONES: Record<Discharge["status"], { color: string; background: string; border: string }> = {
  waiting_cleaning: { color: "#f8c47e", background: "#342311", border: "#80562d" },
  en_route: { color: "#8fc8ff", background: "#132c47", border: "#386a9a" },
  in_progress: { color: "#92e6bc", background: "#103327", border: "#2a7659" },
  paused: { color: "#ffa3ad", background: "#421b27", border: "#924654" },
  maintenance: { color: "#ffc489", background: "#392717", border: "#825b38" },
  completed: { color: "#92e6bc", background: "#103327", border: "#2a7659" },
  completed_with_issues: { color: "#d2bbc8", background: "#302530", border: "#68546b" },
};

function durationLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + "h " + String(m).padStart(2, "0") + "m";
}

/**
 * Janela de leitura do leito: mesma fonte e mesmas regras do Terminal.
 * A transição de abertura usa a posição do card somente para orientar o movimento,
 * sem escalar o texto até o tamanho do card (distorção visual e custo de pintura).
 */
export function DischargeTimelineModal({
  discharge,
  staffName,
  nowMs,
  originRect,
  onClose,
}: {
  discharge: Discharge;
  staffName?: string | null;
  nowMs: number;
  originRect?: OriginRect | null;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>();
  const closingRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<LastCompletedDischarge | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  useLayoutEffect(() => {
    if (!originRect || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia?.("(max-width: 639px)").matches) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const dx = originRect.x + originRect.width / 2 - (rect.x + rect.width / 2);
    const dy = originRect.y + originRect.height / 2 - (rect.y + rect.height / 2);
    // Deslocamento curto e contextual, mesmo quando o card fica distante do modal.
    const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
    dialog.style.setProperty("--bed-origin-x", clamp(dx * 0.22, 64) + "px");
    dialog.style.setProperty("--bed-origin-y", clamp(dy * 0.22, 55) + "px");
  }, [dialogRef, originRect]);

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
    return () => { alive = false; };
  }, [discharge.unit, discharge.bed_number]);

  const stageLabel =
    discharge.status === "waiting_cleaning"
      ? "Aguardando atendimento"
      : discharge.status === "en_route"
        ? "Colaborador a caminho"
        : discharge.status === "in_progress"
          ? "Higiene em execução"
          : DISCHARGE_STATUS_LABELS[discharge.status];
  const tone = STATUS_TONES[discharge.status];
  const theme = {
    "--bed-accent": tone.color,
    "--bed-accent-bg": tone.background,
    "--bed-accent-border": tone.border,
  } as CSSProperties;

  return (
    <div
      className={"bed-detail-overlay fixed inset-0 z-[80] flex items-end justify-center overflow-hidden bg-black/80 p-0 sm:items-center sm:p-4 " +
        (closing ? "bed-detail-overlay-closing" : "")}
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bed-detail-title"
        ref={dialogRef}
        tabIndex={-1}
        style={theme}
        className={"bed-detail-dialog flex max-h-[min(92dvh,790px)] w-full max-w-[610px] min-w-0 flex-col overflow-hidden rounded-t-xl border border-[#263445] bg-[#090d13] text-[#f3f7fb] shadow-[0_18px_65px_rgba(0,0,0,0.55)] outline-none sm:max-h-[min(88dvh,790px)] sm:rounded-xl " +
          (closing ? "bed-detail-dialog-closing" : "")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-[#253242] bg-[#0d131c] px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-[var(--bed-accent)] opacity-80" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--bed-accent-border)] bg-[var(--bed-accent-bg)] text-[var(--bed-accent)]">
                <BedDouble className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold normal-case tracking-normal text-[#91a2b5] sm:text-[11px]">
                  Visão operacional do leito
                </p>
                <h2 id="bed-detail-title" className="mt-0.5 break-words text-[23px] font-bold leading-tight tracking-tight sm:text-[27px]">
                  {discharge.bed_number}
                </h2>
                <div className="mt-1 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-[#a7b5c6] sm:text-[13px]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{discharge.unit}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Fechar detalhes do leito"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-[#a8b7c8] transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="bed-detail-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-4 pt-3 sm:space-y-4 sm:px-5 sm:pb-5 sm:pt-4">
          <section className="bed-detail-reveal rounded-lg border border-[var(--bed-accent-border)] bg-[var(--bed-accent-bg)] px-3 py-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--bed-accent)]" aria-hidden="true" />
              <h3 className="min-w-0 break-words text-[13px] font-semibold text-[var(--bed-accent)] sm:text-sm">
                {stageLabel}
              </h3>
            </div>
            <p className="mt-1.5 text-[11px] text-white/55 sm:text-xs">Etapa operacional atual</p>
          </section>

          <section className="bed-detail-reveal bed-detail-reveal-second rounded-lg border border-[#293747] bg-[#111a25] px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold normal-case tracking-normal text-[#90a2b5]">
              <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              Colaborador alocado
            </div>
            <p className={"mt-1.5 break-words text-sm font-semibold leading-snug " +
              (staffName ? "text-[#eff6fd]" : "text-[#9fb0c0]")}>
              {staffName ||
                (discharge.status === "waiting_cleaning"
                  ? "Ainda sem colaborador"
                  : "Nome não identificado na origem")}
            </p>
          </section>

          <div className="bed-detail-reveal bed-detail-reveal-second grid min-w-0 grid-cols-2 gap-2">
            <MetricCard
              icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Nesta etapa desde"
              value={formatClockTime(discharge.status_updated_at)}
            />
            <MetricCard
              icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />}
              label="Tempo nesta etapa"
              value={formatElapsed(discharge.status_updated_at, nowMs)}
              accent
            />
          </div>

          <section className="bed-detail-reveal bed-detail-reveal-third min-w-0 rounded-lg border border-[#293747] bg-[#0e151e] p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <History className="h-4 w-4 shrink-0 text-[#a9bcd1]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[#f3f7fb]">Histórico do leito</h3>
            </div>
            <div className="mt-1 text-xs text-[#92a3b7]">
              Última alta concluída · horários de Brasília
            </div>

            {loading ? (
              <p role="status" className="mt-3 rounded-lg border border-[#263648] bg-[#141f2a] p-3 text-sm text-[#b3c1d1]">
                Carregando histórico…
              </p>
            ) : error ? (
              <p role="status" className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-100">
                O histórico deste leito está indisponível agora.
              </p>
            ) : !lastCompleted ? (
              <p className="mt-3 rounded-lg border border-[#263648] bg-[#141f2a] p-3 text-sm text-[#b3c1d1]">
                Ainda não há uma alta concluída sincronizada para este leito.
              </p>
            ) : (
              <article className="mt-3 min-w-0 space-y-3 rounded-lg border border-[#2b394a] bg-[#131d29] p-3">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#81d8ac]" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#eff5fb]">Alta finalizada</div>
                      <p className="mt-0.5 text-[12px] text-[#98a9bd]">
                        {new Date(lastCompleted.completedAt).toLocaleDateString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-md border border-[#285d48] bg-[#16392c] px-2 py-1 text-[11px] font-semibold text-[#a1eac5]">
                    Concluída
                  </span>
                </div>

                <div className="flex min-w-0 items-start gap-2 text-[13px] text-[#d2deeb]">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#879cb2]" aria-hidden="true" />
                  <span className="min-w-0 break-words">{lastCompleted.staffName || "Colaborador não informado"}</span>
                </div>

                <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:gap-2">
                  <HistoryMetric label="Início" value={lastCompleted.startedAt ? formatClockTime(lastCompleted.startedAt) : "—"} />
                  <HistoryMetric label="Fim" value={formatClockTime(lastCompleted.completedAt)} />
                  <HistoryMetric label="Duração" value={durationLabel(lastCompleted.durationMinutes)} />
                </div>
                <details className="group min-w-0 border-t border-[#2a3746] pt-2 text-xs text-[#94a6b9]">
                  <summary className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
                    <Database className="h-3.5 w-3.5" aria-hidden="true" />
                    Conferir origem do registro
                  </summary>
                  <p className="mt-1 break-all pl-1">Listo #{lastCompleted.sourceAnswerId}</p>
                </details>
              </article>
            )}
          </section>

          {discharge.pause_reason && (
            <section className="min-w-0 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-3 sm:px-4">
              <h3 className="text-[11px] font-semibold normal-case tracking-normal text-amber-200">Observação</h3>
              <p className="mt-1 break-words text-[13px] leading-relaxed text-amber-50/90">{discharge.pause_reason}</p>
            </section>
          )}

          <div className="flex min-w-0 items-center gap-1.5 pt-1 text-[11px] text-[#7f92a7]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Histórico operacional
          </div>
        </div>
        <div className="shrink-0 border-t border-[#233040] bg-[#0c121a] px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:px-5 sm:py-3">
          <button
            type="button"
            onClick={requestClose}
            className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[#35465a] bg-[#182330] px-4 text-[13px] font-semibold text-[#d9e6f3] transition-colors hover:bg-[#243346] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 sm:ml-auto sm:w-auto sm:min-w-24"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon, label, value, accent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#2a394b] bg-[#121c27] px-3 py-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold normal-case leading-tight tracking-normal text-[#93a6b9] sm:text-[11px]">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0">{label}</span>
      </div>
      <div className={"mt-2 break-words font-mono text-[17px] font-bold leading-tight tabular-nums sm:text-xl " +
        (accent ? "text-[var(--bed-accent)]" : "text-[#f0f5fc]")}>
        {value}
      </div>
    </div>
  );
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#2b3a4b] bg-[#1b2836] px-2 py-2">
      <p className="text-[11px] font-semibold normal-case tracking-normal text-[#91a4b8]">{label}</p>
      <p className="mt-1 break-words font-mono text-[12px] font-semibold leading-snug tabular-nums text-[#f2f6fb] sm:text-sm">{value}</p>
    </div>
  );
}
