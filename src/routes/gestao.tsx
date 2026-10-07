import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BedDouble,
  BrushCleaning,
  CheckCircle2,
  Clock3,
  Gauge,
  RefreshCw,
  Search,
  TimerReset,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
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
  type DailyShiftClosure,
} from "@/lib/dailyAnalytics.functions";

export const Route = createFileRoute("/gestao")({
  head: () => ({
    meta: [
      { title: "Gestão — Painel de Higienização" },
      {
        name: "description",
        content: "Gestão de Altas, Higiene Diária e produtividade operacional.",
      },
    ],
  }),
  component: GestaoPage,
});

type ManagementView = "overview" | "daily" | "altas" | "alta-productivity";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_LONG = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

const BLOCK_COLOR: Record<string, string> = {
  D: "oklch(0.66 0.20 145)",
  E: "oklch(0.62 0.22 300)",
  C: "oklch(0.64 0.20 245)",
  B: "oklch(0.63 0.23 25)",
};

function GestaoPage() {
  const { isDark, themeClass, toggleTheme } = usePanelTheme();
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [dailyData, setDailyData] = useState<DailyOperationsAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ManagementView>("overview");
  const [staffSearch, setStaffSearch] = useState("");
  const [showAllDailyStaff, setShowAllDailyStaff] = useState(false);

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
      setError("Os indicadores de Altas estão indisponíveis agora.");
    }

    if (dailyResult.status === "fulfilled") {
      setDailyData(dailyResult.value);
      setDailyError(null);
    } else {
      console.error(dailyResult.reason);
      setDailyError("Os indicadores da Higiene Diária estão indisponíveis agora.");
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

  const chartDays = useMemo(
    () =>
      (data?.days ?? []).map((day) => ({
        ...day,
        label: formatDate(day.date),
      })),
    [data],
  );

  const averageDailyAltas = useMemo(() => {
    if (!chartDays.length) return null;
    return Math.round(
      (chartDays.reduce((sum, day) => sum + day.total, 0) / chartDays.length) * 10,
    ) / 10;
  }, [chartDays]);

  const maxHeat = useMemo(
    () => Math.max(0.1, ...(data?.weekdayHour.map((item) => item.average) ?? [0.1])),
    [data],
  );

  const terminalStaff = useMemo(() => {
    const rows = data?.staffProductivity ?? [];
    const query = normalize(staffSearch);
    return rows.filter((person) => {
      const reliable =
        person.name !== "Sem colaborador informado" &&
        person.name !== "Atribuição divergente";
      return reliable && (!query || normalize(person.name).includes(query));
    });
  }, [data, staffSearch]);

  const dailyStaff = useMemo(
    () => (dailyData?.staffProductivity ?? []).filter((person) => person.completed > 0),
    [dailyData],
  );

  const updatedAt = [data?.generatedAt, dailyData?.generatedAt]
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);

  const views: Array<{ key: ManagementView; label: string; enabled: boolean }> = [
    { key: "overview", label: "Visão Geral", enabled: !!data || !!dailyData },
    { key: "daily", label: "Higiene Diária", enabled: !!dailyData },
    { key: "altas", label: "Altas", enabled: !!data },
    { key: "alta-productivity", label: "Produtividade de Altas", enabled: !!data },
  ];

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
              Leitura gerencial · atualização automática a cada 5 minutos
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

      <main className="mx-auto w-full max-w-[1680px] space-y-4 px-4 py-4 lg:px-6">
        {(error || dailyError) && (
          <div className="grid gap-2 md:grid-cols-2">
            {error && <StatusMessage tone="error">{error}</StatusMessage>}
            {dailyError && <StatusMessage tone="warning">{dailyError}</StatusMessage>}
          </div>
        )}

        {(data || dailyData) && (
          <div className="panel-management-nav scrollbar-hidden flex gap-1 overflow-x-auto rounded-xl border p-1">
            {views
              .filter((item) => item.enabled)
              .map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setView(item.key)}
                  aria-pressed={view === item.key}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    view === item.key
                      ? "border-sky-400/35 bg-sky-400/10 text-sky-100"
                      : "panel-management-link"
                  }`}
                >
                  {item.label}
                </button>
              ))}
          </div>
        )}

        {!data && !dailyData ? (
          <div className="panel-state flex min-h-[55vh] items-center justify-center rounded-xl px-4 text-center text-sm text-white/45">
            {loading
              ? "Carregando indicadores de Gestão…"
              : "Nenhum indicador está disponível agora. Tente atualizar novamente."}
          </div>
        ) : (
          <>
            {view === "overview" && (
              <Overview
                data={data}
                dailyData={dailyData}
                updatedAt={updatedAt}
                onOpenDaily={() => setView("daily")}
                onOpenAltas={() => setView("altas")}
              />
            )}

            {view === "daily" && dailyData && (
              <DailyManagement
                data={dailyData}
                chartGrid={chartGrid}
                chartTick={chartTick}
                tooltipStyle={tooltipStyle}
                staff={dailyStaff}
                showAllStaff={showAllDailyStaff}
                onToggleStaff={() => setShowAllDailyStaff((value) => !value)}
              />
            )}

            {view === "altas" && data && (
              <AltasManagement
                data={data}
                chartDays={chartDays}
                averageDailyAltas={averageDailyAltas}
                chartGrid={chartGrid}
                chartTick={chartTick}
                tooltipStyle={tooltipStyle}
                maxHeat={maxHeat}
              />
            )}

            {view === "alta-productivity" && data && (
              <AltaProductivity
                rows={terminalStaff}
                search={staffSearch}
                onSearch={setStaffSearch}
                periodStart={data.periodStart}
                periodEnd={data.periodEnd}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Overview({
  data,
  dailyData,
  updatedAt,
  onOpenDaily,
  onOpenAltas,
}: {
  data: OperationsAnalytics | null;
  dailyData: DailyOperationsAnalytics | null;
  updatedAt?: string;
  onOpenDaily: () => void;
  onOpenAltas: () => void;
}) {
  const avgWaitPeriod = averageNullable(chartDays.map((day) => day.avgWaitMin));
  const avgExecutionPeriod = averageNullable(chartDays.map((day) => day.avgExecutionMin));

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Visão Geral"
        title="Situação operacional"
        description="Os números essenciais para acompanhar o turno sem entrar nos detalhes técnicos."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {data && (
          <>
            <Metric
              icon={<Activity className="h-4 w-4" />}
              label="Altas do turno"
              value={String(data.currentShift.total)}
              detail={`Último turno: ${data.previousShift.total}`}
            />
            <Metric
              icon={<TimerReset className="h-4 w-4" />}
              label="Tempo para iniciar Alta"
              value={
                data.currentShift.avgWaitMin == null
                  ? "—"
                  : `${data.currentShift.avgWaitMin} min`
              }
              detail="média do turno atual"
            />
            <Metric
              icon={<Gauge className="h-4 w-4" />}
              label="Tempo de execução"
              value={
                data.currentShift.avgExecutionMin == null
                  ? "—"
                  : `${data.currentShift.avgExecutionMin} min`
              }
              detail="média do turno atual"
            />
          </>
        )}
        {dailyData && (
          <>
            <Metric
              icon={<BrushCleaning className="h-4 w-4" />}
              label="Concorrente"
              value={`${dailyData.currentConcurrentPct}%`}
              detail={`turno ${dailyData.currentShiftLabel.toLowerCase()}`}
            />
            {dailyData.currentCamareiraApplicable && (
              <Metric
                icon={<BedDouble className="h-4 w-4" />}
                label="Camareira"
                value={`${dailyData.currentCamareiraPct}%`}
                detail="cobertura do turno da tarde"
              />
            )}
          </>
        )}
      </section>

      {data && (
        <section className="grid gap-3 lg:grid-cols-2">
          <SimpleShiftCard title="Turno atual" summary={data.currentShift} />
          <SimpleShiftCard title="Último turno" summary={data.previousShift} />
        </section>
      )}

      <section className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
        <div className="panel-surface rounded-xl border p-4">
          <h2 className="font-bold">Acesso rápido</h2>
          <p className="mt-1 text-xs text-white/45">
            Aprofunde somente quando precisar investigar uma rotina.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {dailyData && (
              <button
                type="button"
                onClick={onOpenDaily}
                className="rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-3 py-2 text-sm font-semibold hover:bg-sky-400/10"
              >
                Abrir Higiene Diária
              </button>
            )}
            {data && (
              <button
                type="button"
                onClick={onOpenAltas}
                className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2 text-sm font-semibold hover:bg-emerald-400/10"
              >
                Abrir análise de Altas
              </button>
            )}
          </div>
        </div>

        <DataStatusCard data={data} dailyData={dailyData} updatedAt={updatedAt} />
      </section>
    </div>
  );
}

function DailyManagement({
  data,
  chartGrid,
  chartTick,
  tooltipStyle,
  staff,
  showAllStaff,
  onToggleStaff,
}: {
  data: DailyOperationsAnalytics;
  chartGrid: string;
  chartTick: string;
  tooltipStyle: React.CSSProperties;
  staff: DailyOperationsAnalytics["staffProductivity"];
  showAllStaff: boolean;
  onToggleStaff: () => void;
}) {
  const visibleStaff = showAllStaff ? staff : staff.slice(0, 8);

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Higiene Diária"
        title="Cobertura e equipe"
        description="Acompanhamento da Concorrente e, no turno da tarde, da rotina de Camareira."
      />

      {data.samplePartial && (
        <StatusMessage tone="warning">
          Parte do histórico da Diária não pôde ser lida. Os valores abaixo devem ser tratados como
          parciais.
        </StatusMessage>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<BrushCleaning className="h-4 w-4" />}
          label="Concorrente agora"
          value={`${data.currentConcurrentPct}%`}
          detail={
            data.historicalConcurrentPct == null
              ? "sem comparação disponível"
              : `média recente neste ponto: ${data.historicalConcurrentPct}%`
          }
        />
        {data.currentCamareiraApplicable && (
          <Metric
            icon={<BedDouble className="h-4 w-4" />}
            label="Camareira agora"
            value={`${data.currentCamareiraPct}%`}
            detail={
              data.historicalCamareiraPct == null
                ? "sem comparação disponível"
                : `média recente neste ponto: ${data.historicalCamareiraPct}%`
            }
          />
        )}
        <Metric
          icon={<Clock3 className="h-4 w-4" />}
          label="Turno"
          value={data.currentShiftLabel}
          detail={formatTimeWindow(data.currentShiftStart, data.currentShiftEnd)}
        />
      </section>

      <section className={`grid gap-4 ${data.currentCamareiraApplicable ? "xl:grid-cols-2" : ""}`}>
        <ChartCard title="Cobertura da Concorrente">
          <ChartKey
            items={[
              ["Turno atual", "oklch(0.65 0.20 240)"],
              ["Média recente", "oklch(0.66 0.06 240)"],
            ]}
          />
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.coverageTrend}>
              <CartesianGrid stroke={chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: chartTick, fontSize: 11 }} unit="%" width={45} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="currentConcurrentPct"
                name="Turno atual"
                stroke="oklch(0.65 0.20 240)"
                strokeWidth={3}
                dot={false}
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

        {data.currentCamareiraApplicable && (
          <ChartCard title="Cobertura da Camareira">
            <ChartKey
              items={[
                ["Turno atual", "oklch(0.72 0.18 60)"],
                ["Média recente", "oklch(0.66 0.07 60)"],
              ]}
            />
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.coverageTrend}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: chartTick, fontSize: 11 }} unit="%" width={45} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="currentCamareiraPct"
                  name="Turno atual"
                  stroke="oklch(0.72 0.18 60)"
                  strokeWidth={3}
                  dot={false}
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
        )}
      </section>

      <section className="panel-surface rounded-xl border p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">Produtividade da Diária</h2>
            <p className="mt-1 text-xs text-white/45">
              Atividades concluídas com colaborador identificado nos últimos 7 dias.
            </p>
          </div>
          {staff.length > 8 && (
            <button
              type="button"
              onClick={onToggleStaff}
              className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/55 hover:bg-white/10"
            >
              {showAllStaff ? "Mostrar menos" : `Ver todos (${staff.length})`}
            </button>
          )}
        </div>
        <div className="scrollbar-hidden mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="py-2 pr-3">Colaborador</th>
                <th className="py-2 pr-3">Concorrentes</th>
                <th className="py-2 pr-3">Camareiras</th>
                <th className="py-2 pr-3">Média Concorrente</th>
                <th className="py-2 pr-3">Média Camareira</th>
                <th className="py-2">Dias ativos</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaff.map((person) => (
                <tr key={person.name} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-3 font-semibold">{person.name}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{person.concorrentes}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{person.camareiras}</td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {person.avgConcurrentMin == null ? "—" : `${person.avgConcurrentMin} min`}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {person.avgCamareiraMin == null ? "—" : `${person.avgCamareiraMin} min`}
                  </td>
                  <td className="py-2.5 tabular-nums">{person.activeDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!staff.length && (
          <div className="panel-state mt-3 rounded-lg px-3 py-5 text-center text-sm text-white/45">
            Nenhuma atividade concluída com colaborador identificado no período.
          </div>
        )}
      </section>

      <section className="panel-surface rounded-xl border p-4">
        <div>
          <h2 className="font-bold">Fechamento dos últimos turnos</h2>
          <p className="mt-1 text-xs text-white/45">
            Cada rotina é atribuída ao turno em que começou. Camareira é avaliada somente à tarde.
          </p>
        </div>
        <div className="scrollbar-hidden mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3">Turno</th>
                <th className="py-2 pr-3">Horário</th>
                <th className="py-2 pr-3">Concorrente</th>
                <th className="py-2 pr-3">Camareira</th>
                <th className="py-2">Blocos</th>
              </tr>
            </thead>
            <tbody>
              {data.shiftClosures.map((shift) => (
                <DailyClosureRow key={shift.key} shift={shift} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AltasManagement({
  data,
  chartDays,
  averageDailyAltas,
  chartGrid,
  chartTick,
  tooltipStyle,
  maxHeat,
}: {
  data: OperationsAnalytics;
  chartDays: Array<OperationsAnalytics["days"][number] & { label: string }>;
  averageDailyAltas: number | null;
  chartGrid: string;
  chartTick: string;
  tooltipStyle: React.CSSProperties;
  maxHeat: number;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Altas"
        title="Volume e tempos"
        description="Quantidade de Altas, tempo para iniciar e tempo de execução."
      />

      {data.samplePartial && (
        <StatusMessage tone="warning">
          A consulta histórica está parcial. Previsões e médias podem estar abaixo do volume real.
        </StatusMessage>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<Activity className="h-4 w-4" />}
          label="Altas do turno"
          value={String(data.currentShift.total)}
          detail={`último turno: ${data.previousShift.total}`}
        />
        <Metric
          icon={<TimerReset className="h-4 w-4" />}
          label="Tempo para iniciar Alta"
          value={
            data.currentShift.avgWaitMin == null ? "—" : `${data.currentShift.avgWaitMin} min`
          }
          detail="média do turno atual"
        />
        <Metric
          icon={<Gauge className="h-4 w-4" />}
          label="Tempo de execução"
          value={
            data.currentShift.avgExecutionMin == null
              ? "—"
              : `${data.currentShift.avgExecutionMin} min`
          }
          detail="média do turno atual"
        />
        <Metric
          icon={<Clock3 className="h-4 w-4" />}
          label="Horário mais carregado"
          value={data.peakHour == null ? "—" : `${padHour(data.peakHour)}h`}
          detail={
            data.peakAverage == null
              ? "sem histórico suficiente"
              : `média de ${formatDecimal(data.peakAverage)} Altas/h`
          }
        />
      </section>

      <section className="panel-surface rounded-xl border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold">Próximas horas — média histórica de Altas</h2>
            <p className="mt-1 text-xs text-white/45">
              Baseada no horário em que a Alta foi registrada, comparando o mesmo dia da semana nos últimos {data.historyDays} dias completos.
            </p>
          </div>
          <CheckCircle2 className="h-4 w-4 text-emerald-300" />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {data.forecast.map((item) => (
            <div key={`${item.weekday}-${item.hour}`} className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                {WEEKDAYS[item.weekday]} · {padHour(item.hour)}:00–{padHour((item.hour + 1) % 24)}:00
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums">
                {formatDecimal(item.expected)}
              </div>
              <div className="text-xs text-white/45">
                Altas em média · base: {item.samples} {weekdayPlural(item.weekday, item.samples)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Altas por dia">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
            <span>Uma barra = total de Altas daquele dia.</span>
            {averageDailyAltas != null && <strong>Média: {formatDecimal(averageDailyAltas)}/dia</strong>}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartDays}>
              <CartesianGrid stroke={chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
              <YAxis tick={{ fill: chartTick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="total" name="Altas" fill="oklch(0.68 0.17 230)" radius={[5, 5, 0, 0]} />
              {averageDailyAltas != null && (
                <ReferenceLine
                  y={averageDailyAltas}
                  stroke="oklch(0.72 0.08 230)"
                  strokeDasharray="5 5"
                  label={{ value: "média", fill: chartTick, fontSize: 10 }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tempos das Altas por dia">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/80">
                Tempo para iniciar
              </div>
              <div className="mt-0.5 text-xl font-bold tabular-nums">
                {avgWaitPeriod == null ? "—" : `${avgWaitPeriod} min`}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
                Tempo de execução
              </div>
              <div className="mt-0.5 text-xl font-bold tabular-nums">
                {avgExecutionPeriod == null ? "—" : `${avgExecutionPeriod} min`}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartDays}>
              <CartesianGrid stroke={chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chartTick, fontSize: 11 }} />
              <YAxis tick={{ fill: chartTick, fontSize: 11 }} unit=" min" width={65} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="avgWaitMin"
                name="Tempo para iniciar"
                stroke="oklch(0.78 0.2 60)"
                strokeWidth={3}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="avgExecutionMin"
                name="Tempo de execução"
                stroke="oklch(0.72 0.17 155)"
                strokeWidth={3}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <section className="panel-surface rounded-xl border p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">Quando as Altas costumam sair</h2>
            <p className="mt-1 text-xs text-white/45">
              Média pelo horário de registro da Alta · últimos {data.historyDays} dias completos · mesma faixa e mesmo dia da semana.
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-white/35">
            mais forte = maior média
          </span>
        </div>
        <div className="scrollbar-hidden mt-3 overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[50px_repeat(24,minmax(28px,1fr))] gap-1 text-[9px] text-white/35">
              <span />
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} className="text-center">
                  {hour}
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
        <h2 className="font-bold">Altas por bloco</h2>
        <p className="mt-1 text-xs text-white/45">
          Volume e tempos no período histórico atual.
        </p>
        <div className="scrollbar-hidden mt-3 overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="py-2 pr-3">Bloco</th>
                <th className="py-2 pr-3">Altas</th>
                <th className="py-2 pr-3">Tempo para iniciar</th>
                <th className="py-2 pr-3">Execução</th>
                <th className="py-2">Dentro da meta</th>
              </tr>
            </thead>
            <tbody>
              {data.blocks.map((block) => (
                <tr key={block.block} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-3">
                    <BlockBadge block={block.block} />
                  </td>
                  <td className="py-2.5 pr-3 font-semibold tabular-nums">{block.total}</td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {block.avgWaitMin == null ? "—" : `${block.avgWaitMin} min`}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {block.avgExecutionMin == null ? "—" : `${block.avgExecutionMin} min`}
                  </td>
                  <td className="py-2.5 tabular-nums">
                    {block.withinTargetPct == null ? "—" : `${block.withinTargetPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="panel-surface rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Conferir registros usados nos indicadores</summary>
        <p className="mt-2 text-xs text-white/45">
          Ferramenta de conferência. Mostra até 40 Altas recentes já consolidadas; não é um indicador de desempenho.
        </p>
        <div className="scrollbar-hidden mt-3 max-h-[420px] overflow-auto rounded-lg border border-white/[0.06]">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 bg-card text-left text-[10px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="px-3 py-2">Leito</th>
                <th className="px-3 py-2">Bloco</th>
                <th className="px-3 py-2">Início</th>
                <th className="px-3 py-2">Fim</th>
                <th className="px-3 py-2">Tempo para iniciar</th>
                <th className="px-3 py-2">Execução</th>
                <th className="px-3 py-2">Colaborador</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCycles.slice(0, 40).map((cycle) => (
                <tr key={cycle.key} className="border-t border-white/[0.05]">
                  <td className="px-3 py-2 font-semibold" title={cycle.unit}>{cycle.bed}</td>
                  <td className="px-3 py-2"><BlockBadge block={cycle.block} compact /></td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDateTime(cycle.startedAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {cycle.completedAt ? formatClock(cycle.completedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {cycle.waitMin == null ? "—" : `${cycle.waitMin} min`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {cycle.executionMin == null ? "—" : `${cycle.executionMin} min`}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={cycle.staff ?? ""}>
                    {cycle.staff ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <DataStatusCard data={data} dailyData={null} updatedAt={data.generatedAt} />
    </div>
  );
}

function AltaProductivity({
  rows,
  search,
  onSearch,
  periodStart,
  periodEnd,
}: {
  rows: OperationsAnalytics["staffProductivity"];
  search: string;
  onSearch: (value: string) => void;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Equipe"
        title="Produtividade de Altas"
        description="Volume e tempos das Altas e Desmontagens. Não é um ranking de qualidade."
      />

      <section className="panel-surface rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-white/45">
            Período: {formatDate(periodStart)}–{formatDate(periodEnd)}
          </div>
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Buscar colaborador"
              className="h-9 w-full rounded-lg border border-white/15 bg-black/10 pl-8 pr-3 text-sm outline-none placeholder:text-white/30 focus:border-sky-400/45"
            />
          </label>
        </div>

        <div className="scrollbar-hidden mt-3 overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="py-2 pr-3">Colaborador</th>
                <th className="py-2 pr-3">Altas</th>
                <th className="py-2 pr-3">Desmontagens</th>
                <th className="py-2 pr-3">Tempo para iniciar</th>
                <th className="py-2 pr-3">Execução média</th>
                <th className="py-2 pr-3">Mediana</th>
                <th className="py-2">Dentro da meta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => (
                <tr key={person.name} className="border-t border-white/[0.06]">
                  <td className="py-2.5 pr-3 font-semibold">{person.name}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{person.completed}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{person.dismantlesCompleted}</td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {person.avgRegistrationMin == null ? "—" : `${person.avgRegistrationMin} min`}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {person.avgExecutionMin == null ? "—" : `${person.avgExecutionMin} min`}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {person.medianExecutionMin == null ? "—" : `${formatDecimal(person.medianExecutionMin)} min`}
                  </td>
                  <td className="py-2.5 tabular-nums">
                    {person.withinTargetPct == null ? "—" : `${person.withinTargetPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="panel-state mt-3 rounded-lg px-3 py-5 text-center text-sm text-white/45">
            Nenhum colaborador corresponde à busca.
          </div>
        )}
      </section>
    </div>
  );
}

function DailyClosureRow({ shift }: { shift: DailyShiftClosure }) {
  return (
    <tr className="border-t border-white/[0.06] align-top">
      <td className="py-2.5 pr-3 font-semibold">{formatShiftDate(shift)}</td>
      <td className="py-2.5 pr-3">{shift.label}</td>
      <td className="py-2.5 pr-3 font-mono text-xs text-white/55">
        {formatTimeWindow(shift.start, shift.end)}
      </td>
      <td className="py-2.5 pr-3">
        <strong>{shift.concurrentPct}%</strong>
        <span className="ml-1 text-xs text-white/40">
          {shift.concurrentDone}/{shift.concurrentEligible}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        {shift.camareiraApplicable && shift.camareiraPct != null ? (
          <>
            <strong>{shift.camareiraPct}%</strong>
            <span className="ml-1 text-xs text-white/40">
              {shift.camareiraDone}/{shift.camareiraEligible}
            </span>
          </>
        ) : (
          <span className="text-white/35">não se aplica</span>
        )}
      </td>
      <td className="py-2.5">
        <details>
          <summary className="cursor-pointer text-xs text-white/55">ver blocos</summary>
          <div className="mt-2 flex min-w-[280px] flex-wrap gap-1.5">
            {shift.blocks.map((block) => (
              <span
                key={block.block}
                className="rounded-md border px-2 py-1 text-[10px]"
                style={{
                  color: BLOCK_COLOR[block.block] ?? "currentColor",
                  borderColor: (BLOCK_COLOR[block.block] ?? "oklch(0.6 0.03 255)").replace(
                    ")",
                    " / 0.38)",
                  ),
                }}
              >
                {block.block}: C {block.concurrentPct}%
                {block.camareiraApplicable && block.camareiraPct != null
                  ? ` · M ${block.camareiraPct}%`
                  : ""}
              </span>
            ))}
          </div>
        </details>
      </td>
    </tr>
  );
}

function DataStatusCard({
  data,
  dailyData,
  updatedAt,
}: {
  data: OperationsAnalytics | null;
  dailyData: DailyOperationsAnalytics | null;
  updatedAt?: string;
}) {
  const partial = !!data?.samplePartial || !!dailyData?.samplePartial;
  return (
    <div
      className={`rounded-xl border p-4 ${
        partial
          ? "border-amber-400/25 bg-amber-400/[0.05]"
          : "border-emerald-400/20 bg-emerald-400/[0.045]"
      }`}
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className={`h-4 w-4 ${partial ? "text-amber-300" : "text-emerald-300"}`} />
        <strong>{partial ? "Dados parciais" : "Dados atualizados"}</strong>
      </div>
      <div className="mt-1 text-xs text-white/45">
        {updatedAt ? `Última atualização: ${formatDateTime(updatedAt)}` : "Atualização não informada"}
      </div>
      <details className="mt-3 text-xs text-white/45">
        <summary className="cursor-pointer font-medium text-white/60">Como os dados são tratados?</summary>
        <div className="mt-2 space-y-1 leading-relaxed">
          {data && (
            <>
              <p>
                Altas repetidas do mesmo leito e minuto de início são consolidadas antes dos indicadores.
              </p>
              <p>Unidades fora do escopo operacional são excluídas da análise.</p>
              <p>
                Histórico de Altas: {data.historyDays} dias completos para médias por horário.
              </p>
            </>
          )}
          {dailyData && (
            <p>
              Higiene Diária: rotinas são associadas ao turno em que começaram; Camareira é avaliada
              no fechamento do turno da tarde.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="pt-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {eyebrow}
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold lg:text-2xl">{title}</h2>
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
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-white/35">{detail}</div>
    </div>
  );
}

function SimpleShiftCard({ title, summary }: { title: string; summary: ShiftSummary }) {
  return (
    <div className="panel-surface rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/35">{title}</div>
          <h3 className="mt-0.5 text-lg font-bold">{summary.label}</h3>
        </div>
        <span className="font-mono text-xs text-white/40">
          {formatTimeWindow(summary.start, summary.end)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Mini label="Altas" value={summary.total} />
        <Mini
          label="Tempo p/ iniciar"
          value={summary.avgWaitMin == null ? "—" : `${summary.avgWaitMin}m`}
        />
        <Mini
          label="Execução"
          value={summary.avgExecutionMin == null ? "—" : `${summary.avgExecutionMin}m`}
        />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-white/35">{label}</div>
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

function ChartKey({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mb-3 flex flex-wrap gap-3 text-xs text-white/50">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
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
  data: OperationsAnalytics["weekdayHour"];
  max: number;
}) {
  return (
    <>
      <span className="flex items-center text-[10px] text-white/45">{label}</span>
      {Array.from({ length: 24 }, (_, hour) => {
        const item = data.find((row) => row.weekday === weekday && row.hour === hour);
        const average = item?.average ?? 0;
        const samples = item?.samples ?? 0;
        const opacity = average === 0 ? 0.035 : 0.12 + (average / max) * 0.72;
        return (
          <div
            key={hour}
            title={`${WEEKDAYS_LONG[weekday]} ${padHour(hour)}h–${padHour((hour + 1) % 24)}h · média ${formatDecimal(average)} Altas · base ${samples} ${weekdayPlural(weekday, samples)}`}
            className="flex h-7 items-center justify-center rounded-[3px] border border-white/5 font-mono text-[8px]"
            style={{ background: `oklch(0.68 0.17 230 / ${opacity})` }}
          >
            {average >= 0.1 ? formatDecimal(average) : ""}
          </div>
        );
      })}
    </>
  );
}

function BlockBadge({ block, compact = false }: { block: string; compact?: boolean }) {
  if (block === "Outro") return <span className="text-white/40">—</span>;
  const color = BLOCK_COLOR[block] ?? "oklch(0.6 0.03 255)";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-semibold ${
        compact ? "min-w-7 px-1.5 py-0.5 text-xs" : "px-2 py-1"
      }`}
      style={{
        color,
        borderColor: color.replace(")", " / 0.45)"),
        backgroundColor: color.replace(")", " / 0.08)"),
      }}
    >
      {block}
    </span>
  );
}

function StatusMessage({
  tone,
  children,
}: {
  tone: "error" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-red-400/30 bg-red-400/[0.07] text-red-200"
          : "border-amber-400/25 bg-amber-400/[0.06] text-amber-100"
      }`}
    >
      {children}
    </div>
  );
}

function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00-03:00`)
    : new Date(value);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatTimeWindow(start: string, end: string): string {
  return `${formatClock(start)} → ${formatClock(end)}`;
}

function formatShiftDate(shift: DailyShiftClosure): string {
  const start = formatDate(shift.start);
  const end = formatDate(shift.end);
  return start === end ? start : `${start} → ${end}`;
}

function padHour(hour: number): string {
  return String(hour).padStart(2, "0");
}

function formatDecimal(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function weekdayPlural(weekday: number, count: number): string {
  const plural = [
    "domingos",
    "segundas-feiras",
    "terças-feiras",
    "quartas-feiras",
    "quintas-feiras",
    "sextas-feiras",
    "sábados",
  ];
  if (count === 1) return WEEKDAYS_LONG[weekday];
  return plural[weekday];
}

function averageNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
