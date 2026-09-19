import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Footprints, OctagonX, UtensilsCrossed, CirclePause } from "lucide-react";
import { getTerminalGeral, type TerminalGeralEvent, type BlockGroup } from "@/lib/terminalGeral.functions";

export const Route = createFileRoute("/terminal-geral")({
  head: () => ({
    meta: [
      { title: "Limpeza Terminal Geral — Áreas Comuns" },
      {
        name: "description",
        content: "Limpeza terminal de áreas comuns (não leitos) em tempo real, por bloco.",
      },
    ],
  }),
  component: TerminalGeralPage,
});

const GROUP_LABEL: Record<BlockGroup, string> = {
  DE: "Bloco D/E",
  BC: "Bloco B/C",
  outro: "Outras áreas",
};
const GROUP_ORDER: BlockGroup[] = ["DE", "BC", "outro"];

function TerminalGeralPage() {
  const [events, setEvents] = useState<TerminalGeralEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await getTerminalGeral();
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

  const emLimpeza = events.filter((e) => e.status === "in_progress");
  const aCaminho = events.filter((e) => e.status === "en_route");
  const aguardando = events.filter((e) => e.status === "waiting_cleaning");
  const pausadas = events.filter((e) => e.status === "paused");
  const concluidas = events.filter((e) => e.status === "completed");

  const grupos = GROUP_ORDER.map((group) => ({
    group,
    items: events
      .filter((e) => e.blockGroup === group)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.area.localeCompare(b.area)),
  })).filter((g) => g.items.length > 0);

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
          <h1 className="text-base lg:text-2xl font-bold tracking-tight">Limpeza Terminal Geral — Áreas Comuns</h1>
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

      <div className="flex-none grid grid-cols-2 lg:grid-cols-5 gap-2 px-4 lg:px-6 py-3">
        <Kpi icon={<UtensilsCrossed className="h-4 w-4" />} label="Em limpeza" value={emLimpeza.length} color="oklch(0.75 0.22 155)" />
        <Kpi icon={<Footprints className="h-4 w-4" />} label="A caminho" value={aCaminho.length} color="oklch(0.74 0.18 230)" />
        <Kpi icon={<OctagonX className="h-4 w-4" />} label="Aguardando" value={aguardando.length} color="oklch(0.78 0.2 60)" />
        <Kpi icon={<CirclePause className="h-4 w-4" />} label="Pausadas" value={pausadas.length} color="oklch(0.72 0.23 25)" />
        <Kpi icon={<CircleCheck className="h-4 w-4" />} label="Concluídas" value={concluidas.length} color="oklch(0.7 0.02 260)" />
      </div>

      {(erro || loading) && (
        <div className="flex-none px-4 lg:px-6 pb-2 text-xs text-white/50">
          {erro && <span className="text-[oklch(0.7_0.18_25)]">{erro}</span>}
          {loading && !erro && <span>carregando…</span>}
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 lg:px-6 pb-8 space-y-6">
        {grupos.length === 0 && !loading && (
          <p className="text-sm text-white/40 pt-6">Nenhuma rotina de Limpeza Terminal Geral nas últimas 26h.</p>
        )}
        {grupos.map((g) => (
          <section key={g.group}>
            <h2 className="mb-3 flex items-center gap-3 rounded-md border-l-4 border-white/40 bg-white/[0.06] px-3 py-2 text-xl lg:text-2xl font-black uppercase tracking-wide">
              <span>{GROUP_LABEL[g.group]}</span>
              <span className="text-sm lg:text-base font-normal normal-case tracking-normal text-white/40">
                {g.items.length} {g.items.length === 1 ? "área" : "áreas"}
              </span>
            </h2>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full border-collapse">
                <thead className="text-[10px] uppercase tracking-widest text-white/50 bg-[oklch(0.16_0.02_265)]">
                  <tr>
                    <th className="text-left px-3 lg:px-4 py-1.5">Área</th>
                    <th className="text-left px-3 lg:px-4 py-1.5">Unidade</th>
                    <th className="text-left px-3 lg:px-4 py-1.5">Status</th>
                    <th className="text-left px-3 lg:px-4 py-1.5">Colaborador</th>
                    <th className="text-left px-3 lg:px-4 py-1.5">Há</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((e) => (
                    <tr key={e.area} style={{ background: STATUS_TONE[e.status].replace(")", " / 0.14)") }}>
                      <td className="px-3 lg:px-4 py-2 text-sm font-semibold border-t border-white/5">{e.area}</td>
                      <td className="px-3 lg:px-4 py-2 text-xs text-white/50 border-t border-white/5">{e.unit}</td>
                      <td className="px-3 lg:px-4 py-2 text-xs border-t border-white/5">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px]"
                          style={{ color: STATUS_TONE[e.status], background: STATUS_TONE[e.status].replace(")", " / 0.16)") }}
                        >
                          {STATUS_LABEL[e.status]}
                        </span>
                        {e.status === "paused" && e.reason && (
                          <span className="ml-2 text-white/50 normal-case">{e.reason}</span>
                        )}
                      </td>
                      <td className="px-3 lg:px-4 py-2 text-xs border-t border-white/5">{e.staff || "—"}</td>
                      <td className="px-3 lg:px-4 py-2 text-xs font-mono tabular-nums border-t border-white/5">
                        {formatElapsed(e.at, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </main>

      <Link
        to="/diaria"
        title="Ver higiene diária de todos os leitos"
        className="fixed right-0 top-1/2 z-50 -translate-y-1/2 flex flex-col items-center gap-1 rounded-l-xl border border-r-0 border-white/15 bg-[oklch(0.2_0.02_265_/_0.85)] px-1.5 py-3 text-white/60 backdrop-blur transition-colors hover:bg-[oklch(0.28_0.03_265_/_0.9)] hover:text-white"
      >
        <ChevronRight className="h-5 w-5" />
        <span className="text-[9px] uppercase tracking-widest [writing-mode:vertical-rl]">Diária</span>
      </Link>
    </div>
  );
}

const STATUS_LABEL: Record<TerminalGeralEvent["status"], string> = {
  waiting_cleaning: "Aguardando",
  en_route: "A caminho",
  in_progress: "Em limpeza",
  paused: "Pausada",
  completed: "Concluída",
};
const STATUS_TONE: Record<TerminalGeralEvent["status"], string> = {
  waiting_cleaning: "oklch(0.78 0.2 60)",
  en_route: "oklch(0.74 0.18 230)",
  in_progress: "oklch(0.75 0.22 155)",
  paused: "oklch(0.72 0.23 25)",
  completed: "oklch(0.7 0.02 260)",
};
const STATUS_ORDER: Record<TerminalGeralEvent["status"], number> = {
  paused: 0,
  in_progress: 1,
  en_route: 2,
  waiting_cleaning: 3,
  completed: 4,
};

function formatElapsed(iso: string, nowMs: number): string {
  const totalMin = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function Kpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: color.replace(")", " / 0.3)"), background: color.replace(")", " / 0.08)") }}
    >
      <div className="flex items-center gap-1.5 text-xs lg:text-sm font-semibold uppercase" style={{ color }}>
        {icon}
        {label}
      </div>
      <div className="text-2xl lg:text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
