import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTerminalGeral, type TerminalGeralEvent, type TerminalGeralBlock } from "@/lib/terminalGeral.functions";
import { useCarouselScroll } from "@/hooks/useCarouselScroll";
import { UpdatesModal } from "@/components/UpdatesModal";

export const Route = createFileRoute("/terminal-geral")({
  head: () => ({
    meta: [
      { title: "Limpeza Terminal Geral — Áreas Comuns" },
      {
        name: "description",
        content: "Limpeza terminal de áreas comuns (não leitos) em tempo real, organizada por bloco e andar.",
      },
    ],
  }),
  component: TerminalGeralPage,
});

const BLOCK_ORDER: TerminalGeralBlock[] = ["D", "E", "C", "B", "A"];
const BLOCK_LABEL: Record<TerminalGeralBlock, string> = {
  D: "Bloco D",
  E: "Bloco E",
  C: "Bloco C",
  B: "Bloco B",
  A: "Bloco A",
  outro: "Outras áreas",
};

const STATUS_LABEL: Record<TerminalGeralEvent["status"], string> = {
  in_progress: "Em andamento",
  pendente: "Pendente",
  completed: "Concluída",
};
const STATUS_TONE: Record<TerminalGeralEvent["status"], string> = {
  in_progress: "oklch(0.75 0.22 155)",
  pendente: "oklch(0.78 0.2 60)",
  completed: "oklch(0.72 0.16 235)",
};

