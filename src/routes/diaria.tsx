import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrushCleaning,
  BedDouble,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Circle,
  X,
  User,
  UserRound,
  Baby,
  Radiation,
  Search,
  XCircle,
} from "lucide-react";
import { getDailyBeds, type DailyBedEvent } from "@/lib/daily.functions";
import { getDailyBedHistory, type DailyHistoryRecord } from "@/lib/dailyAnalytics.functions";
import { bedFloor } from "@/lib/beds";
import {
  ACTIVE_DAILY_BEDS,
  isDailyConcurrentEligibleBed,
} from "@/lib/dailyScope";
import { isExcludedUnit } from "@/lib/operationalScope";
import { useCarouselScroll } from "@/hooks/useCarouselScroll";
import { UpdatesModal } from "@/components/UpdatesModal";
import { PanelNav } from "@/components/PanelNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useHospitalData } from "@/hooks/useHospitalData";
import { usePanelTheme } from "@/hooks/usePanelTheme";

export const Route = createFileRoute("/diaria")({
  head: () => ({
    meta: [
      { title: "Higiene Diária — Leitos em Tempo Real" },
      {
        name: "description",
        content:
          "Mapa em tempo real de todos os leitos do hospital com limpeza concorrente e rotina de camareira em andamento.",
      },
      { property: "og:title", content: "Higiene Diária — Leitos em Tempo Real" },
      {
        property: "og:description",
        content: "Todos os leitos do hospital com higiene diária e rotina de camareira ao vivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DiariaPage,
});

const BLOCK_ORDER = ["D", "E", "C", "B"] as const;
const BLOCK_COLOR: Record<(typeof BLOCK_ORDER)[number], string> = {
  D: "oklch(0.66 0.20 145)",
  E: "oklch(0.62 0.22 300)",
  C: "oklch(0.64 0.20 245)",
  B: "oklch(0.63 0.23 25)",
};

const ACTIVE_BEDS = ACTIVE_DAILY_BEDS;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Manhã 06:20-13:40, Tarde 13:40-22:00, Noite 22:00-06:20 (mesma janela de turno
// usada no /lib/daily.server.ts) — em horário de Brasília, sem depender do fuso
// configurado no dispositivo que está exibindo a tela.
type Periodo = "manha" | "tarde" | "noite";
type BlockFilter = "all" | (typeof BLOCK_ORDER)[number];
type RoutineFilter = "all" | "concorrente" | "camareira";
type ViewMode = "all" | "pending" | "running";
function periodoAtualBRT(): Periodo {
  const wall = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const minutos = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  if (minutos >= 6 * 60 + 20 && minutos < 13 * 60 + 40) return "manha";
  if (minutos >= 13 * 60 + 40 && minutos < 22 * 60) return "tarde";
  return "noite";
}

function progressoTurnoBRT(): number {
  const wall = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const nowMin = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  const start =
    nowMin >= 6 * 60 + 20 && nowMin < 13 * 60 + 40
      ? 6 * 60 + 20
      : nowMin >= 13 * 60 + 40 && nowMin < 22 * 60
        ? 13 * 60 + 40
        : 22 * 60;
  const end = start === 6 * 60 + 20 ? 13 * 60 + 40 : start === 13 * 60 + 40 ? 22 * 60 : 24 * 60 + 6 * 60 + 20;
  const adjustedNow = start === 22 * 60 && nowMin < 6 * 60 + 20 ? nowMin + 24 * 60 : nowMin;
  return Math.max(0, Math.min(1, (adjustedNow - start) / (end - start)));
}

// Extrai o código numérico do leito a partir do texto da alta (ex: "Leito 0711" -> "711"),
// pra bater com o código usado em HOSPITAL_BEDS (sem zero à esquerda).
function altaBedCode(bedNumber: string): string | null {
  const m = bedNumber.match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// Mesmos filtros que a /tv usa pra decidir o que conta como alta de verdade
// (senão sobra registro de desmontagem, unidade excluída etc. e aparece leito
// "de alta" sem ser alta). E o mesmo status: "Altas Paradas" na /tv é
// waiting_cleaning (sem colaborador alocado) — não "paused", que é outra coisa
// (leito pausado manualmente por um motivo, ex: cofre travado).
function isAltaExcluded(unit: string | null): boolean {
  return isExcludedUnit(unit || "");
}
const isAltaBed = (bedNumber: string | null) => (bedNumber || "").toLowerCase().startsWith("leito");
const isAltaTerminal = (externalId: string | null) =>
  (externalId || "").startsWith("listo:answer:");

function DiariaPage() {
  const mainRef = useCarouselScroll<HTMLElement>();
  const { isDark, themeClass, toggleTheme } = usePanelTheme();
  const { discharges } = useHospitalData();
  const [events, setEvents] = useState<DailyBedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoAtualBRT());
  const [selectedBed, setSelectedBed] = useState<{
    bed: string;
    events?: { concorrente?: DailyBedEvent; camareira?: DailyBedEvent };
  } | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<{ block: (typeof BLOCK_ORDER)[number]; floor: number } | null>(null);
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [routineFilter, setRoutineFilter] = useState<RoutineFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [bedSearch, setBedSearch] = useState("");
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [highlightedBed, setHighlightedBed] = useState<string | null>(null);
  const [recentlyCompletedBeds, setRecentlyCompletedBeds] = useState<Set<string>>(new Set());
  const previousStatuses = useRef<Map<string, DailyBedEvent["status"]>>(new Map());
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      setPeriodo(periodoAtualBRT());
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await getDailyBeds();
        if (!alive) return;
        const nextStatuses = new Map(
          res.events.map((event) => [`${event.bed}|${event.kind}`, event.status] as const),
        );
        if (previousStatuses.current.size > 0) {
          const completedNow = res.events
            .filter(
              (event) =>
                event.status === "completed" &&
                previousStatuses.current.get(`${event.bed}|${event.kind}`) === "in_progress",
            )
            .map((event) => event.bed);
          if (completedNow.length) {
            setRecentlyCompletedBeds(new Set(completedNow));
            if (completionTimer.current) clearTimeout(completionTimer.current);
            completionTimer.current = setTimeout(() => setRecentlyCompletedBeds(new Set()), 5500);
          }
        }
        previousStatuses.current = nextStatuses;
        setEvents(res.events);
        setLastAt(Date.now());
        setErro(null);
      } catch {
        if (alive) setErro("Não foi possível atualizar agora.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
      if (completionTimer.current) clearTimeout(completionTimer.current);
    };
  }, []);

  // Unidades onde "limpeza concorrente" não deve ser contabilizada/colorida
  // (não são leitos de paciente, ou a rotina lá não faz sentido operacional).
  const eventsFiltered = useMemo(
    () =>
      events.filter(
        (event) =>
          event.kind !== "concorrente" || isDailyConcurrentEligibleBed(event.bed),
      ),
    [events],
  );

  const byBed = useMemo(() => {
    const m = new Map<string, { concorrente?: DailyBedEvent; camareira?: DailyBedEvent }>();
    for (const e of eventsFiltered) {
      const cur = m.get(e.bed) ?? {};
      cur[e.kind] = e;
      m.set(e.bed, cur);
    }
    return m;
  }, [eventsFiltered]);

  // Sinalização de alta no mapa: leito com alta parada fica vermelho, leito com
  // alta já em higienização (limpeza terminal) fica verde — só isso, sem números
  // novos lá em cima, é sinal visual mesmo. Paradas têm prioridade sobre execução.
  const altaByBed = useMemo(() => {
    const m = new Map<string, "waiting_cleaning" | "in_progress">();
    for (const d of discharges) {
      if (d.status !== "waiting_cleaning" && d.status !== "in_progress") continue;
      if (!isAltaBed(d.bed_number) || !isAltaTerminal(d.external_id) || isAltaExcluded(d.unit))
        continue;
      const code = altaBedCode(d.bed_number);
      if (!code) continue;
      if (d.status === "waiting_cleaning" || m.get(code) === undefined) m.set(code, d.status);
    }
    return m;
  }, [discharges]);

  const emHigiene = eventsFiltered.filter(
    (e) => e.status === "in_progress" && e.kind === "concorrente",
  );
  const emCamareira = eventsFiltered.filter(
    (e) => e.status === "in_progress" && e.kind === "camareira",
  );
  const concorrentesConcluidas = eventsFiltered.filter(
    (e) => e.status === "completed" && e.kind === "concorrente",
  ).length;
  const camareirasConcluidas = eventsFiltered.filter(
    (e) => e.status === "completed" && e.kind === "camareira",
  ).length;

  // Leitos que ainda não tiveram nenhum registro (concluído ou em execução) desse
  // tipo de rotina neste turno. Higiene concorrente ignora as unidades excluídas
  // e os leitos que estão num ciclo de alta terminal; camareira considera todos os leitos.
  const bedsElegiveisConcorrente = ACTIVE_BEDS.filter(
    (b) => isDailyConcurrentEligibleBed(b.n, b.b) && !altaByBed.has(b.n),
  );
  const faltamHigiene = bedsElegiveisConcorrente.filter((b) => !byBed.get(b.n)?.concorrente).length;
  const faltamCamareira = ACTIVE_BEDS.filter((b) => !byBed.get(b.n)?.camareira).length;
  const coberturaHigiene =
    bedsElegiveisConcorrente.length > 0
      ? Math.round(((bedsElegiveisConcorrente.length - faltamHigiene) / bedsElegiveisConcorrente.length) * 100)
      : 0;
  const coberturaCamareira =
    ACTIVE_BEDS.length > 0
      ? Math.round(((ACTIVE_BEDS.length - faltamCamareira) / ACTIVE_BEDS.length) * 100)
      : 0;
  const progressoTurno = progressoTurnoBRT();
  const ritmoEsperado = Math.round(progressoTurno * 100);
  const desvioRitmo = coberturaHigiene - ritmoEsperado;
  const ritmoStatus = desvioRitmo < -15 ? "attention" : desvioRitmo > 10 ? "ahead" : "ok";

  const grupos = BLOCK_ORDER.map((block) => {
    const beds = ACTIVE_BEDS.filter((b) => b.b === block);
    const floors = Array.from(new Set(beds.map((b) => bedFloor(b.n)))).sort((a, b) => b - a);
    const concorrenteBeds = beds.filter(
      (b) => isDailyConcurrentEligibleBed(b.n, b.b) && !altaByBed.has(b.n),
    );
    const camareiraBeds = beds.filter((b) => !altaByBed.has(b.n));
    const concorrenteRealizadas = concorrenteBeds.filter(
      (b) => !!byBed.get(b.n)?.concorrente,
    ).length;
    const camareiraRealizadas = camareiraBeds.filter(
      (b) => !!byBed.get(b.n)?.camareira,
    ).length;

    const floorStats = new Map(
      floors.map((floor) => {
        const bedsAndar = beds.filter((b) => bedFloor(b.n) === floor);
        const concorrenteElegiveis = bedsAndar.filter(
          (b) => isDailyConcurrentEligibleBed(b.n, b.b) && !altaByBed.has(b.n),
        );
        const camareiraElegiveis = bedsAndar.filter((b) => !altaByBed.has(b.n));
        const concorrenteFeitas = concorrenteElegiveis.filter(
          (b) => !!byBed.get(b.n)?.concorrente,
        ).length;
        const camareiraFeitas = camareiraElegiveis.filter(
          (b) => !!byBed.get(b.n)?.camareira,
        ).length;
        return [
          floor,
          {
            totalConcorrente: concorrenteElegiveis.length,
            totalCamareira: camareiraElegiveis.length,
            concorrenteFeitas,
            camareiraFeitas,
          },
        ] as const;
      }),
    );

    return {
      block,
      floors,
      beds,
      concorrenteRealizadas,
      camareiraRealizadas,
      concorrenteTotal: concorrenteBeds.length,
      camareiraTotal: camareiraBeds.length,
      floorStats,
    };
  }).filter((g) => g.beds.length > 0);

  const floorCoverage = grupos
    .flatMap((g) =>
      g.floors.map((floor) => {
        const stats = g.floorStats.get(floor) ?? {
          totalConcorrente: 0,
          totalCamareira: 0,
          concorrenteFeitas: 0,
          camareiraFeitas: 0,
        };
        const pct =
          stats.totalConcorrente > 0
            ? Math.round((stats.concorrenteFeitas / stats.totalConcorrente) * 100)
            : 100;
        return {
          block: g.block,
          floor,
          pct,
          pending: Math.max(0, stats.totalConcorrente - stats.concorrenteFeitas),
        };
      }),
    )
    .sort((a, b) => a.pct - b.pct || b.pending - a.pending);
  const floorsAtencao = floorCoverage.filter(
    (x) => x.pending > 0 && progressoTurno > 0.6 && x.pct < ritmoEsperado - 20,
  );

  const availableFloors = useMemo(
    () =>
      blockFilter === "all"
        ? []
        : Array.from(
            new Set(
              ACTIVE_BEDS.filter((bed) => bed.b === blockFilter).map((bed) => bedFloor(bed.n)),
            ),
          ).sort((a, b) => b - a),
    [blockFilter],
  );

  const pendingConcurrentBeds = ACTIVE_BEDS.filter(
    (bed) =>
      isDailyConcurrentEligibleBed(bed.n, bed.b) &&
      !altaByBed.has(bed.n) &&
      !byBed.get(bed.n)?.concorrente,
  );
  const pendingByFloor = new Map<string, number>();
  const pendingByBlock = new Map<string, number>();
  for (const bed of pendingConcurrentBeds) {
    const floorKey = `${bed.b}|${bedFloor(bed.n)}`;
    pendingByFloor.set(floorKey, (pendingByFloor.get(floorKey) ?? 0) + 1);
    pendingByBlock.set(bed.b, (pendingByBlock.get(bed.b) ?? 0) + 1);
  }
  const topPendingFloor = [...pendingByFloor.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const topPendingBlock = [...pendingByBlock.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const concentrationText = (() => {
    if (!pendingConcurrentBeds.length) return "Nenhuma concorrente pendente no escopo atual.";
    if (topPendingFloor) {
      const [block, floor] = topPendingFloor[0].split("|");
      const pct = Math.round((topPendingFloor[1] / pendingConcurrentBeds.length) * 100);
      if (pct >= 30)
        return `${topPendingFloor[1]} de ${pendingConcurrentBeds.length} pendências estão no ${floor}º do Bloco ${block} (${pct}%).`;
    }
    if (topPendingBlock) {
      const pct = Math.round((topPendingBlock[1] / pendingConcurrentBeds.length) * 100);
      return `Bloco ${topPendingBlock[0]} concentra ${topPendingBlock[1]} de ${pendingConcurrentBeds.length} pendências (${pct}%).`;
    }
    return `${pendingConcurrentBeds.length} concorrentes ainda sem registro neste turno.`;
  })();

  const completedLast15Min = eventsFiltered.filter(
    (event) =>
      event.status === "completed" &&
      Date.now() - new Date(event.at).getTime() >= 0 &&
      Date.now() - new Date(event.at).getTime() <= 15 * 60 * 1000,
  ).length;
  const activeNow = eventsFiltered.filter((event) => event.status === "in_progress").length;

  const bedMatchesView = (bed: (typeof ACTIVE_BEDS)[number]) => {
    if (blockFilter !== "all" && bed.b !== blockFilter) return false;
    if (floorFilter != null && bedFloor(bed.n) !== floorFilter) return false;

    const current = byBed.get(bed.n);
    const concorrenteEligible =
      isDailyConcurrentEligibleBed(bed.n, bed.b) && !altaByBed.has(bed.n);
    const pendingConcorrente = concorrenteEligible && !current?.concorrente;
    const pendingCamareira = !current?.camareira;
    const runningConcorrente = current?.concorrente?.status === "in_progress";
    const runningCamareira = current?.camareira?.status === "in_progress";

    if (viewMode === "pending") {
      if (routineFilter === "concorrente") return pendingConcorrente;
      if (routineFilter === "camareira") return pendingCamareira;
      return pendingConcorrente || pendingCamareira;
    }
    if (viewMode === "running") {
      if (routineFilter === "concorrente") return runningConcorrente;
      if (routineFilter === "camareira") return runningCamareira;
      return runningConcorrente || runningCamareira;
    }
    return true;
  };

  const visibleGroups = grupos
    .map((group) => {
      const beds = group.beds.filter(bedMatchesView);
      const floors = group.floors.filter((floor) => beds.some((bed) => bedFloor(bed.n) === floor));
      const concorrenteBeds = beds.filter(
        (bed) => isDailyConcurrentEligibleBed(bed.n, bed.b) && !altaByBed.has(bed.n),
      );
      const camareiraBeds = beds.filter((bed) => !altaByBed.has(bed.n));
      return {
        ...group,
        beds,
        floors,
        concorrenteRealizadas: concorrenteBeds.filter(
          (bed) => !!byBed.get(bed.n)?.concorrente,
        ).length,
        camareiraRealizadas: camareiraBeds.filter(
          (bed) => !!byBed.get(bed.n)?.camareira,
        ).length,
        concorrenteTotal: concorrenteBeds.length,
        camareiraTotal: camareiraBeds.length,
      };
    })
    .filter((group) => group.beds.length > 0);

  function eventsForMap(bed: string) {
    const current = byBed.get(bed);
    if (!current || routineFilter === "all") return current;
    return routineFilter === "concorrente"
      ? { concorrente: current.concorrente }
      : { camareira: current.camareira };
  }

  function focusBed(event: React.FormEvent) {
    event.preventDefault();
    const normalized = String(Number((bedSearch.match(/\d+/)?.[0] ?? "0")));
    const bed = ACTIVE_BEDS.find((item) => item.n === normalized);
    if (!bed) {
      setSearchMessage("Leito não encontrado no mapa da Diária.");
      return;
    }
    setBlockFilter(bed.b as BlockFilter);
    setFloorFilter(bedFloor(bed.n));
    setRoutineFilter("all");
    setViewMode("all");
    setSearchMessage(null);
    setHighlightedBed(bed.n);
    window.setTimeout(() => {
      document
        .querySelector(`[data-bed-code="${bed.n}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 80);
    window.setTimeout(() => setHighlightedBed((current) => (current === bed.n ? null : current)), 4500);
  }

  function clearMapFilters() {
    setBlockFilter("all");
    setFloorFilter(null);
    setRoutineFilter("all");
    setViewMode("all");
    setBedSearch("");
    setSearchMessage(null);
    setHighlightedBed(null);
  }

  const hasMapFilter =
    blockFilter !== "all" || floorFilter != null || routineFilter !== "all" || viewMode !== "all";

  return (
    <div className={`${themeClass} scrollbar-hidden min-h-screen w-full flex flex-col overflow-y-auto font-sans bg-background text-foreground lg:h-screen lg:overflow-hidden`}>
      <header className="panel-shell-header flex-none flex flex-col gap-2 border-b border-white/15 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base lg:text-2xl font-bold tracking-tight">
            Higiene Diária — Leitos
          </h1>
          <PanelNav />
        </div>
        <div className="flex items-center gap-3 lg:gap-5 text-xs lg:text-sm">
          <span className="flex items-center gap-1.5 uppercase text-white/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            ao vivo
          </span>
          <span className="hidden sm:inline font-mono text-white/35">
            atualizado há {Math.max(0, Math.round((Date.now() - lastAt) / 1000))}s
          </span>
          <ThemeToggle isDark={isDark} onToggle={toggleTheme} compact />
          <span className="text-lg lg:text-2xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="scrollbar-hidden flex flex-none gap-2 overflow-x-auto px-4 py-2.5 lg:grid lg:grid-cols-7 lg:overflow-visible lg:px-6 lg:py-3">
        <Kpi
          icon={<BrushCleaning className="h-4 w-4 animate-sweep" />}
          label="Em higiene agora"
          value={emHigiene.length}
          color="oklch(0.72 0.16 235)"
        />
        <Kpi
          icon={<BedDouble className="h-4 w-4 animate-linen" />}
          label="Camareira agora"
          value={emCamareira.length}
          color="oklch(0.75 0.17 55)"
        />
        <Kpi
          icon={<CircleCheck className="h-4 w-4" />}
          label="Concorrentes concluídas"
          value={concorrentesConcluidas}
          color="oklch(0.72 0.16 235)"
        />
        <Kpi
          icon={<CircleCheck className="h-4 w-4" />}
          label="Camareiras concluídas"
          value={camareirasConcluidas}
          color="oklch(0.75 0.17 55)"
        />
        <Kpi
          icon={<BrushCleaning className="h-4 w-4" />}
          label="Faltam higiene"
          value={faltamHigiene}
          color="oklch(0.7 0.19 25)"
        />
        <Kpi
          icon={<BedDouble className="h-4 w-4" />}
          label="Faltam camareira"
          value={faltamCamareira}
          color="oklch(0.7 0.19 25)"
        />
        <Kpi
          icon={<Circle className="h-4 w-4" />}
          label="Total de leitos"
          value={ACTIVE_BEDS.length}
          color="oklch(0.7 0.02 260)"
        />{" "}
      </div>

      <div className="flex-none px-4 lg:px-6 pb-2">
        <div
          className={`grid gap-3 rounded-xl border px-3 py-2.5 lg:grid-cols-[1.1fr_1fr] ${
            ritmoStatus === "attention"
              ? "border-amber-400/30 bg-amber-400/[0.06]"
              : ritmoStatus === "ahead"
                ? "border-emerald-400/20 bg-emerald-400/[0.045]"
                : "border-white/10 bg-white/[0.035]"
          }`}
        >
          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/35">Cobertura do turno</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">{coberturaHigiene}%</span>
                  <span className="text-xs text-white/40">concorrente</span>
                  {periodo === "tarde" && (
                    <>
                      <span className="text-white/20">·</span>
                      <span className="text-lg font-semibold tabular-nums">{coberturaCamareira}%</span>
                      <span className="text-xs text-white/40">camareira</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-white/45">
                Turno percorrido: <strong className="text-white/70">{ritmoEsperado}%</strong>
                <div className="mt-0.5">
                  {ritmoStatus === "attention"
                    ? "ritmo abaixo do esperado"
                    : ritmoStatus === "ahead"
                      ? "ritmo adiantado"
                      : "ritmo compatível"}
                </div>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${coberturaHigiene}%`,
                  background:
                    ritmoStatus === "attention"
                      ? "oklch(0.78 0.2 60)"
                      : "oklch(0.72 0.16 235)",
                }}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/35">
              Andares que merecem atenção
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(floorsAtencao.length ? floorsAtencao.slice(0, 5) : floorCoverage.slice(0, 5)).map((x) => (
                <button
                  type="button"
                  key={`${x.block}-${x.floor}`}
                  onClick={() => setSelectedFloor({ block: x.block, floor: x.floor })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[11px] transition-colors hover:bg-white/10"
                >
                  <strong>Bloco {x.block} · {x.floor}º</strong>
                  <span className={x.pct < ritmoEsperado - 20 ? "text-amber-200" : "text-white/45"}>
                    {x.pct}%
                  </span>
                  <span className="text-white/30">· {x.pending} faltam</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              {concentrationText}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-none px-4 lg:px-6 pb-2">
        <div className="scrollbar-hidden flex gap-1.5 overflow-x-auto pb-1">
          {floorCoverage.map((x) => {
            const tone =
              x.pct >= 90
                ? "oklch(0.66 0.18 150)"
                : x.pct >= Math.max(55, ritmoEsperado - 15)
                  ? "oklch(0.62 0.18 235)"
                  : "oklch(0.72 0.19 65)";
            const blockTone = BLOCK_COLOR[x.block];
            return (
              <div
                key={`heat-${x.block}-${x.floor}`}
                className="min-w-[78px] rounded-md border px-2 py-1.5"
                style={{ borderColor: blockTone.replace(")", " / 0.48)"), background: blockTone.replace(")", " / 0.10)") }}
                title={`Bloco ${x.block} ${x.floor}º · ${x.pct}% de cobertura concorrente`}
              >
                <div className="text-[9px] uppercase tracking-wide text-white/35">Bloco {x.block}</div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs">{x.floor}º</span>
                  <strong className="text-sm tabular-nums" style={{ color: tone }}>{x.pct}%</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-none px-4 pb-2 lg:px-6">
        <div className="panel-surface rounded-xl border p-2.5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="scrollbar-hidden flex min-w-0 items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                Bloco
              </span>
              {(["all", ...BLOCK_ORDER] as BlockFilter[]).map((block) => {
                const active = blockFilter === block;
                const color = block === "all" ? "oklch(0.68 0.03 255)" : BLOCK_COLOR[block];
                return (
                  <button
                    type="button"
                    key={block}
                    onClick={() => {
                      setBlockFilter(block);
                      setFloorFilter(null);
                    }}
                    aria-pressed={blockFilter === block}
                    className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                    style={{
                      borderColor: color.replace(")", active ? " / 0.75)" : " / 0.28)"),
                      background: color.replace(")", active ? " / 0.18)" : " / 0.05)"),
                      color: active ? color : undefined,
                    }}
                  >
                    {block === "all" ? "Todos" : block}
                  </button>
                );
              })}
              {blockFilter !== "all" && (
                <select
                  aria-label="Filtrar andar"
                  value={floorFilter ?? ""}
                  onChange={(event) =>
                    setFloorFilter(event.target.value ? Number(event.target.value) : null)
                  }
                  className="panel-select h-8 shrink-0 rounded-md border border-white/15 px-2 text-xs outline-none"
                >
                  <option value="">Todos andares</option>
                  {availableFloors.map((floor) => (
                    <option key={floor} value={floor}>
                      {floor}º andar
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="scrollbar-hidden flex min-w-0 items-center gap-1.5 overflow-x-auto">
              {(
                [
                  ["all", "Todas rotinas"],
                  ["concorrente", "Concorrente"],
                  ["camareira", "Camareira"],
                ] as Array<[RoutineFilter, string]>
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setRoutineFilter(value)}
                  aria-pressed={routineFilter === value}
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    routineFilter === value
                      ? "border-sky-400/45 bg-sky-400/10 font-semibold"
                      : "border-white/10 text-white/55 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
              {(
                [
                  ["all", "Mapa completo"],
                  ["pending", "Só pendentes"],
                  ["running", "Em execução"],
                ] as Array<[ViewMode, string]>
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setViewMode(value)}
                  aria-pressed={viewMode === value}
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    viewMode === value
                      ? "border-emerald-400/45 bg-emerald-400/10 font-semibold"
                      : "border-white/10 text-white/55 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={focusBed} className="flex min-w-0 items-center gap-1.5">
              <div className="relative min-w-0 flex-1 xl:w-40 xl:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
                <input
                  value={bedSearch}
                  onChange={(event) => setBedSearch(event.target.value)}
                  inputMode="numeric"
                  placeholder="Buscar leito"
                  className="h-8 w-full rounded-md border border-white/15 bg-black/10 pl-8 pr-2 text-sm outline-none placeholder:text-white/30 focus:border-sky-400/50"
                />
              </div>
              <button
                type="submit"
                className="h-8 rounded-md border border-sky-400/35 bg-sky-400/10 px-2.5 text-xs font-semibold"
              >
                Ir
              </button>
              {(hasMapFilter || bedSearch) && (
                <button
                  type="button"
                  onClick={clearMapFilters}
                  title="Limpar filtros"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/45 hover:bg-white/10"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </form>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/40">
            <span>
              {visibleGroups.reduce((sum, group) => sum + group.beds.length, 0)} de {ACTIVE_BEDS.length} leitos exibidos
            </span>
            <span>
              Últimos 15 min: <strong className="text-white/65">+{completedLast15Min} rotinas concluídas</strong>
              {" · "}
              <strong className="text-white/65">{activeNow} em execução agora</strong>
            </span>
            {searchMessage && (
              <span role="status" className="text-amber-200">
                {searchMessage}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 lg:px-6 pb-2 text-xs lg:text-sm font-medium uppercase text-white/60">
        <Legenda color="oklch(0.72 0.16 235)" text="Limpeza concorrente" />
        <Legenda color="oklch(0.75 0.17 55)" text="Rotina camareira" />
        <LegendaSplit text="Concorrente + Camareira concluídas" />
        <Legenda color="oklch(0.5 0.02 260)" text="Sem rotinas registradas" />
        <Legenda color={ALTA_PARADA_COLOR} text="Alta parada" />
        <Legenda color={ALTA_EXECUCAO_COLOR} text="Alta em higienização" />
        {erro && <span className="text-[oklch(0.7_0.18_25)] normal-case">{erro}</span>}
        {loading && <span className="normal-case">carregando…</span>}
      </div>

      <div className="flex-none px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30 lg:px-6">
        Mapa de leitos · clique no andar para resumo · rolagem automática na TV
      </div>
      <main
        ref={mainRef}
        className="scrollbar-hidden min-h-[48vh] flex-1 overflow-y-auto scroll-smooth px-4 pb-8 lg:min-h-0 lg:px-6 space-y-6"
      >
        {visibleGroups.map((g) => (
          <section key={g.block}>
            <h2
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 px-3 py-2 text-xl lg:text-3xl font-black uppercase tracking-wide"
              style={{
                borderLeftColor: BLOCK_COLOR[g.block],
                backgroundColor: BLOCK_COLOR[g.block].replace(")", " / 0.10)"),
              }}
            >
              <span>Bloco {g.block}</span>
              <span className="text-sm lg:text-base font-normal normal-case tracking-normal text-white/40">
                {g.beds.length} leitos
              </span>
              <span
                className="text-sm lg:text-base font-semibold normal-case tracking-normal"
                style={{ color: "oklch(0.72 0.16 235)" }}
              >
                {g.concorrenteRealizadas} concorrentes
              </span>
              <span
                className="text-sm lg:text-base font-semibold normal-case tracking-normal"
                style={{ color: "oklch(0.75 0.17 55)" }}
              >
                {g.camareiraRealizadas} camareiras
              </span>
              <span className="ml-auto flex min-w-[140px] flex-1 basis-40 flex-col gap-1 normal-case tracking-normal lg:max-w-xs">
                <ProgressBar
                  value={g.concorrenteRealizadas}
                  total={g.concorrenteTotal}
                  color={CONCORRENTE_COLOR}
                  label="Concorrente"
                />
                {periodo === "tarde" && (
                  <ProgressBar
                    value={g.camareiraRealizadas}
                    total={g.camareiraTotal}
                    color={CAMAREIRA_COLOR}
                    label="Camareira"
                  />
                )}
              </span>
            </h2>
            <div className="space-y-3">
              {g.floors.map((floor) => {
                const stats = g.floorStats.get(floor) ?? {
                  totalConcorrente: 0,
                  totalCamareira: 0,
                  concorrenteFeitas: 0,
                  camareiraFeitas: 0,
                };
                const floorNeedsAttention = floorsAtencao.some(
                  (item) => item.block === g.block && item.floor === floor,
                );
                return (
                  <div
                    key={floor}
                    className={`flex items-start gap-3 rounded-lg ${
                      floorNeedsAttention ? "bg-amber-400/[0.035] py-1" : ""
                    }`}
                  >
                    <div className="mt-1.5 w-12 flex-none flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedFloor({ block: g.block, floor })}
                        className={`w-full rounded px-1 py-0.5 text-right font-mono text-[11px] transition-colors ${
                          floorNeedsAttention
                            ? "border border-amber-400/25 bg-amber-400/[0.08] text-amber-200"
                            : "text-white/35 hover:bg-white/10 hover:text-white/70"
                        }`}
                        title={`Abrir resumo do ${floor}º andar do Bloco ${g.block}`}
                      >
                        {floor}º
                      </button>
                      <div className="flex items-end gap-1">
                        <VerticalProgressBar
                          value={stats.concorrenteFeitas}
                          total={stats.totalConcorrente}
                          color={CONCORRENTE_COLOR}
                          label="Concorrente"
                        />
                        {periodo === "tarde" && (
                          <VerticalProgressBar
                            value={stats.camareiraFeitas}
                            total={stats.totalCamareira}
                            color={CAMAREIRA_COLOR}
                            label="Camareira"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {g.beds
                        .filter((b) => bedFloor(b.n) === floor)
                        .map((b) => (
                          <BedTile
                            key={b.n}
                            bed={b.n}
                            block={g.block}
                            floor={floor}
                            events={eventsForMap(b.n)}
                            altaStatus={altaByBed.get(b.n)}
                            isDark={isDark}
                            highlighted={highlightedBed === b.n}
                            justCompleted={recentlyCompletedBeds.has(b.n)}
                            onSelect={() => setSelectedBed({ bed: b.n, events: byBed.get(b.n) })}
                          />
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 && (
          <div className="panel-state flex min-h-48 items-center justify-center rounded-xl px-4 text-center text-sm text-white/45">
            Nenhum leito corresponde aos filtros atuais. Ajuste bloco, andar, rotina ou visualização.
          </div>
        )}
      </main>
      <UpdatesModal />
      {selectedBed && (
        <BedDetailSheet
          bed={selectedBed.bed}
          events={selectedBed.events}
          altaStatus={altaByBed.get(selectedBed.bed)}
          concurrentEligible={
            isDailyConcurrentEligibleBed(selectedBed.bed) && !altaByBed.has(selectedBed.bed)
          }
          periodo={periodo}
          onClose={() => setSelectedBed(null)}
        />
      )}
      {selectedFloor && (
        <FloorDetailSheet
          block={selectedFloor.block}
          floor={selectedFloor.floor}
          beds={ACTIVE_BEDS.filter(
            (bed) => bed.b === selectedFloor.block && bedFloor(bed.n) === selectedFloor.floor,
          )}
          byBed={byBed}
          altaByBed={altaByBed}
          onFocus={() => {
            setBlockFilter(selectedFloor.block);
            setFloorFilter(selectedFloor.floor);
            setRoutineFilter("all");
            setViewMode("all");
            setSelectedFloor(null);
          }}
          onClose={() => setSelectedFloor(null)}
        />
      )}
    </div>
  );
}

function BedDetailSheet({
  bed,
  events,
  altaStatus,
  concurrentEligible,
  periodo,
  onClose,
}: {
  bed: string;
  events: { concorrente?: DailyBedEvent; camareira?: DailyBedEvent } | undefined;
  altaStatus?: "waiting_cleaning" | "in_progress";
  concurrentEligible: boolean;
  periodo: Periodo;
  onClose: () => void;
}) {
  const c = events?.concorrente;
  const k = events?.camareira;

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const [history, setHistory] = useState<DailyHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    setHistoryError(false);
    getDailyBedHistory({ data: { bed } })
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch(() => {
        if (alive) setHistoryError(true);
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bed]);

  const currentLabel = (event: DailyBedEvent | undefined, eligible = true) => {
    if (!eligible) {
      return altaStatus
        ? "fora da concorrente enquanto há Alta terminal em curso"
        : "fora do escopo da concorrente";
    }
    if (!event) return "sem registro neste turno";
    return event.status === "in_progress"
      ? `em execução desde ${formatTime(event.at)}`
      : `concluída às ${formatTime(event.at)}`;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes do leito ${bed}`}
        className="scrollbar-hidden max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-white/15 bg-[oklch(0.19_0.02_265)] p-4 lg:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
              Situação da Diária
            </div>
            <h3 className="mt-0.5 text-xl font-bold">Leito {bed}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <section className="rounded-xl border border-white/10 bg-black/10 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
            O que falta / situação atual
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase text-white/35">Concorrente</div>
              <strong className="text-sm">{currentLabel(c, concurrentEligible)}</strong>
            </div>
            <div>
              <div className="text-[10px] uppercase text-white/35">Camareira</div>
              <strong className="text-sm">{currentLabel(k)}</strong>
              {!k && periodo !== "tarde" && (
                <div className="mt-0.5 text-[10px] text-white/35">fora do destaque do período atual</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase text-white/35">Alta terminal</div>
              <strong className="text-sm">
                {altaStatus === "waiting_cleaning"
                  ? "Alta parada"
                  : altaStatus === "in_progress"
                    ? "em higienização terminal"
                    : "sem Alta em curso"}
              </strong>
            </div>
          </div>
        </section>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <DetailRow
            icon={<BrushCleaning className="h-4 w-4" />}
            color={CONCORRENTE_COLOR}
            label="Limpeza concorrente"
            event={c}
          />
          <DetailRow
            icon={<BedDouble className="h-4 w-4" />}
            color={CAMAREIRA_COLOR}
            label="Rotina camareira"
            event={k}
          />
        </div>

        <section className="mt-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h4 className="font-semibold">Últimos 3 registros concluídos</h4>
              <p className="text-[11px] text-white/40">
                Histórico recente deste leito no Listo.
              </p>
            </div>
            {historyLoading && <span className="text-[10px] text-white/35">carregando…</span>}
          </div>
          <div className="mt-2 space-y-2">
            {history.map((item) => (
              <article
                key={item.key}
                className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                      style={{
                        color: item.kind === "concorrente" ? CONCORRENTE_COLOR : CAMAREIRA_COLOR,
                        background: (
                          item.kind === "concorrente" ? CONCORRENTE_COLOR : CAMAREIRA_COLOR
                        ).replace(")", " / 0.12)"),
                      }}
                    >
                      {item.kind === "concorrente" ? "Concorrente" : "Camareira"}
                    </span>
                    <strong className="text-xs">
                      {item.startedAt
                        ? new Date(item.startedAt).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })
                        : "Data não informada"}
                    </strong>
                  </div>
                  <span className="font-mono text-xs text-white/55">
                    {item.durationMin == null ? "tempo —" : `${item.durationMin} min`}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium">
                  {item.staff || "Colaborador não identificado"}
                </div>
                <div className="mt-0.5 text-[11px] text-white/45">
                  início{" "}
                  {item.startedAt
                    ? new Date(item.startedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })
                    : "—"}
                  {" · "}fim{" "}
                  {item.completedAt
                    ? new Date(item.completedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })
                    : "—"}
                </div>
              </article>
            ))}
            {!historyLoading && !history.length && !historyError && (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
                Nenhum registro concluído encontrado na janela histórica recente.
              </div>
            )}
            {historyError && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200">
                O histórico recente não pôde ser consultado agora. A situação do turno acima continua válida.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FloorDetailSheet({
  block,
  floor,
  beds,
  byBed,
  altaByBed,
  onFocus,
  onClose,
}: {
  block: (typeof BLOCK_ORDER)[number];
  floor: number;
  beds: Array<{ n: string; b: string }>;
  byBed: Map<string, { concorrente?: DailyBedEvent; camareira?: DailyBedEvent }>;
  altaByBed: Map<string, "waiting_cleaning" | "in_progress">;
  onFocus: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const concurrentEligible = beds.filter(
    (bed) => isDailyConcurrentEligibleBed(bed.n, bed.b) && !altaByBed.has(bed.n),
  );
  const camareiraEligible = beds.filter((bed) => !altaByBed.has(bed.n));
  const concurrentDone = concurrentEligible.filter(
    (bed) => !!byBed.get(bed.n)?.concorrente,
  ).length;
  const camareiraDone = camareiraEligible.filter(
    (bed) => !!byBed.get(bed.n)?.camareira,
  ).length;
  const active = beds.filter((bed) => {
    const event = byBed.get(bed.n);
    return (
      event?.concorrente?.status === "in_progress" || event?.camareira?.status === "in_progress"
    );
  }).length;
  const completedEvents = beds
    .flatMap((bed) => {
      const event = byBed.get(bed.n);
      return [event?.concorrente, event?.camareira].filter(
        (item): item is DailyBedEvent => !!item && item.status === "completed",
      );
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const lastCompletion = completedEvents[0];

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Resumo do ${floor}º andar do Bloco ${block}`}
        className="w-full max-w-md rounded-t-2xl border border-white/15 bg-[oklch(0.19_0.02_265)] p-4 lg:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: BLOCK_COLOR[block] }}
            >
              Bloco {block}
            </div>
            <h3 className="mt-0.5 text-xl font-bold">{floor}º andar</h3>
            <p className="text-xs text-white/40">{beds.length} leitos cadastrados neste andar</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/45 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <FloorMetric
            label="Concorrente"
            value={`${concurrentDone}/${concurrentEligible.length}`}
            detail={`${Math.max(0, concurrentEligible.length - concurrentDone)} sem registro`}
            color={CONCORRENTE_COLOR}
          />
          <FloorMetric
            label="Camareira"
            value={`${camareiraDone}/${camareiraEligible.length}`}
            detail={`${Math.max(0, camareiraEligible.length - camareiraDone)} sem registro`}
            color={CAMAREIRA_COLOR}
          />
          <FloorMetric
            label="Em execução"
            value={String(active)}
            detail="rotinas ativas agora"
            color="oklch(0.68 0.18 150)"
          />
          <FloorMetric
            label="Última conclusão"
            value={lastCompletion ? formatTime(lastCompletion.at) : "—"}
            detail={lastCompletion?.staff || "sem conclusão registrada"}
            color={BLOCK_COLOR[block]}
          />
        </div>

        <button
          type="button"
          onClick={onFocus}
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/10"
          style={{ borderColor: BLOCK_COLOR[block].replace(")", " / 0.45)") }}
        >
          Mostrar somente este andar no mapa
        </button>
      </div>
    </div>
  );
}

function FloorMetric({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: color.replace(")", " / 0.28)"),
        background: color.replace(")", " / 0.07)"),
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-white/40" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  color,
  label,
  event,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  event: DailyBedEvent | undefined;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: color.replace(")", " / 0.35)"),
        background: color.replace(")", " / 0.08)"),
      }}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase" style={{ color }}>
        {icon}
        {label}
      </div>
      {event ? (
        <div className="mt-1 space-y-0.5 text-sm">
          <div className="font-semibold">
            {event.staff ?? <span className="text-white/40">Colaborador não identificado</span>}
          </div>
          <div className="text-xs text-white/50">
            {event.status === "in_progress" ? "Em execução desde" : "Concluída às"}{" "}
            {formatTime(event.at)}
            {event.count > 1 ? ` · ×${event.count} neste turno` : ""} · {event.shift}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-white/40">Sem rotina registrada neste turno.</div>
      )}
    </div>
  );
}

function Legenda({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

function LegendaSplit({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex h-2 w-3 overflow-hidden rounded-sm">
        <span className="h-full w-1/2" style={{ background: CONCORRENTE_COLOR }} />
        <span className="h-full w-1/2" style={{ background: CAMAREIRA_COLOR }} />
      </span>
      {text}
    </span>
  );
}

function ProgressBar({
  value,
  total,
  color,
  label,
}: {
  value: number;
  total: number;
  color: string;
  label: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span
        className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/50"
        title={label}
      >
        {pct}%
      </span>
    </span>
  );
}

// Barra de progresso vertical (usada embaixo do número do andar, no lugar da
// horizontal que fica no cabeçalho do bloco — espaço ali é estreito e vertical).
function VerticalProgressBar({
  value,
  total,
  color,
  label,
}: {
  value: number;
  total: number;
  color: string;
  label: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div
      className="relative h-7 w-[5px] shrink-0 overflow-hidden rounded-full bg-white/10"
      title={`${label}: ${value}/${total} (${pct}%)`}
    >
      <div
        className="absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-500"
        style={{ height: `${pct}%`, background: color }}
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="min-w-[138px] rounded-lg border px-3 py-2 lg:min-w-0"
      style={{
        borderColor: `${color.replace(")", " / 0.3)")}`,
        background: color.replace(")", " / 0.08)"),
      }}
    >
      <div
        className="flex items-center gap-1.5 text-xs lg:text-sm font-semibold uppercase"
        style={{ color }}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl lg:text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

const CONCORRENTE_COLOR = "oklch(0.72 0.16 235)"; // azul
const CAMAREIRA_COLOR = "oklch(0.75 0.17 55)"; // laranja
const SEM_ROTINA_COLOR = "oklch(0.5 0.02 260)"; // cinza
const ALTA_PARADA_COLOR = "oklch(0.7 0.19 25)"; // vermelho — alta parada
const ALTA_EXECUCAO_COLOR = "oklch(0.72 0.17 155)"; // verde — alta já em higienização

// Ícones decorativos dos leitos "sem rotina" (só estética, sem dado de paciente real):
// alternam entre dois ícones de pessoa (não símbolos de gênero) de forma embaralhada
// pelo número do leito, viram bebê nos andares pediátricos e radioativo nos leitos de
// lutécio/iodoterapia.
const PERSON_A_COLOR = "oklch(0.63 0.07 240)";
const PERSON_B_COLOR = "oklch(0.66 0.08 20)";
const PEDIATRIC_ICON_COLOR = "oklch(0.76 0.09 95)";
const RADIOACTIVE_ICON_COLOR = "oklch(0.78 0.17 130)";
const PEDIATRIC_FLOORS = new Set(["B6", "B7"]); // 6B e 7B são leitos pediátricos
// Leitos de lutécio/iodoterapia — recebem o ícone de radioativo em vez de pessoa.
const RADIOACTIVE_BEDS = new Set(["1405", "1410", "1411", "1417", "1418"]);

// Embaralha os dois ícones de pessoa por leito sem seguir um padrão óbvio tipo
// par/ímpar (fica "aleatório" mas estável — não troca de ícone a cada atualização).
function shuffledPersonIsA(bed: string): boolean {
  let hash = 0;
  for (let i = 0; i < bed.length; i++) hash = (hash * 31 + bed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0;
}

function BedTile({
  bed,
  block,
  floor,
  events,
  altaStatus,
  isDark,
  highlighted,
  justCompleted,
  onSelect,
}: {
  bed: string;
  block: string;
  floor: number;
  events: { concorrente?: DailyBedEvent; camareira?: DailyBedEvent } | undefined;
  altaStatus?: "waiting_cleaning" | "in_progress";
  isDark: boolean;
  highlighted?: boolean;
  justCompleted?: boolean;
  onSelect?: () => void;
}) {
  const c = events?.concorrente;
  const k = events?.camareira;
  const hasC = !!c;
  const hasK = !!k;
  const activeC = c?.status === "in_progress";
  const activeK = k?.status === "in_progress";
  const anyActive = activeC || activeK;
  const both = hasC && hasK;
  const repeatBadge =
    Math.max(c?.count ?? 0, k?.count ?? 0) > 1 ? Math.max(c?.count ?? 0, k?.count ?? 0) : null;

  const isPediatric = PEDIATRIC_FLOORS.has(`${block}${floor}`);
  const isRadioactive = RADIOACTIVE_BEDS.has(bed);
  const PatientIcon = isRadioactive
    ? Radiation
    : isPediatric
      ? Baby
      : shuffledPersonIsA(bed)
        ? User
        : UserRound;
  const patientIconColor = isRadioactive
    ? RADIOACTIVE_ICON_COLOR
    : isPediatric
      ? PEDIATRIC_ICON_COLOR
      : shuffledPersonIsA(bed)
        ? PERSON_A_COLOR
        : PERSON_B_COLOR;

  const altaLabel =
    altaStatus === "waiting_cleaning"
      ? "Alta parada"
      : altaStatus === "in_progress"
        ? "Alta em higienização"
        : null;

  const title = altaLabel
    ? `Leito ${bed} · ${altaLabel}`
    : both
      ? `Leito ${bed} · Concorrente ${activeC ? "em execução" : `concluída (×${c!.count})`}${c!.staff ? ` · ${c!.staff}` : ""} + Camareira ${
          activeK ? "em execução" : `concluída (×${k!.count})`
        }${k!.staff ? ` · ${k!.staff}` : ""}`
      : hasC
        ? `Leito ${bed} · Limpeza concorrente · ${activeC ? "em execução" : `concluída ×${c!.count}`}${c!.staff ? ` · ${c!.staff}` : ""} · ${c!.shift}`
        : hasK
          ? `Leito ${bed} · Rotina camareira · ${activeK ? "em execução" : `concluída ×${k!.count}`}${k!.staff ? ` · ${k!.staff}` : ""} · ${k!.shift}`
          : `Leito ${bed} · sem rotina neste turno`;

  const altaColor =
    altaStatus === "waiting_cleaning"
      ? ALTA_PARADA_COLOR
      : altaStatus === "in_progress"
        ? ALTA_EXECUCAO_COLOR
        : null;

  const background = altaColor
    ? altaColor.replace(")", isDark ? " / 0.24)" : " / 0.12)")
    : both
      ? isDark
        ? "oklch(0.22 0.025 260)"
        : "oklch(1 0 0)"
      : hasC
        ? CONCORRENTE_COLOR.replace(")", activeC ? " / 0.18)" : " / 0.10)")
        : hasK
          ? CAMAREIRA_COLOR.replace(")", activeK ? " / 0.18)" : " / 0.10)")
          : isDark
            ? SEM_ROTINA_COLOR.replace(")", " / 0.12)")
            : "oklch(0.965 0.006 250)";

  const borderColor = altaColor
    ? altaColor.replace(")", " / 0.8)")
    : both
      ? "oklch(0.9 0.01 260 / 0.55)"
      : hasC
        ? CONCORRENTE_COLOR.replace(")", " / 0.65)")
        : hasK
          ? CAMAREIRA_COLOR.replace(")", " / 0.65)")
          : SEM_ROTINA_COLOR.replace(")", " / 0.65)");

  const textColor = isDark
    ? altaColor || hasC || hasK
      ? "oklch(0.97 0.005 260)"
      : "oklch(0.74 0.02 255)"
    : "oklch(0.20 0.025 255)";

  const splitShadow = both
    ? `inset 4px 0 0 ${CONCORRENTE_COLOR}, inset -4px 0 0 ${CAMAREIRA_COLOR}`
    : undefined;

  return (
    <div
      data-bed-code={bed}
      className={`flex flex-col items-center gap-0.5 ${justCompleted ? "daily-bed-completed" : ""}`}
    >
      <div className="flex h-[11px] items-center gap-1 font-mono text-[8px] leading-none tabular-nums">
        {!altaColor && hasC && (
          <span style={{ color: CONCORRENTE_COLOR }}>{formatTime(c!.at)}</span>
        )}
        {!altaColor && hasC && hasK && <span className="text-white/25">·</span>}
        {!altaColor && hasK && <span style={{ color: CAMAREIRA_COLOR }}>{formatTime(k!.at)}</span>}
        {altaColor && (
          <span
            className="font-sans font-semibold uppercase tracking-wide"
            style={{ color: altaColor }}
          >
            {altaStatus === "waiting_cleaning" ? "parada" : "alta"}
          </span>
        )}
      </div>
      <div
        title={title}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect?.();
        }}
        className={`relative flex h-12 w-[62px] flex-col items-center justify-center rounded-md border text-[11px] font-mono transition-colors cursor-pointer active:scale-95 ${
          anyActive ? "animate-bed-blink" : ""
        }`}
        style={{
          borderColor,
          background,
          color: textColor,
          boxShadow: [
            splitShadow,
            anyActive
              ? `0 0 12px -2px ${(activeC ? CONCORRENTE_COLOR : CAMAREIRA_COLOR).replace(")", " / 0.45)")}`
              : null,
            highlighted ? "0 0 0 3px oklch(0.74 0.18 230 / 0.9)" : null,
            justCompleted ? "0 0 0 2px oklch(0.72 0.18 150 / 0.8)" : null,
          ]
            .filter(Boolean)
            .join(", ") || undefined,
        }}
      >
        <span className="font-semibold tabular-nums leading-none">{bed}</span>
        <span className="mt-1 flex h-4 items-center justify-center gap-1">
          {altaStatus === "waiting_cleaning" && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: isDark ? "white" : "oklch(0.25 0.03 255)" }}
            />
          )}
          {altaStatus === "in_progress" && (
            <BrushCleaning
              className="h-3.5 w-3.5 animate-sweep"
              style={{ color: isDark ? "white" : "oklch(0.25 0.03 255)" }}
            />
          )}
          {!altaColor && activeK && (
            <BedDouble className="h-3.5 w-3.5 animate-linen" style={{ color: CAMAREIRA_COLOR }} />
          )}
          {!altaColor && activeC && (
            <BrushCleaning
              className="h-3.5 w-3.5 animate-sweep"
              style={{ color: CONCORRENTE_COLOR }}
            />
          )}
          {!altaColor && !anyActive && (hasC || hasK) && (
            <CircleCheck className="h-3 w-3 opacity-90" />
          )}
          {!altaColor && !anyActive && !hasC && !hasK && (
            <PatientIcon className="h-3.5 w-3.5" style={{ color: patientIconColor }} />
          )}
        </span>
        {repeatBadge && (
          <span
            className="absolute -right-1.5 -top-1.5 rounded-full px-1 text-[9px] font-bold leading-[14px] text-black"
            style={{ background: "oklch(0.85 0.15 95)" }}
            title="Rotina repetida neste turno"
          >
            ×{repeatBadge}
          </span>
        )}
      </div>
    </div>
  );
}
