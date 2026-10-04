import { useEffect, useState } from "react";
import { CircleCheck, Clock3, Route, Sparkles, UserRound, X } from "lucide-react";

import { getDischargeTimeline, type DischargeTimeline } from "@/lib/analytics.functions";
import { formatClockTime, type Discharge } from "@/lib/hospital";

export function DischargeTimelineModal({
  discharge,
  onClose,
}: {
  discharge: Discharge;
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

  const rows = [
    {
      label: "Detectada no Listo",
      at: timeline?.detectedAt ?? null,
      icon: <Clock3 className="h-4 w-4" />,
    },
    {
      label: "Início da higiene",
      at:
        timeline?.startedAt ??
        (discharge.status === "in_progress" || discharge.status === "completed"
          ? discharge.status_updated_at
          : null),
      icon: <Route className="h-4 w-4" />,
    },
    {
      label: "Conclusão",
      at: timeline?.completedAt ?? discharge.completed_at,
      icon: <CircleCheck className="h-4 w-4" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl border border-white/15 bg-[oklch(0.18_0.025_265)] p-4 shadow-2xl lg:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-white/45" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Detalhes do ciclo
              </span>
            </div>
            <h3 className="mt-1 text-2xl font-bold">{discharge.bed_number}</h3>
            <p className="text-sm text-white/45">{timeline?.unit ?? discharge.unit}</p>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">{timeline?.status ?? discharge.status}</span>
            <span className="inline-flex items-center gap-1 text-white/50">
              <UserRound className="h-3.5 w-3.5" />
              {timeline?.staff ?? "sem colaborador informado"}
            </span>
          </div>
          {timeline?.reason || discharge.pause_reason ? (
            <div className="mt-2 text-xs text-white/45">
              Motivo: {timeline?.reason ?? discharge.pause_reason}
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-1">
          {rows.map((row, index) => (
            <div key={row.label} className="relative flex gap-3 pb-4 last:pb-0">
              {index < rows.length - 1 && (
                <span className="absolute left-[15px] top-7 h-[calc(100%-14px)] w-px bg-white/10" />
              )}
              <div className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[oklch(0.22_0.025_265)] text-white/55">
                {row.icon}
              </div>
              <div className="pt-0.5">
                <div className="text-xs uppercase tracking-wide text-white/35">{row.label}</div>
                <div className="mt-0.5 font-mono text-base tabular-nums text-white/85">
                  {row.at ? formatClockTime(row.at) : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="mt-4 text-xs text-white/35">Carregando horários do Listo…</div>
        )}
        {!discharge.last_answer_id && (
          <div className="mt-4 text-xs text-white/35">
            Este registro não possui ID de resposta do Listo; exibindo somente os horários disponíveis no painel.
          </div>
        )}
      </div>
    </div>
  );
}