function TerminalGeralPage() {
  const [events, setEvents] = useState<TerminalGeralEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const [now, setNow] = useState(Date.now());
  const mainRef = useCarouselScroll<HTMLElement>();

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

  const emAndamento = events.filter((e) => e.status === "in_progress");
  const pendentes = events.filter((e) => e.status === "pendente");
  const concluidas = events.filter((e) => e.status === "completed");

  const gruposComBloco = BLOCK_ORDER.map((block) => {
    const items = events.filter((e) => e.block === block);
    const floors = Array.from(new Set(items.map((e) => e.floor).filter((f): f is number => f != null))).sort(
      (a, b) => b - a,
    );
    return { block, items, floors };
  }).filter((g) => g.items.length > 0);

  // "Outras áreas": agrupadas pelo nome real do grupo original (ex: "Térreo B",
  // "Mezanino Diretoria") em vez de uma lista única sem contexto.
  const outrasPorGrupo = Array.from(
    events
      .filter((e) => e.block === "outro")
      .reduce((m, e) => {
        const label = e.outroGrupo || "Outras áreas";
        if (!m.has(label)) m.set(label, []);
        m.get(label)!.push(e);
        return m;
      }, new Map<string, TerminalGeralEvent[]>())
      .entries(),
  ).sort((a, b) => a[0].localeCompare(b[0]));

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
          <h1 className="text-sm lg:text-2xl font-bold tracking-tight">Limpeza Terminal Geral — Áreas Comuns</h1>
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

      <div className="flex-none grid grid-cols-3 gap-2 px-4 lg:px-6 py-3">
        <Kpi label="Em andamento" value={emAndamento.length} color="oklch(0.75 0.22 155)" />
        <Kpi label="Pendentes" value={pendentes.length} color="oklch(0.78 0.2 60)" />
        <Kpi label="Concluídas" value={concluidas.length} color="oklch(0.72 0.16 235)" />
      </div>

      {(erro || loading) && (
        <div className="flex-none px-4 lg:px-6 pb-2 text-xs text-white/50">
          {erro && <span className="text-[oklch(0.7_0.18_25)]">{erro}</span>}
          {loading && !erro && <span>carregando…</span>}
        </div>
      )}

      <main ref={mainRef} className="flex-1 overflow-y-auto px-4 lg:px-6 pb-8 space-y-6">
        {events.length === 0 && !loading && !erro && (
          <p className="text-sm text-white/40 pt-6">Nenhuma área de Limpeza Terminal Geral encontrada.</p>
        )}
        {gruposComBloco.map((g) => (
          <section key={g.block}>
            <h2 className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 border-white/40 bg-white/[0.06] px-3 py-2 text-lg lg:text-2xl font-black uppercase tracking-wide">
              <span>{BLOCK_LABEL[g.block]}</span>
              <span className="text-xs lg:text-sm font-normal normal-case tracking-normal text-white/40">
                {g.items.length} {g.items.length === 1 ? "área" : "áreas"}
              </span>
            </h2>
            <div className="space-y-3">
              {g.floors.map((floor) => {
                const itemsDoAndar = g.items.filter((e) => e.floor === floor);
                const setores = Array.from(new Set(itemsDoAndar.map((e) => e.floorLabel))).sort((a, b) =>
                  (a || "").localeCompare(b || ""),
                );
                // Quando o andar tem só 1 setor, mostra direto (sem sub-cabeçalho redundante).
                // Quando tem mais de um (comum em 1ºss/subsolos, com vários setores no mesmo
                // número de andar), separa por setor pra não virar uma lista única confusa.
                return (
                  <div key={floor} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                    <span className="flex-none font-mono text-[11px] text-white/35 sm:mt-1.5 sm:w-10 sm:text-right">
                      {floor}º
                    </span>
                    {setores.length <= 1 ? (
                      <div className="flex flex-wrap gap-2">
                        {itemsDoAndar
                          .sort((a, b) => a.area.localeCompare(b.area))
                          .map((e) => (
                            <AreaCard key={`${e.block}-${e.floorLabel}-${e.area}`} event={e} now={now} />
                          ))}
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col gap-2">
                        {setores.map((setor) => (
                          <div key={setor} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                            <span className="flex-none text-[10px] font-semibold uppercase tracking-wide text-white/40 sm:w-32">
                              {setor}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {itemsDoAndar
                                .filter((e) => e.floorLabel === setor)
                                .sort((a, b) => a.area.localeCompare(b.area))
                                .map((e) => (
                                  <AreaCard key={`${e.block}-${e.floorLabel}-${e.area}`} event={e} now={now} />
                                ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {outrasPorGrupo.length > 0 && (
          <section>
            <h2 className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 border-white/40 bg-white/[0.06] px-3 py-2 text-lg lg:text-2xl font-black uppercase tracking-wide">
              <span>{BLOCK_LABEL.outro}</span>
            </h2>
            <div className="space-y-3">
              {outrasPorGrupo.map(([label, items]) => (
                <div key={label} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                  <span className="flex-none text-xs font-semibold text-white/50 sm:mt-1.5 sm:w-40">{label}</span>
                  <div className="flex flex-wrap gap-2">
                    {items
                      .sort((a, b) => a.area.localeCompare(b.area))
                      .map((e) => (
                        <AreaCard key={`${e.block}-${e.outroGrupo}-${e.area}`} event={e} now={now} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <Link
        to="/diaria"
        title="Ver higiene diária de todos os leitos"
        className="fixed right-0 top-1/2 z-50 -translate-y-1/2 flex flex-col items-center gap-1 rounded-l-xl border border-r-0 border-white/15 bg-[oklch(0.2_0.02_265_/_0.85)] px-1.5 py-3 text-white/60 backdrop-blur transition-colors hover:bg-[oklch(0.28_0.03_265_/_0.9)] hover:text-white"
      >
        <ChevronRight className="h-5 w-5" />
        <span className="text-[9px] uppercase tracking-widest [writing-mode:vertical-rl]">Diária</span>
      </Link>
      <UpdatesModal />
    </div>
  );
}

function AreaCard({ event: e, now }: { event: TerminalGeralEvent; now: number }) {
  const tone = STATUS_TONE[e.status];
  return (
    <div
      className="flex min-w-[150px] max-w-[240px] flex-1 flex-col gap-1 rounded-lg border px-2.5 py-2 sm:flex-none sm:basis-[210px]"
      style={{ borderColor: tone.replace(")", " / 0.4)"), background: tone.replace(")", " / 0.08)") }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold" title={e.area}>
          {e.area}
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
          style={{ color: tone, background: tone.replace(")", " / 0.16)") }}
        >
          {STATUS_LABEL[e.status]}
        </span>
      </div>
      <div className="truncate text-[11px] text-white/50">
        {e.staff ? e.staff : <span className="text-white/30">sem colaborador</span>}
      </div>
      {e.at && (
        <div className="font-mono text-[10px] tabular-nums text-white/40">
          {e.status === "in_progress" ? "há " : "concluída há "}
          {formatElapsed(e.at, now)}
        </div>
      )}
      {e.status === "pendente" && e.reason && <div className="truncate text-[10px] text-white/40">{e.reason}</div>}
    </div>
  );
}

function formatElapsed(iso: string, nowMs: number): string {
  const totalMin = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: color.replace(")", " / 0.3)"), background: color.replace(")", " / 0.08)") }}
    >
      <div className="text-[10px] lg:text-sm font-semibold uppercase" style={{ color }}>
        {label}
      </div>
      <div className="text-xl lg:text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
