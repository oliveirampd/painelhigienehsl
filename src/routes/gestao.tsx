import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BedDouble,
  BrushCleaning,
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
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  getOperationsAnalytics,
  type OperationsAnalytics,
  type ShiftSummary,
} from "@/lib/analytics.functions";
import { usePanelTheme } from "@/hooks/usePanelTheme";
import {
  getDailyOperationsAnalytics,
  type DailyOperationsAnalytics,
} from "@/lib/dailyAnalytics.functions";

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
const BLOCK_COLOR: Record<string, string> = {
  D: "oklch(0.66 0.20 145)",
  E: "oklch(0.62 0.22 300)",
  C: "oklch(0.64 0.20 245)",
  B: "oklch(0.63 0.23 25)",
};

function GestaoPage() {
  const { isDark, themeClass, toggleTheme } = usePanelTheme();
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dailyData, setDailyData] = useState<DailyOperationsAnalytics | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [terminalResult, dailyResult] = await Promise.allSettled([
      getOperationsAnalytics(),
      getDailyOperationsAnalytics(),
    ]);

    if (terminalResult.status === "fulfilled") {
      setData(terminalResult.value);
      setError(null);
    } else {
      console.error(terminalResult.reason);
      setError("Não foi possível carregar a análise das Altas agora.");
    }

    if (dailyResult.status === "fulfilled") {
      setDailyData(dailyResult.value);
      setDailyError(null);
    } else {
      console.error(dailyResult.reason);
      setDailyError("A análise histórica da Higiene Diária está indisponível agora.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const chartGrid = isDark ? "rgba(255,255,255,.08)" : "rgba(30,45,65,.12)";
  const chartTick = isDark ? "rgba(255,255,255,.55)" : "rgba(25,42,62,.68)";
  const tooltipStyle = {
    background: isDark ? "#171923" : "#ffffff",
    border: isDark ? "1px solid rgba(255,255,255,.15)" : "1px solid rgba(30,45,65,.18)",
    color: isDark ? "#f8fafc" : "#172033",
    borderRadius: 8,
  };

  const maxHeat = useMemo(
    () => Math.max(1, ...(data?.weekdayHour.map((x) => x.count) ?? [1])),
    [data],
  );

  const chartDays = useMemo(
    () =>
      (data?.days ?? []).map((day) => ({
        ...day,
        label: new Date(`${day.date}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "America/Sao_Paulo",
        }),
      })),
    [data],
  );

  return (
    <div className={`${themeClass} min-h-screen bg-background text-foreground`}>
      <header className="panel-shell-header sticky top-0 z-30 border-b border-white/10 px-4 py-3 lg:px-6">
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
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:flex-none">
              <PanelNav />
            </div>
            <ThemeToggle isDark={isDark} onToggle={toggleTheme} compact />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-5 px-4 py-5 lg:px-6">
        {error && (
          <div role="status" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {(data || dailyData) && (
          <nav
            aria-label="Seções da Gestão"
            className="panel-management-nav scrollbar-hidden flex gap-1 overflow-x-auto rounded-xl border p-1"
          >
            {data && (
              <>
                <a className="panel-management-link shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold" href="#resumo">
                  Resumo
                </a>
                <a className="panel-management-link shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold" href="#altas">
                  Altas
                </a>
                <a className="panel-management-link shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold" href="#colaboradores">
                  Colaboradores
                </a>
                <a className="panel-management-link shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold" href="#qualidade-dados">
                  Dados
                </a>
              </>
            )}
            {dailyData && (
              <a className="panel-management-link shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold" href="#higiene-diaria">
                Higiene Diária
              </a>
            )}
          </nav>
        )}

        {data || dailyData ? (
          <>
            {data && (
              <>
                <ManagementSectionHeader
                  id="resumo"
                  eyebrow="Gestão"
                  title="Visão geral"
                  description="Leitura rápida do turno atual e do último turno de higiene terminal."
                />
                {data.samplePartial && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/80">
                A consulta está parcial por limite de paginação, falha na origem ou uso de cache. Os
                totais não representam necessariamente todos os registros do período; não use esta
                amostra como fechamento.
              </div>
            )}

            <section className="grid gap-3 lg:grid-cols-2">
              <ShiftCard title="Turno atual" summary={data.currentShift} emphasis />
              <ShiftCard title="Último turno" summary={data.previousShift} />
            </section>

            <section id="qualidade-dados" className="scroll-mt-24 rounded-xl border border-sky-400/15 bg-sky-400/[0.035] px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-100/45">
                Qualidade dos dados
              </div>
              <div className="mt-1 text-sm text-white/65">
                A Gestão conta uma alta apenas uma vez usando{" "}
                <strong className="text-white/85">
                  unidade + leito + minuto de início registrado pelo Listo
                </strong>
                . Nesta amostra, {data.rawTerminalRecords} linhas elegíveis foram consolidadas em{" "}
                {data.totalSample} Altas. {data.excludedRecords} registros de unidades excluídas
                ficaram fora da análise de leitos.
              </div>
              <div className="mt-1 text-xs text-white/35">
                Período:{" "}
                {new Date(data.periodStart).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}{" "}
                até{" "}
                {new Date(data.periodEnd).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
                . Unidades excluídas: 3D, 3C, 12C, 5B, 9C e 13C. Tempos “Registro → início” usam o
                horário de origem do Listo; eles não são apresentados como horário clínico de alta.
              </div>
            </section>

            <ManagementSectionHeader
              id="altas"
              eyebrow="Higiene terminal"
              title="Altas"
              description="Volume, tempos, distribuição e auditoria das Altas no período recente."
            />
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                icon={<Activity className="h-4 w-4" />}
                label="Altas únicas analisadas"
                value={String(data.totalSample)}
                detail={`${data.rawTerminalRecords} registros elegíveis consolidados`}
              />
              <Metric
                icon={<Clock3 className="h-4 w-4" />}
                label="Horário de maior volume"
                value={data.peakHour == null ? "—" : `${String(data.peakHour).padStart(2, "0")}:00`}
                detail={data.peakCount ? `${data.peakCount} altas na faixa` : "sem dados"}
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
                value={
                  data.currentShift.avgWaitMin == null ? "—" : `${data.currentShift.avgWaitMin} min`
                }
                detail="usa horário registrado pelo Listo"
              />
            </section>

            <section className="panel-surface rounded-xl border p-4">
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
                  <div
                    key={x.hour}
                    className="rounded-lg border border-white/10 bg-black/10 px-3 py-3"
                  >
                    <div className="text-xs uppercase tracking-wide text-white/40">
                      {String(x.hour).padStart(2, "0")}:00–
                      {String((x.hour + 1) % 24).padStart(2, "0")}:00
                    </div>
                    <div className="mt-1 text-3xl font-bold tabular-nums">{x.expected}</div>
                    <div className="text-xs text-white/40">altas iniciadas pela média recente</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Altas de higiene terminal — últimos 7 dias">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartDays}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar
                      dataKey="total"
                      name="Altas iniciadas"
                      fill="oklch(0.74 0.18 230)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="completed"
                      name="Concluídas"
                      fill="oklch(0.72 0.17 155)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Tempos das Altas por dia — minutos">
                <p className="mb-3 text-xs text-white/60">
                  Laranja: registro Listo → início, agrupado pelo dia de início. Verde: início →
                  fim, agrupado pelo dia de conclusão. Não mede a saída do paciente nem o
                  deslocamento. Dias sem duração válida ficam sem ponto.
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartDays}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} unit=" min" width={65} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line
                      type="monotone"
                      dataKey="avgWaitMin"
                      name="Registro → início"
                      stroke="oklch(0.78 0.2 60)"
                      strokeWidth={2}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgExecutionMin"
                      name="Execução"
                      stroke="oklch(0.72 0.17 155)"
                      strokeWidth={2}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/60">
                  {data.days.map((d) => (
                    <span key={d.date}>
                      {d.date.slice(5)}: registro n={d.waitSamples}; execução n={d.executionSamples}
                    </span>
                  ))}
                </div>
              </ChartCard>
            </section>

            <section className="panel-surface rounded-xl border p-4">
              <div className="mb-3">
                <h2 className="font-bold">Mapa de calor por dia e horário</h2>
                <p className="text-xs text-white/40">
                  Quanto mais forte a célula, maior o volume observado na amostra recente.
                </p>
              </div>
              <div className="scrollbar-hidden overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[46px_repeat(24,minmax(24px,1fr))] gap-1 text-[9px] text-white/35">
                    <span />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="text-center">
                        {h}
                      </span>
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

            <section className="panel-surface rounded-xl border p-4">
              <h2 className="mb-3 font-bold">Desempenho por bloco</h2>
              <div className="scrollbar-hidden overflow-x-auto">
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
                        <td className="py-2 font-semibold">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
                            style={{
                              color: BLOCK_COLOR[b.block] ?? "currentColor",
                              borderColor: (BLOCK_COLOR[b.block] ?? "oklch(0.6 0.03 255)").replace(
                                ")",
                                " / 0.45)",
                              ),
                              backgroundColor: (
                                BLOCK_COLOR[b.block] ?? "oklch(0.6 0.03 255)"
                              ).replace(")", " / 0.10)"),
                            }}
                          >
                            Bloco {b.block}
                          </span>
                        </td>
                        <td className="py-2 tabular-nums">{b.total}</td>
                        <td className="py-2 tabular-nums">{b.completed}</td>
                        <td className="py-2 tabular-nums">
                          {b.avgWaitMin == null ? "—" : `${b.avgWaitMin} min`}
                        </td>
                        <td className="py-2 tabular-nums">
                          {b.avgExecutionMin == null ? "—" : `${b.avgExecutionMin} min`}
                        </td>
                        <td className="py-2 tabular-nums">
                          {b.withinTargetPct == null ? "—" : `${b.withinTargetPct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel-surface rounded-xl border p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-bold">Auditoria das Altas recentes</h2>
                  <p className="text-xs text-white/40">
                    As mesmas Altas únicas usadas nos indicadores acima. Esta tabela permite
                    conferir leito por leito.
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-white/30">
                  {data.recentCycles.length} Altas no período
                </span>
              </div>
              <div className="scrollbar-hidden max-h-[420px] overflow-auto rounded-lg border border-white/[0.06]">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="sticky top-0 bg-[oklch(0.18_0.025_265)] text-left text-[10px] uppercase tracking-wide text-white/35">
                    <tr>
                      <th className="px-3 py-2">IDs Listo</th>
                      <th className="px-3 py-2">Leito</th>
                      <th className="px-3 py-2">Bloco</th>
                      <th className="px-3 py-2">Início</th>
                      <th className="px-3 py-2">Conclusão</th>
                      <th className="px-3 py-2">Execução</th>
                      <th className="px-3 py-2">Reg. → início</th>
                      <th className="px-3 py-2">Colaborador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCycles.map((cycle) => (
                      <tr key={cycle.key} className="border-t border-white/[0.05]">
                        <td className="px-3 py-2 text-xs">{cycle.answerIds.join(", ")}</td>
                        <td className="px-3 py-2 font-semibold" title={cycle.unit}>
                          {cycle.bed}
                        </td>
                        <td className="px-3 py-2">
                          {cycle.block === "Outro" ? (
                            <span className="text-white/45">—</span>
                          ) : (
                            <span
                              className="inline-flex min-w-7 justify-center rounded-md border px-1.5 py-0.5 font-semibold"
                              style={{
                                color: BLOCK_COLOR[cycle.block] ?? "currentColor",
                                borderColor: (
                                  BLOCK_COLOR[cycle.block] ?? "oklch(0.6 0.03 255)"
                                ).replace(")", " / 0.45)"),
                                backgroundColor: (
                                  BLOCK_COLOR[cycle.block] ?? "oklch(0.6 0.03 255)"
                                ).replace(")", " / 0.10)"),
                              }}
                            >
                              {cycle.block}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">
                          {new Date(cycle.startedAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-white/65">
                          {cycle.completedAt
                            ? new Date(cycle.completedAt).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "America/Sao_Paulo",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-white/65">
                          {cycle.executionMin == null ? "—" : `${cycle.executionMin} min`}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-white/65">
                          {cycle.waitMin == null ? "—" : `${cycle.waitMin} min`}
                        </td>
                        <td
                          className="max-w-[220px] truncate px-3 py-2 text-white/60"
                          title={cycle.staff ?? ""}
                        >
                          {cycle.staff ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="colaboradores" className="panel-surface scroll-mt-24 rounded-xl border p-4">
              <h2 className="font-bold">Produtividade de colaboradores</h2>
              <p className="mt-1 text-xs text-white/60">
                Mesmo período e exclusões das Altas. Volumes de execuções únicas iniciadas;
                conclusões pertencem a essas execuções. Sem ranking de velocidade: blocos e tipos de
                leito têm complexidades diferentes. A ordem dos cards prioriza volume de conclusões,
                não um ranking de qualidade.
              </p>
              <p className="mt-2 text-xs text-amber-100">
                A caminho → início: indisponível no histórico Listo. O horário de registro não
                comprova quando o colaborador foi alocado. Tempos inválidos ou ausentes não entram
                na média: execução até 6h; registro até 12h. Pausados e manutenção não contam como
                concluídos. Nomes divergentes ficam em grupo separado.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.staffProductivity.map((person) => (
                  <article
                    key={person.name}
                    className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-3"
                  >
                    <h3 className="break-words font-semibold">{person.name}</h3>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-white/60">Altas iniciadas / concluídas</dt>
                        <dd className="font-bold">
                          {person.altas} / {person.completed}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Desmontagens / concluídas</dt>
                        <dd className="font-bold">
                          {person.dismantles} / {person.dismantlesCompleted}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Execução média / mediana</dt>
                        <dd>
                          {person.avgExecutionMin ?? "—"} / {person.medianExecutionMin ?? "—"} min
                        </dd>
                        <small className="text-white/60">n={person.executionSamples}</small>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Desmontagem média</dt>
                        <dd>{person.avgDismantleMin ?? "—"} min</dd>
                        <small className="text-white/60">n={person.dismantleSamples}</small>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Registro → início médio</dt>
                        <dd>{person.avgRegistrationMin ?? "—"} min</dd>
                        <small className="text-white/60">n={person.registrationSamples}</small>
                      </div>
                      <div>
                        <dt className="text-xs text-white/60">Dentro da meta do leito</dt>
                        <dd>
                          {person.withinTargetPct == null ? "—" : `${person.withinTargetPct}%`}
                        </dd>
                        <small className="text-white/60">
                          base: {person.executionSamples} durações válidas
                        </small>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-white/60">
                      {person.activeDays} dia(s) com atividade · última:{" "}
                      {new Date(person.lastActivity).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </p>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-white/60">
                        Conferir atividades e IDs de origem
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {data.staffActivity
                          .filter((x) => (x.staff || "Sem colaborador informado") === person.name)
                          .map((x) => (
                            <li className="break-words" key={x.key}>
                              {x.kind === "alta" ? "Alta" : "Desmontagem"} · {x.bed} · {x.unit} ·{" "}
                              {new Date(x.startedAt).toLocaleString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                              })}{" "}
                              · IDs {x.answerIds.join(", ")}
                            </li>
                          ))}
                      </ul>
                    </details>
                  </article>
                ))}
              </div>
              {!data.staffProductivity.length && (
                <p className="mt-3 text-sm text-white/60">Nenhuma execução elegível no período.</p>
              )}
            </section>

              </>
            )}

            {dailyError && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/80">
                {dailyError} As métricas de Altas acima continuam independentes.
              </div>
            )}

            {dailyData && (
              <>
                <ManagementSectionHeader
                  id="higiene-diaria"
                  eyebrow="Rotina diária"
                  title="Higiene Diária"
                  description="Cobertura, comparação histórica, produtividade e fechamento de turnos da Concorrente e Camareira."
                />
                <section className="panel-surface rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
                        Higiene Diária
                      </div>
                      <h2 className="mt-1 text-lg font-bold">Cobertura no mesmo ponto do turno</h2>
                      <p className="mt-1 max-w-3xl text-xs text-white/50">
                        Reconstrói o avanço de Concorrente e Camareira a partir dos registros do Listo
                        e compara com a média dos seis dias anteriores no mesmo minuto relativo do
                        turno. É referência histórica, não SLA oficial.
                      </p>
                      <p className="mt-1 max-w-3xl text-[11px] text-white/35">
                        A reconstrução histórica usa o cadastro e as exclusões fixas da Diária. A
                        exclusão dinâmica de leitos com Alta terminal ativa pertence ao mapa ao vivo
                        e pode fazer o percentual da Diária diferir levemente desta leitura histórica.
                      </p>
                    </div>
                    <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] uppercase tracking-wide text-white/45">
                      {dailyData.currentShiftLabel}
                    </span>
                  </div>

                  {dailyData.samplePartial && (
                    <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-100/80">
                      A amostra histórica da Diária está parcial. Use os números como leitura
                      operacional, não como fechamento oficial.
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric
                      icon={<BrushCleaning className="h-4 w-4" />}
                      label="Concorrente · turno atual"
                      value={`${dailyData.currentConcurrentPct}%`}
                      detail={
                        dailyData.historicalConcurrentPct == null
                          ? "sem base histórica comparável"
                          : `média recente neste ponto: ${dailyData.historicalConcurrentPct}%`
                      }
                    />
                    <Metric
                      icon={<BedDouble className="h-4 w-4" />}
                      label="Camareira · turno atual"
                      value={`${dailyData.currentCamareiraPct}%`}
                      detail={
                        dailyData.historicalCamareiraPct == null
                          ? "sem base histórica comparável"
                          : `média recente neste ponto: ${dailyData.historicalCamareiraPct}%`
                      }
                    />
                    <Metric
                      icon={<Activity className="h-4 w-4" />}
                      label="Rotinas únicas analisadas"
                      value={String(dailyData.uniqueRoutines)}
                      detail="amostra histórica consolidada"
                    />
                    <Metric
                      icon={<Clock3 className="h-4 w-4" />}
                      label="Janela atual"
                      value={dailyData.currentShiftLabel}
                      detail={`${new Date(dailyData.currentShiftStart).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })} → ${new Date(dailyData.currentShiftEnd).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })}`}
                    />
                  </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-2">
                  <ChartCard title="Concorrente — avanço do turno">
                    <p className="mb-3 text-xs text-white/50">
                      Hoje/turno atual versus média dos seis dias anteriores no mesmo ponto.
                    </p>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={dailyData.coverageTrend}>
                        <CartesianGrid stroke={chartGrid} vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: chartTick, fontSize: 11 }}
                          unit="%"
                          width={45}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line
                          type="monotone"
                          dataKey="currentConcurrentPct"
                          name="Turno atual"
                          stroke="oklch(0.65 0.20 240)"
                          strokeWidth={3}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="historicalConcurrentPct"
                          name="Média recente"
                          stroke="oklch(0.66 0.06 240)"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  <ChartCard title="Camareira — avanço do turno">
                    <p className="mb-3 text-xs text-white/50">
                      Mesma comparação temporal, sem transformar a média histórica em meta.
                    </p>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={dailyData.coverageTrend}>
                        <CartesianGrid stroke={chartGrid} vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: chartTick, fontSize: 11 }}
                          unit="%"
                          width={45}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line
                          type="monotone"
                          dataKey="currentCamareiraPct"
                          name="Turno atual"
                          stroke="oklch(0.72 0.18 60)"
                          strokeWidth={3}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="historicalCamareiraPct"
                          name="Média recente"
                          stroke="oklch(0.66 0.07 60)"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </section>

                <section className="panel-surface rounded-xl border p-4">
                  <div>
                    <h2 className="font-bold">Produtividade — Higiene Diária</h2>
                    <p className="mt-1 text-xs text-white/50">
                      Concorrente e Camareira ficam separadas das Altas. A duração só entra nas
                      médias quando há início e conclusão válidos; volume não é usado sozinho como
                      ranking de qualidade. A ordem prioriza volume de atividade, não velocidade.
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {dailyData.staffProductivity.map((person) => (
                      <article
                        key={person.name}
                        className="rounded-lg border border-white/10 bg-black/10 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="min-w-0 break-words font-semibold">{person.name}</h3>
                          <span className="shrink-0 text-[10px] text-white/35">
                            {person.activeDays} dia(s)
                          </span>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt className="text-[10px] uppercase text-white/40">Concorrentes</dt>
                            <dd className="text-xl font-bold tabular-nums">{person.concorrentes}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase text-white/40">Camareiras</dt>
                            <dd className="text-xl font-bold tabular-nums">{person.camareiras}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-white/50">Média concorrente</dt>
                            <dd>{person.avgConcurrentMin == null ? "—" : `${person.avgConcurrentMin} min`}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-white/50">Média camareira</dt>
                            <dd>{person.avgCamareiraMin == null ? "—" : `${person.avgCamareiraMin} min`}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-white/50">Média / mediana geral</dt>
                            <dd>
                              {person.avgDurationMin ?? "—"} / {person.medianDurationMin ?? "—"} min
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-white/50">Durações válidas</dt>
                            <dd>{person.durationSamples}</dd>
                          </div>
                        </dl>
                        <p className="mt-3 text-[10px] text-white/35">
                          Última atividade:{" "}
                          {new Date(person.lastActivity).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })}
                        </p>
                      </article>
                    ))}
                  </div>
                  {!dailyData.staffProductivity.length && (
                    <p className="mt-3 text-sm text-white/50">
                      Nenhuma rotina diária elegível encontrada na amostra.
                    </p>
                  )}
                </section>

                <section className="panel-surface rounded-xl border p-4">
                  <div>
                    <h2 className="font-bold">Fechamentos automáticos da Diária</h2>
                    <p className="mt-1 text-xs text-white/50">
                      Reconstituição dos últimos seis turnos concluídos com base nas rotinas únicas
                      registradas em cada janela. Os percentuais usam o cadastro e as exclusões fixas
                      da Diária; leitos com Alta ativa não são descontados retroativamente.
                    </p>
                  </div>
                  <div className="scrollbar-hidden mt-3 flex gap-3 overflow-x-auto pb-1">
                    {dailyData.shiftClosures.map((shift) => (
                      <article
                        key={shift.key}
                        className="min-w-[280px] flex-1 rounded-lg border border-white/10 bg-black/10 p-3 sm:min-w-[330px]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/40">
                              {new Date(shift.start).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                timeZone: "America/Sao_Paulo",
                              })}
                            </div>
                            <h3 className="font-bold">{shift.label}</h3>
                          </div>
                          <span className="font-mono text-[10px] text-white/40">
                            {new Date(shift.start).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "America/Sao_Paulo",
                            })}
                            {" → "}
                            {new Date(shift.end).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "America/Sao_Paulo",
                            })}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-md border border-sky-400/15 bg-sky-400/[0.05] p-2">
                            <div className="text-[10px] uppercase text-white/40">Concorrente</div>
                            <div className="text-xl font-bold">{shift.concurrentPct}%</div>
                            <div className="text-[10px] text-white/40">
                              {shift.concurrentDone}/{shift.concurrentEligible}
                            </div>
                          </div>
                          <div className="rounded-md border border-amber-400/15 bg-amber-400/[0.05] p-2">
                            <div className="text-[10px] uppercase text-white/40">Camareira</div>
                            <div className="text-xl font-bold">{shift.camareiraPct}%</div>
                            <div className="text-[10px] text-white/40">
                              {shift.camareiraDone}/{shift.camareiraEligible}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {shift.blocks.map((block) => (
                            <span
                              key={block.block}
                              className="rounded-md border px-1.5 py-1 text-[10px]"
                              title={`Concorrente ${block.concurrentPct}% · Camareira ${block.camareiraPct}%`}
                              style={{
                                color: BLOCK_COLOR[block.block] ?? "currentColor",
                                borderColor: (
                                  BLOCK_COLOR[block.block] ?? "oklch(0.6 0.03 255)"
                                ).replace(")", " / 0.4)"),
                                backgroundColor: (
                                  BLOCK_COLOR[block.block] ?? "oklch(0.6 0.03 255)"
                                ).replace(")", " / 0.08)"),
                              }}
                            >
                              {block.block}: C {block.concurrentPct}% · M {block.camareiraPct}%
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          <div className="panel-state flex min-h-[50vh] items-center justify-center rounded-xl px-4 text-center text-sm text-white/45">
            {loading
              ? "Carregando histórico operacional…"
              : "Nenhuma análise está disponível agora. Tente atualizar novamente."}
          </div>
        )}
      </main>
    </div>
  );
}

function ManagementSectionHeader({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div id={id} className="scroll-mt-24 pt-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {eyebrow}
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="max-w-2xl text-xs leading-relaxed text-white/45">{description}</p>
      </div>
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
    <div className="panel-surface rounded-xl border p-3">
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
          {new Date(summary.start).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          })}
          {" → "}
          {new Date(summary.end).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Altas iniciadas" value={summary.total} />
        <Mini label="Conclusões no turno" value={summary.completed} />
        <Mini
          label="Reg. → início"
          value={summary.avgWaitMin == null ? "—" : `${summary.avgWaitMin}m`}
        />
        <Mini
          label="Execução"
          value={summary.avgExecutionMin == null ? "—" : `${summary.avgExecutionMin}m`}
        />
        <Mini
          label="Meta execução"
          value={summary.withinTargetPct == null ? "—" : `${summary.withinTargetPct}%`}
        />
      </div>
      <div className="mt-3 rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-xs leading-relaxed text-white/45">
        Resumo automático: {summary.total} altas iniciadas e {summary.completed} conclusões dentro
        da janela do turno
        {summary.avgExecutionMin == null
          ? ""
          : `, execução média de ${summary.avgExecutionMin} min`}
        {summary.withinTargetPct == null
          ? ""
          : ` e ${summary.withinTargetPct}% dentro da meta de execução`}
        .
        {summary.peakHour == null
          ? ""
          : ` Pico às ${String(summary.peakHour).padStart(2, "0")}:00, com ${summary.peakCount} altas iniciadas na faixa.`}
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
    <section className="panel-surface rounded-xl border p-4">
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
