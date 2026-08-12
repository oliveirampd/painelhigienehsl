import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrushCleaning, BedDouble, CircleCheck, ChevronLeft, Circle } from "lucide-react";
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

function DiariaPage() {
  const [events, setEvents] = useState<DailyBedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const scrollRef = useRef<HTMLElement | null>(null);

  // Rolagem automática: desce devagar até o fim da lista, pausa, volta ao topo,
  // pausa de novo e repete — pensado pra rodar sozinho numa TV, sem controle manual.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let direction: 1 | -1 = 1;
    let paused = false;
    let rafId = 0;
    let resumeTimeout: ReturnType<typeof setTimeout> | null = null;
    const SPEED_PX_PER_FRAME = 0.6;
    const PAUSE_MS = 2500;

    const step = () => {
      rafId = requestAnimationFrame(step);
      if (paused) return;

      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;

      el.scrollTop += direction * SPEED_PX_PER_FRAME;

      const atBottom = el.scrollTop >= max - 1;
      const atTop = el.scrollTop <= 1;

      if (atBottom || atTop) {
        paused = true;
        direction = atBottom ? -1 : 1;
        resumeTimeout = setTimeout(() => {
          paused = false;
        }, PAUSE_MS);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
      if (resumeTimeout) clearTimeout(resumeTimeout);
    };
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
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

  const byBed = useMemo(() => {
    const m = new Map<string, DailyBedEvent>();
    for (const e of events) m.set(e.bed, e);
    return m;
  }, [events]);

  const emHigiene = events.filter((e) => e.status === "in_progress" && e.kind === "concorrente");
  const emCamareira = events.filter((e) => e.status === "in_progress" && e.kind === "camareira");
  const concluidos = events.filter((e) => e.status === "completed").length;

  const grupos = BLOCK_ORDER.map((block) => {
    const beds = HOSPITAL_BEDS.filter((b) => b.b === block);
    const floors = Array.from(new Set(beds.map((b) => bedFloor(b.n)))).sort((a, b) => b - a);
    return { block, floors, beds };
  }).filter((g) => g.beds.length > 0);

  return (
    <div className="dark min-h-screen w-full flex flex-col font-sans bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)]">
      <header className="flex-none flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between px-4 lg:px-6 py-2.5 border-b border-white/15">
        <div className="flex items-center gap-3">
          <Link
            to="/tv"
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] uppercase tracking-wide text-white/60 transition-colors hover:bg-white/10"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Terminal
          </Link>
          <h1 className="text-base lg:text-2xl font-bold tracking-tight">Higiene Diária — Leitos</h1>
        </div>
        <div className="flex items-center gap-3 lg:gap-5 text-[10px] lg:text-xs">
          <span className="flex items-center gap-1.5 uppercase tracking-widest text-white/50">
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

      <div className="flex-none grid grid-cols-2 lg:grid-cols-4 gap-2 px-4 lg:px-6 py-3">
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
          color="oklch(0.78 0.15 90)"
        />
        <Kpi
          icon={<CircleCheck className="h-4 w-4" />}
          label="Concluídos no turno"
          value={concluidos}
          color="oklch(0.72 0.16 150)"
        />
        <Kpi
          icon={<Circle className="h-4 w-4" />}
          label="Total de leitos"
          value={HOSPITAL_BEDS.length}
          color="oklch(0.7 0.02 260)"
        />
      </div>

      <div className="flex items-center gap-4 px-4 lg:px-6 pb-2 text-[10px] uppercase tracking-wide text-white/45">
        <Legenda color="oklch(0.72 0.16 235)" text="Limpeza concorrente" />
        <Legenda color="oklch(0.78 0.15 90)" text="Rotina camareira" />
        <Legenda color="oklch(0.72 0.16 150)" text="Concluído" />
        <Legenda color="oklch(0.62 0.21 25)" text="Sem rotina no turno" />
        {erro && <span className="text-[oklch(0.7_0.18_25)] normal-case">{erro}</span>}
        {loading && <span className="normal-case">carregando…</span>}
      </div>

      <main ref={scrollRef} className="flex-1 overflow-y-auto px-4 lg:px-6 pb-8 space-y-6 scroll-smooth">
        {grupos.map((g) => (
          <section key={g.block}>
            <h2 className="mb-3 flex items-center gap-3 rounded-md border-l-4 border-white/40 bg-white/[0.06] px-3 py-2 text-xl lg:text-3xl font-black uppercase tracking-wide">
              <span>Bloco {g.block}</span>
              <span className="text-sm lg:text-base font-normal normal-case tracking-normal text-white/40">
                {g.beds.length} leitos
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
                        <BedTile key={b.n} bed={b.n} ev={byBed.get(b.n)} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
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
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide" style={{ color }}>
        {icon}
        {label}
      </div>
      <div className="text-2xl lg:text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function BedTile({ bed, ev }: { bed: string; ev: DailyBedEvent | undefined }) {
  const active = ev?.status === "in_progress";
  const camareira = ev?.kind === "camareira";
  const done = ev?.status === "completed";

  const color = active
    ? camareira
      ? "oklch(0.78 0.15 90)"
      : "oklch(0.72 0.16 235)"
    : done
      ? "oklch(0.72 0.16 150)"
      : "oklch(0.62 0.21 25)";

  const title = ev
    ? `Leito ${bed} · ${camareira ? "Rotina camareira" : "Limpeza concorrente"} · ${
        active ? "em execução" : "concluído"
      }${ev.staff ? ` · ${ev.staff}` : ""} · ${ev.shift}`
    : `Leito ${bed} · sem rotina neste turno`;

  const semRotina = !ev;

  return (
    <div
      title={title}
      className="relative flex h-12 w-[62px] flex-col items-center justify-center rounded-md border text-[11px] font-mono transition-colors"
      style={{
        borderColor: color.replace(")", active || semRotina ? " / 0.65)" : " / 0.28)"),
        background: active
          ? color.replace(")", " / 0.16)")
          : semRotina
            ? color.replace(")", " / 0.14)")
            : "oklch(0.2 0.02 265 / 0.6)",
        color: active || done || semRotina ? color : "oklch(0.62 0.02 260)",
        boxShadow: active ? `0 0 12px -2px ${color.replace(")", " / 0.5)")}` : undefined,
      }}
    >
      <span className="font-semibold tabular-nums leading-none">{bed}</span>
      <span className="mt-1 flex h-4 items-center justify-center">
        {active ? (
          camareira ? (
            <BedDouble className="h-3.5 w-3.5 animate-linen" />
          ) : (
            <BrushCleaning className="h-3.5 w-3.5 animate-sweep" />
          )
        ) : done ? (
          <CircleCheck className="h-3 w-3 opacity-80" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        )}
      </span>
    </div>
  );
}
