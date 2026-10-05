import { useEffect, useMemo, useState } from "react";
import { Clock3, MapPin, Route, TimerReset, UserRound, X } from "lucide-react";

import { getDischargeTimeline, type DischargeTimeline } from "@/lib/analytics.functions";
import {
  DISCHARGE_STATUS_LABELS,
  formatClockTime,
  formatElapsed,
  type Discharge,
} from "@/lib/hospital";

function diffMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  if (minutes < 0 || minutes > 12 * 60) return null;
  return minutes;
}

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
  const [timeline, setTimeline] = useState<DischargeTimeline | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const answerId = discharge.last_answer_id;
    if (!answerId) return;
    setLoading(true);
    getDischargeTimeline({ data: { answerId } })
      .then((result) => {
        if (alive) setTimeline(result);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [discharge.last_answer_id]);

  const effectiveStaff = staffName || timeline?.staff || null;
  const detectedAt = timeline?.detectedAt ?? null;
  const startedAt =
    timeline?.startedAt ??
    (discharge.status === "in_progress" ? discharge.status_updated_at : null);

  const timeToStart = useMemo(
    () => diffMinutes(detectedAt, startedAt),
    [detectedAt, startedAt],
  );
  const executionMinutes = useMemo(() => {
    if (!startedAt || discharge.status !== "in_progress") return null;
    return diffMinutes(startedAt, new Date(nowMs).toISOString());
  }, [startedAt, discharge.status, nowMs]);

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
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-white/15 bg-[oklch(0.18_0.025_265)] p-4 shadow-2xl sm:rounded-2xl"
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
              <span>{timeline?.unit ?? discharge.unit}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-xs text-white/65">
              há {formatElapsed(discharge.status_updated_at, nowMs)}
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

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricCard
            label="Tempo nesta etapa"
            value={formatElapsed(discharge.status_updated_at, nowMs)}
          />
          <MetricCard
            label="Início da higiene"
            value={startedAt ? formatClockTime(startedAt) : "—"}
          />
          <MetricCard
            label={discharge.status === "in_progress" ? "Em execução há" : "Registro → início"}
            value={
              discharge.status === "in_progress"
                ? durationLabel(executionMinutes)
                : durationLabel(timeToStart)
            }
            wideOnMobile
          />
        </div>

        <div className="mt-4 space-y-2">
          <EventRow
            icon={<Clock3 className="h-4 w-4" />}
            label="Entrada na etapa atual"
            value={formatClockTime(discharge.status_updated_at)}
            detail="horário operacional usado pelo painel"
          />
          {detectedAt && (
            <EventRow
              icon={<TimerReset className="h-4 w-4" />}
              label="Registro de origem no Listo"
              value={formatClockTime(detectedAt)}
              detail="referência informada pela resposta do Listo"
            />
          )}
          {startedAt && (
            <EventRow
              icon={<Route className="h-4 w-4" />}
              label="Higiene iniciada"
              value={formatClockTime(startedAt)}
              detail={
                timeToStart == null
                  ? undefined
                  : `${durationLabel(timeToStart)} após o registro de origem`
              }
            />
          )}
        </div>

        {(timeline?.reason || discharge.pause_reason) && (
          <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-amber-100/45">
              Observação
            </div>
            <div className="mt-1 text-sm text-amber-50/80">
              {timeline?.reason ?? discharge.pause_reason}
            </div>
          </div>
        )}

        {loading && (
          <div className="mt-4 text-xs text-white/35">Atualizando dados de origem do Listo…</div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  wideOnMobile = false,
}: {
  label: string;
  value: string;
  wideOnMobile?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 ${
        wideOnMobile ? "col-span-2 sm:col-span-1" : ""
      }`}
    >
      <div className="text-[9px] uppercase tracking-wide text-white/30">{label}</div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-white/85">
        {value}
      </div>
    </div>
  );
}

function EventRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2.5">
      <div className="mt-0.5 text-white/40">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-white/30">{label}</div>
        <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white/80">
          {value}
        </div>
        {detail && <div className="mt-0.5 text-[11px] text-white/35">{detail}</div>}
      </div>
    </div>
  );
}
