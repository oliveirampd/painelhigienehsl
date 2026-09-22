import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BrushCleaning, BedDouble, CircleCheck, ChevronLeft, ChevronRight, Circle, X } from "lucide-react";
import { getDailyBeds, type DailyBedEvent } from "@/lib/daily.functions";
import { HOSPITAL_BEDS, bedFloor } from "@/lib/beds";

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

// Andares que existem no cadastro mas não são usados na prática — tirados da
// contagem e da exibição por completo (não é "sem rotina", é "não existe" aqui).
const EXCLUDED_FLOORS: Array<{ block: string; floor: number }> = [
  { block: "C", floor: 12 },
  { block: "C", floor: 13 },
];
const ACTIVE_BEDS = HOSPITAL_BEDS.filter(
  (b) => !EXCLUDED_FLOORS.some((ex) => ex.block === b.b && ex.floor === bedFloor(b.n)),
);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Manhã 06:20-13:40, Tarde 13:40-22:00, Noite 22:00-06:20 (mesma janela de turno
// usada no /lib/daily.server.ts) — em horário de Brasília, sem depender do fuso
// configurado no dispositivo que está exibindo a tela.
type Periodo = "manha" | "tarde" | "noite";
function periodoAtualBRT(): Periodo {
  const wall = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const minutos = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  if (minutos >= 6 * 60 + 20 && minutos < 13 * 60 + 40) return "manha";
  if (minutos >= 13 * 60 + 40 && minutos < 22 * 60) return "tarde";
  return "noite";
}

function DiariaPage() {
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
    };
  }, []);

  // Unidades onde "limpeza concorrente" não deve ser contabilizada/colorida
  // (não são leitos de paciente, ou a rotina lá não faz sentido operacional).
  const EXCLUDED_CONCORRENTE_UNITS = new Set(["5B", "5C", "9C", "3C", "3D"]);
  const bedUnit = (bedCode: string) => {
    const b = HOSPITAL_BEDS.find((x) => x.n === bedCode);
    return b ? `${bedFloor(bedCode)}${b.b}` : "";
  };
  const eventsFiltered = useMemo(
    () => events.filter((e) => !(e.kind === "concorrente" && EXCLUDED_CONCORRENTE_UNITS.has(bedUnit(e.bed)))),
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

  const emHigiene = eventsFiltered.filter((e) => e.status === "in_progress" && e.kind === "concorrente");
  const emCamareira = eventsFiltered.filter((e) => e.status === "in_progress" && e.kind === "camareira");
  const concorrentesConcluidas = eventsFiltered.filter(
    (e) => e.status === "completed" && e.kind === "concorrente",
  ).length;
  const camareirasConcluidas = eventsFiltered.filter(
    (e) => e.status === "completed" && e.kind === "camareira",
  ).length;

  // Leitos que ainda não tiveram nenhum registro (concluído ou em execução) desse
  // tipo de rotina neste turno. Higiene concorrente ignora as unidades excluídas
  // (mesma regra usada no resto da tela); camareira considera todos os leitos.
  const bedsElegiveisConcorrente = ACTIVE_BEDS.filter((b) => !EXCLUDED_CONCORRENTE_UNITS.has(bedUnit(b.n)));
  const faltamHigiene = bedsElegiveisConcorrente.filter((b) => !byBed.get(b.n)?.concorrente).length;
  const faltamCamareira = ACTIVE_BEDS.filter((b) => !byBed.get(b.n)?.camareira).length;

  const grupos = BLOCK_ORDER.map((block) => {
    const beds = ACTIVE_BEDS.filter((b) => b.b === block);
    const floors = Array.from(new Set(beds.map((b) => bedFloor(b.n)))).sort((a, b) => b - a);
    const concorrenteRealizadas = beds.filter((b) => byBed.get(b.n)?.concorrente).length;
    const camareiraRealizadas = beds.filter((b) => byBed.get(b.n)?.camareira).length;
    return { block, floors, beds, concorrenteRealizadas, camareiraRealizadas };
  }).filter((g) => g.beds.length > 0);

  return (
    <div className="dark h-screen w-full flex flex-col overflow-hidden font-sans bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)]">
      <header className="flex-none flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between px-4 lg:px-6 py-2.5 border-b border-white/15">
        <div className="flex items-center gap-3">
          <Link
            to="/tv"
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs uppercase text-white/60 transition-colors hover:bg-white/10"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Terminal
          </Link>
          <h1 className="text-base lg:text-2xl font-bold tracking-tight">Higiene Diária — Leitos</h1>
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
          <span className="text-lg lg:text-2xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="flex-none grid grid-cols-2 lg:grid-cols-7 gap-2 px-4 lg:px-6 py-3">
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
        />      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 lg:px-6 pb-2 text-xs lg:text-sm font-medium uppercase text-white/60">
        <Legenda color="oklch(0.72 0.16 235)" text="Limpeza concorrente" />
        <Legenda color="oklch(0.75 0.17 55)" text="Rotina camareira" />
        <LegendaSplit text="Concorrente + Camareira concluídas" />
        <Legenda color="oklch(0.5 0.02 260)" text="Sem rotinas registradas" />
        {erro && <span className="text-[oklch(0.7_0.18_25)] normal-case">{erro}</span>}
        {loading && <span className="normal-case">carregando…</span>}
      </div>

      <main className="flex-1 overflow-y-auto px-4 lg:px-6 pb-8 space-y-6">
        {grupos.map((g) => (
          <section key={g.block}>
            <h2 className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 border-white/40 bg-white/[0.06] px-3 py-2 text-xl lg:text-3xl font-black uppercase tracking-wide">
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
                  total={g.beds.length}
                  color={CONCORRENTE_COLOR}
                  label="Concorrente"
                />
                {periodo === "tarde" && (
                  <ProgressBar
                    value={g.camareiraRealizadas}
                    total={g.beds.length}
                    color={CAMAREIRA_COLOR}
                    label="Camareira"
                  />
                )}
              </span>
            </h2>
            <div className="space-y-3">
              {g.floors.map((floor) => (
                <div key={floor} className="flex items-start gap-3">
                  <span className="mt-1.5 w-10 flex-none text-right font-mono text-[11px] text-white/35">
                    {floor}º
                  </span>
                  <div className="flex flex-wrap gap-2.5">
                    {g.beds
                      .filter((b) => bedFloor(b.n) === floor)
                      .map((b) => (
                        <BedTile
                          key={b.n}
                          bed={b.n}
                          events={byBed.get(b.n)}
                          onSelect={() => setSelectedBed({ bed: b.n, events: byBed.get(b.n) })}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
      {selectedBed && (
        <BedDetailSheet
          bed={selectedBed.bed}
          events={selectedBed.events}
          onClose={() => setSelectedBed(null)}
        />
      )}
      <Link
        to="/terminal-geral"
        title="Ver limpeza terminal de áreas comuns"
        className="fixed right-0 top-1/2 z-50 -translate-y-1/2 flex flex-col items-center gap-1 rounded-l-xl border border-r-0 border-white/15 bg-[oklch(0.2_0.02_265_/_0.85)] px-1.5 py-3 text-white/60 backdrop-blur transition-colors hover:bg-[oklch(0.28_0.03_265_/_0.9)] hover:text-white"
      >
        <ChevronRight className="h-5 w-5" />
        <span className="text-[9px] uppercase tracking-widest [writing-mode:vertical-rl]">Geral</span>
      </Link>
    </div>
  );
}

function BedDetailSheet({
  bed,
  events,
  onClose,
}: {
  bed: string;
  events: { concorrente?: DailyBedEvent; camareira?: DailyBedEvent } | undefined;
  onClose: () => void;
}) {
  const c = events?.concorrente;
  const k = events?.camareira;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 lg:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-xl border border-white/15 bg-[oklch(0.19_0.02_265)] p-4 lg:rounded-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">Leito {bed}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2.5">
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
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: color.replace(")", " / 0.35)"), background: color.replace(")", " / 0.08)") }}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase" style={{ color }}>
        {icon}
        {label}
      </div>
      {event ? (
        <div className="mt-1 space-y-0.5 text-sm">
          <div className="font-semibold">{event.staff ?? <span className="text-white/40">Colaborador não identificado</span>}</div>
          <div className="text-xs text-white/50">
            {event.status === "in_progress" ? "Em execução desde" : "Concluída às"} {formatTime(event.at)}
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
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: "linear-gradient(90deg, oklch(0.72 0.16 235) 50%, oklch(0.75 0.17 55) 50%)" }}
      />
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
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/50" title={label}>
        {pct}%
      </span>
    </span>
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
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: `${color.replace(")", " / 0.3)")}`, background: color.replace(")", " / 0.08)") }}
    >
      <div className="flex items-center gap-1.5 text-xs lg:text-sm font-semibold uppercase" style={{ color }}>
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

function BedTile({
  bed,
  events,
  onSelect,
}: {
  bed: string;
  events: { concorrente?: DailyBedEvent; camareira?: DailyBedEvent } | undefined;
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
  const repeatBadge = Math.max(c?.count ?? 0, k?.count ?? 0) > 1 ? Math.max(c?.count ?? 0, k?.count ?? 0) : null;

  const title = both
    ? `Leito ${bed} · Concorrente ${activeC ? "em execução" : `concluída (×${c!.count})`}${c!.staff ? ` · ${c!.staff}` : ""} + Camareira ${
        activeK ? "em execução" : `concluída (×${k!.count})`
      }${k!.staff ? ` · ${k!.staff}` : ""}`
    : hasC
      ? `Leito ${bed} · Limpeza concorrente · ${activeC ? "em execução" : `concluída ×${c!.count}`}${c!.staff ? ` · ${c!.staff}` : ""} · ${c!.shift}`
      : hasK
        ? `Leito ${bed} · Rotina camareira · ${activeK ? "em execução" : `concluída ×${k!.count}`}${k!.staff ? ` · ${k!.staff}` : ""} · ${k!.shift}`
        : `Leito ${bed} · sem rotina neste turno`;

  const background = both
    ? `linear-gradient(90deg, ${CONCORRENTE_COLOR.replace(")", " / 0.28)")} 50%, ${CAMAREIRA_COLOR.replace(")", " / 0.28)")} 50%)`
    : hasC
      ? CONCORRENTE_COLOR.replace(")", activeC ? " / 0.22)" : " / 0.14)")
      : hasK
        ? CAMAREIRA_COLOR.replace(")", activeK ? " / 0.22)" : " / 0.14)")
        : SEM_ROTINA_COLOR.replace(")", " / 0.14)");

  const borderColor = both
    ? "oklch(0.9 0.01 260 / 0.55)"
    : hasC
      ? CONCORRENTE_COLOR.replace(")", " / 0.65)")
      : hasK
        ? CAMAREIRA_COLOR.replace(")", " / 0.65)")
        : SEM_ROTINA_COLOR.replace(")", " / 0.65)");

  const textColor = hasC || hasK ? "oklch(0.97 0.005 260)" : SEM_ROTINA_COLOR;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex h-[11px] items-center gap-1 font-mono text-[8px] leading-none tabular-nums">
        {hasC && <span style={{ color: CONCORRENTE_COLOR }}>{formatTime(c!.at)}</span>}
        {hasC && hasK && <span className="text-white/25">·</span>}
        {hasK && <span style={{ color: CAMAREIRA_COLOR }}>{formatTime(k!.at)}</span>}
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
          boxShadow: anyActive
            ? `0 0 12px -2px ${(activeC ? CONCORRENTE_COLOR : CAMAREIRA_COLOR).replace(")", " / 0.55)")}`
            : undefined,
        }}
      >
        <span className="font-semibold tabular-nums leading-none">{bed}</span>
        <span className="mt-1 flex h-4 items-center justify-center gap-1">
          {activeK && <BedDouble className="h-3.5 w-3.5 animate-linen" style={{ color: CAMAREIRA_COLOR }} />}
          {activeC && <BrushCleaning className="h-3.5 w-3.5 animate-sweep" style={{ color: CONCORRENTE_COLOR }} />}
          {!anyActive && (hasC || hasK) && <CircleCheck className="h-3 w-3 opacity-90" />}
          {!anyActive && !hasC && !hasK && (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEM_ROTINA_COLOR }} />
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
