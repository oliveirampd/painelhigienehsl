import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  Gauge,
  RefreshCw,
  Sparkles,
  TimerReset,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PanelNav } from "@/components/PanelNav";
import {
  getOperationsAnalytics,
  type OperationsAnalytics,
  type ShiftSummary,
} from "@/lib/analytics.functions";

export const Route = createFileRoute("/gestao")({
  head: () => ({
    meta: [
      { title: "Gestão — Painel de Higienização" },
      {
        name: "description",
        content: "Histórico operacional, tendências e resumo dos turnos de higienização terminal.",
      },
    ],
  }),
  component: GestaoPage,
});

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function GestaoPage() {
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setData(await getOperationsAnalytics());
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Não foi possível carregar a análise do Listo agora.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const maxHeat = useMemo(
    () => Math.max(1, ...(data?.weekdayHour.map((x) => x.count) ?? [1])),
    [data],
  );

  return (
    <div className="dark min-h-screen bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[oklch(0.145_0.02_265_/_0.94)] px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-white/60" />
              <h1 className="text-xl font-bold lg:text-2xl">Gestão Operacional</h1>
            </div>
            <p className="mt-0.5 text-xs text-white/40">
              Histórico recente do Listo · atualização a cada 5 minutos
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PanelNav />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-5 px-4 py-5 lg:px-6">
        {error && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {data ? (
          <>
            {data.samplePartial && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/80">
                A amostra histórica atingiu o limite de paginação em pelo menos uma janela diária.
                Os indicadores continuam úteis como tendência, mas podem não representar 100% dos registros daquele período.
              </div>
            )}

            <section className="grid gap-3 lg:grid-cols-2">
              <ShiftCard title="Turno atual" summary={data.currentShift} emphasis />
              <ShiftCard title="Último turno" summary={data.previousShift} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                icon={<Activity className="h-4 w-4" />}
                label="Amostra analisada"
                value={String(data.totalSample)}
                detail="altas terminais recentes"
              />
              <Metric
                icon={<Clock3 className="h-4 w-4" />}
                label="Horário de maior volume"
                value={data.peakHour == null ? "—" : `${String(data.peakHour).padStart(2, "0")}:00`}
                detail={data.peakCount ? `${data.peakCount} registros na amostra` : "sem dados"}
              />
              <Metric
                icon={<Gauge className="h-4 w-4" />}
                label="Execução média atual"
                value={
                  data.currentShift.avgExecutionMin == null
                    ? "—"
                    : `${data.currentShift.avgExecutionMin} min`
                }
                detail="início → conclusão"
              />
              <Metric
                icon={<TimerReset className="h-4 w-4" />}
                label="Registro → início"
                value={data.currentShift.avgWaitMin == null ? "—" : `${data.currentShift.avgWaitMin} min`}
                detail="usa horário registrado pelo Listo"
              />
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold">Tendência para as próximas horas</h2>
                  <p className="text-xs text-white/40">
                    Média histórica por faixa horária; é uma tendência, não uma previsão clínica.
                  </p>
                </div>
                <Sparkles className="h-4 w-4 text-white/40" />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {data.forecast.map((x) => (
                  <div key={x.hour} className="rounded-lg border border-white/10 bg-black/10 px-3 py-3">
                    <div className="text-xs uppercase tracking-wide text-white/40">
                      {String(x.hour).padStart(2, "0")}:00–{String((x.hour + 1) % 24).padStart(2, "0")}:00
                    </div>
                    <div className="mt-1 text-3xl font-bold tabular-nums">{x.expected}</div>
                    <div className="text-xs text-white/40">altas esperadas pela média recente</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Volume de altas — últimos 7 dias">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.days}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#171923", border: "1px solid rgba(255,255,255,.15)" }} />
                    <Bar dataKey="total" name="Altas" fill="oklch(0.74 0.18 230)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Concluídas" fill="oklch(0.72 0.17 155)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Tempo médio por dia">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.days}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "rgba(255,255,255,.5)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#171923", border: "1px solid rgba(255,255,255,.15)" }} />
                    <Line type="monotone" dataKey="avgWaitMin" name="Registro → início" stroke="oklch(0.78 0.2 60)" strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="avgExecutionMin" name="Execução" stroke="oklch(0.72 0.17 155)" strokeWidth={2} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3">
                <h2 className="font-bold">Mapa de calor por dia e horário</h2>
                <p className="text-xs text-white/40">
                  Quanto mais forte a célula, maior o volume observado na amostra recente.
                </p>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[46px_repeat(24,minmax(24px,1fr))] gap-1 text-[9px] text-white/35">
                    <span />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="text-center">{h}</span>
                    ))}
                    {WEEKDAYS.map((day, weekday) => (
                      <HeatRow
                        key={day}
                        label={day}
                        weekday={weekday}
                        data={data.weekdayHour}
                        max={maxHeat}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <h2 className="mb-3 font-bold">Desempenho por bloco</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-white/35">
                    <tr>
                      <th className="py-2">Bloco</th>
                      <th className="py-2">Volume</th>
                      <th className="py-2">Concluídas</th>
                      <th className="py-2">Registro → início</th>
                      <th className="py-2">Execução</th>
                      <th className="py-2">Dentro da meta de execução</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.blocks.map((b) => (
                      <tr key={b.block} className="border-t border-white/5">
                        <td className="py-2 font-semibold">Bloco {b.block}</td>
                        <td className="py-2 tabular-nums">{b.total}</td>
                        <td className="py-2 tabular-nums">{b.completed}</td>
                        <td className="py-2 tabular-nums">{b.avgWaitMin == null ? "—" : `${b.avgWaitMin} min`}</td>
                        <td className="py-2 tabular-nums">{b.avgExecutionMin == null ? "—" : `${b.avgExecutionMin} min`}</td>
                        <td className="py-2 tabular-nums">{b.withinTargetPct == null ? "—" : `${b.withinTargetPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3">
                <h2 className="font-bold">Áreas comuns — menor recorrência recente</h2>
                <p className="text-xs text-white/40">
                  Áreas com menos registros concluídos na amostra recente do Listo. É um sinal para investigação, não uma classificação automática de falha.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.generalAreas.slice(0, 9).map((area) => (
                  <div key={`${area.unit}|${area.area}`} className="rounded-lg border border-white/10 bg-black/10 p-3">
                    <div className="truncate text-sm font-semibold" title={area.area}>{area.area}</div>
                    <div className="mt-0.5 truncate text-[11px] text-white/35" title={area.unit}>{area.unit}</div>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-bold tabular-nums">{area.completed7d}</div>
                        <div className="text-[10px] uppercase tracking-wide text-white/35">registros concluídos</div>
                      </div>
                      <div className="text-right text-xs text-white/40">
                        {area.activeDays} dia(s)<br />com registro
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-white/40">
            {loading ? "Carregando histórico operacional…" : "Sem dados disponíveis."}
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-white/35">{detail}</div>
    </div>
  );
}

function ShiftCard({
  title,
  summary,
  emphasis = false,
}: {
  title: string;
  summary: ShiftSummary;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${emphasis ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-white/10 bg-white/[0.035]"}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-white/40">{title}</div>
          <h2 className="mt-0.5 text-lg font-bold">{summary.label}</h2>
        </div>
        <div className="text-right text-xs text-white/35">
          {new Date(summary.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
          {" → "}
          {new Date(summary.end).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Altas" value={summary.total} />
        <Mini label="Concluídas" value={summary.completed} />
        <Mini label="Reg. → início" value={summary.avgWaitMin == null ? "—" : `${summary.avgWaitMin}m`} />
        <Mini label="Execução" value={summary.avgExecutionMin == null ? "—" : `${summary.avgExecutionMin}m`} />
        <Mini label="Meta execução" value={summary.withinTargetPct == null ? "—" : `${summary.withinTargetPct}%`} />
      </div>
      <div className="mt-3 rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-xs leading-relaxed text-white/45">
        Resumo automático: {summary.total} altas registradas, {summary.completed} concluídas
        {summary.avgExecutionMin == null ? "" : `, execução média de ${summary.avgExecutionMin} min`}
        {summary.withinTargetPct == null ? "" : ` e ${summary.withinTargetPct}% dentro da meta de execução`}.
        {summary.peakHour == null
          ? ""
          : ` Pico às ${String(summary.peakHour).padStart(2, "0")}:00, com ${summary.peakCount} altas na faixa.`}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="mb-3 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function HeatRow({
  label,
  weekday,
  data,
  max,
}: {
  label: string;
  weekday: number;
  data: Array<{ weekday: number; hour: number; count: number }>;
  max: number;
}) {
  return (
    <>
      <span className="flex items-center text-[10px] text-white/45">{label}</span>
      {Array.from({ length: 24 }, (_, hour) => {
        const count = data.find((x) => x.weekday === weekday && x.hour === hour)?.count ?? 0;
        const opacity = count === 0 ? 0.035 : 0.12 + (count / max) * 0.72;
        return (
          <div
            key={hour}
            title={`${label} ${String(hour).padStart(2, "0")}:00 · ${count} altas`}
            className="h-6 rounded-[3px] border border-white/5"
            style={{ background: `oklch(0.68 0.17 230 / ${opacity})` }}
          />
        );
      })}
    </>
  );
}
