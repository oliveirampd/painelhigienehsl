import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock3, X } from "lucide-react";
import { getTerminalGeral, type TerminalGeralEvent, type TerminalGeralBlock } from "@/lib/terminalGeral.functions";
import { getOperationsAnalytics, type OperationsAnalytics } from "@/lib/analytics.functions";
import { usePanelTheme } from "@/hooks/usePanelTheme";
import { useCarouselScroll } from "@/hooks/useCarouselScroll";
import { UpdatesModal } from "@/components/UpdatesModal";
import { PanelNav } from "@/components/PanelNav";
import { ThemeToggle } from "@/components/ThemeToggle";

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
const BLOCK_COLOR: Record<TerminalGeralBlock, string> = {
  D: "oklch(0.66 0.20 145)",
  E: "oklch(0.62 0.22 300)",
  C: "oklch(0.64 0.20 245)",
  B: "oklch(0.63 0.23 25)",
  A: "oklch(0.70 0.16 80)",
  outro: "oklch(0.58 0.04 255)",
};
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

function shiftInfoBRT(nowMs: number) {
  const wall = new Date(nowMs - 3 * 60 * 60 * 1000);
  const nowMin = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  let startMin = 22 * 60;
  let endMin = 24 * 60 + 6 * 60 + 20;
  let label = "Noite";
  if (nowMin >= 6 * 60 + 20 && nowMin < 13 * 60 + 40) {
    startMin = 6 * 60 + 20;
    endMin = 13 * 60 + 40;
    label = "Manhã";
  } else if (nowMin >= 13 * 60 + 40 && nowMin < 22 * 60) {
    startMin = 13 * 60 + 40;
    endMin = 22 * 60;
    label = "Tarde";
  }
  const adjustedNow = startMin === 22 * 60 && nowMin < 6 * 60 + 20 ? nowMin + 24 * 60 : nowMin;
  const progress = Math.max(0, Math.min(1, (adjustedNow - startMin) / (endMin - startMin)));
  const remainingMin = Math.max(0, endMin - adjustedNow);
  return { label, progress, remainingMin };
}

function formatRemaining(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function TerminalGeralPage() {
  const { isDark, themeClass, toggleTheme } = usePanelTheme();
  const [events, setEvents] = useState<TerminalGeralEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const [now, setNow] = useState(Date.now());
  const [selectedArea, setSelectedArea] = useState<TerminalGeralEvent | null>(null);
  const [historicalAreas, setHistoricalAreas] = useState<OperationsAnalytics["generalAreas"]>([]);
  const mainRef = useCarouselScroll<HTMLElement>();

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        }),
      );
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

  useEffect(() => {
    let alive = true;
    async function loadHistory() {
      try {
        const analytics = await getOperationsAnalytics();
        if (alive) setHistoricalAreas(analytics.generalAreas);
      } catch (err) {
        console.error(err);
      }
    }
    void loadHistory();
    const id = setInterval(() => void loadHistory(), 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const historyByArea = useMemo(
    () => new Map(historicalAreas.map((x) => [`${x.unit}|${x.area}`, x])),
    [historicalAreas],
  );

  const emAndamento = events.filter((e) => e.status === "in_progress");
  const pendentes = events.filter((e) => e.status === "pendente");
  const concluidas = events.filter((e) => e.status === "completed");
  const shift = shiftInfoBRT(now);
  const coverage = events.length ? Math.round((concluidas.length / events.length) * 100) : 0;

  const blockAttention = useMemo(() => {
    return BLOCK_ORDER.map((block) => {
      const items = events.filter((e) => e.block === block);
      const pending = items.filter((e) => e.status === "pendente").length;
      const completed = items.filter((e) => e.status === "completed").length;
      return {
        block,
        total: items.length,
        pending,
        completed,
        ratio: items.length ? pending / items.length : 0,
      };
    })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.pending - a.pending || b.ratio - a.ratio);
  }, [events]);

  const criticalAreas = useMemo(() => {
    if (shift.progress < 0.65) return [];
    const hottestBlocks = new Set(blockAttention.filter((b) => b.pending >= 2).slice(0, 2).map((b) => b.block));
    return events
      .filter((e) => e.status === "pendente" && (hottestBlocks.has(e.block as any) || shift.progress > 0.85))
      .sort((a, b) => {
        const ah = historyByArea.get(`${a.unit}|${a.area}`)?.completed7d ?? Number.MAX_SAFE_INTEGER;
        const bh = historyByArea.get(`${b.unit}|${b.area}`)?.completed7d ?? Number.MAX_SAFE_INTEGER;
        return ah - bh;
      })
      .slice(0, 6);
  }, [events, blockAttention, shift.progress, historyByArea]);

  useEffect(() => {
    if (!events.length || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const area = params.get("area");
    const unit = params.get("unit");
    if (!area) return;
    const match = events.find((e) => e.area === area && (!unit || e.unit === unit));
    if (match) setSelectedArea(match);
  }, [events]);

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
    <div className={`${themeClass} min-h-screen w-full flex flex-col overflow-y-auto font-sans bg-background text-foreground lg:h-screen lg:overflow-hidden`}>
      <header className="panel-shell-header flex-none flex flex-col gap-2 border-b border-white/15 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-bold tracking-tight lg:text-2xl">Limpeza Terminal Geral — Áreas Comuns</h1>
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

      <div className="flex-none grid grid-cols-3 gap-2 px-4 lg:px-6 py-3">
        <Kpi label="Em andamento" value={emAndamento.length} color="oklch(0.75 0.22 155)" />
        <Kpi label="Pendentes" value={pendentes.length} color="oklch(0.78 0.2 60)" />
        <Kpi label="Concluídas" value={concluidas.length} color="oklch(0.72 0.16 235)" />
      </div>

      <div className="flex-none px-4 lg:px-6 pb-3">
        <div className="panel-surface grid gap-3 rounded-xl border px-3 py-2.5 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/35">
                  Cobertura do turno {shift.label}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">{coverage}%</span>
                  <span className="text-xs text-white/40">{concluidas.length}/{events.length} áreas concluídas</span>
                </div>
              </div>
              <div className="text-right text-xs text-white/45">
                <Clock3 className="mb-1 ml-auto h-4 w-4" />
                janela restante
                <div className="font-mono text-sm font-semibold text-white/75">{formatRemaining(shift.remainingMin)}</div>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[oklch(0.72_0.16_235)]"
                style={{ width: `${coverage}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-white/30">
              A cobertura considera os registros exibidos para a janela operacional atual.
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/35">Pendências em destaque</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {criticalAreas.length ? (
                criticalAreas.map((e) => (
                  <button
                    key={`${e.block}-${e.floorLabel}-${e.area}`}
                    type="button"
                    onClick={() => setSelectedArea(e)}
                    className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1 text-left text-[11px] text-amber-100/80 hover:bg-amber-400/[0.1]"
                  >
                    <strong>{e.area}</strong>
                    <span className="ml-1 text-white/35">· {e.block === "outro" ? e.outroGrupo : `Bloco ${e.block} ${e.floor ?? ""}º`}</span>
                    {historyByArea.get(`${e.unit}|${e.area}`) && (
                      <span className="ml-1 text-white/30">
                        · {historyByArea.get(`${e.unit}|${e.area}`)!.completed7d} registros/7d
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <span className="text-xs text-white/40">
                  {shift.progress < 0.65 ? "Turno ainda em andamento; sem pendência destacada." : "Nenhuma pendência destacada agora."}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-none px-4 pb-2 lg:px-6">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {blockAttention.map((b) => {
            const pct = b.total ? Math.round((b.completed / b.total) * 100) : 0;
            return (
              <div
                key={b.block}
                className="min-w-[116px] rounded-lg border px-2.5 py-2"
                style={{
                  borderColor: BLOCK_COLOR[b.block].replace(")", " / 0.45)"),
                  backgroundColor: BLOCK_COLOR[b.block].replace(")", " / 0.10)"),
                }}
              >
                <div className="text-[9px] uppercase tracking-widest text-white/30">
                  {b.block === "outro" ? "Outras áreas" : `Bloco ${b.block}`}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <strong className="text-lg tabular-nums">{pct}%</strong>
                  <span className="text-[10px] text-white/35">{b.pending} pend.</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(erro || loading) && (
        <div className="flex-none px-4 pb-2 lg:px-6">
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-xs ${
              erro
                ? "border-red-400/25 bg-red-400/[0.06] text-red-200"
                : "border-white/10 bg-white/[0.025] text-white/50"
            }`}
          >
            {erro ?? "Atualizando áreas comuns…"}
          </div>
        </div>
      )}

      <main ref={mainRef} className="scrollbar-hidden min-h-[46vh] flex-1 space-y-6 overflow-y-auto px-4 pb-8 lg:min-h-0 lg:px-6">
        {events.length === 0 && !loading && !erro && (
          <div className="panel-state mt-4 rounded-xl px-4 py-8 text-center text-sm text-white/45">
            Nenhuma área de Limpeza Terminal Geral encontrada nesta janela.
          </div>
        )}
        {gruposComBloco.map((g) => (
          <section key={g.block}>
            <h2
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 px-3 py-2 text-lg lg:text-2xl font-black uppercase tracking-wide"
              style={{
                borderLeftColor: BLOCK_COLOR[g.block],
                backgroundColor: BLOCK_COLOR[g.block].replace(")", " / 0.10)"),
              }}
            >
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
                            <AreaCard key={`${e.block}-${e.floorLabel}-${e.area}`} event={e} now={now} shiftRemaining={shift.remainingMin} onSelect={() => setSelectedArea(e)} />
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
                                  <AreaCard key={`${e.block}-${e.floorLabel}-${e.area}`} event={e} now={now} shiftRemaining={shift.remainingMin} onSelect={() => setSelectedArea(e)} />
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
            <h2
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 px-3 py-2 text-lg lg:text-2xl font-black uppercase tracking-wide"
              style={{
                borderLeftColor: BLOCK_COLOR.outro,
                backgroundColor: BLOCK_COLOR.outro.replace(")", " / 0.10)"),
              }}
            >
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
                        <AreaCard key={`${e.block}-${e.outroGrupo}-${e.area}`} event={e} now={now} shiftRemaining={shift.remainingMin} onSelect={() => setSelectedArea(e)} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <UpdatesModal />
      {selectedArea && (
        <AreaDetailModal
          event={selectedArea}
          history={historyByArea.get(`${selectedArea.unit}|${selectedArea.area}`)}
          onClose={() => setSelectedArea(null)}
        />
      )}
    </div>
  );
}

function AreaDetailModal({
  event: e,
  history,
  onClose,
}: {
  event: TerminalGeralEvent;
  history?: OperationsAnalytics["generalAreas"][number];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm lg:items-center lg:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes da área ${e.area}`}
        className="scrollbar-hidden max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/15 bg-[oklch(0.18_0.025_265)] p-4 lg:rounded-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/35">Área comum</div>
            <h3 className="mt-1 text-xl font-bold">{e.area}</h3>
            <p className="mt-0.5 text-xs text-white/45">{e.unit}</p>
          </div>
          <button type="button" aria-label="Fechar detalhes da área" onClick={onClose} className="rounded-full p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">
          <div className="space-y-2 text-sm">
            <div><span className="text-white/40">Status:</span> <strong>{STATUS_LABEL[e.status]}</strong></div>
            <div><span className="text-white/40">Colaborador:</span> {e.staff || "—"}</div>
            {e.at && <div><span className="text-white/40">Horário:</span> {new Date(e.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</div>}
            {e.reason && <div><span className="text-white/40">Observação:</span> {e.reason}</div>}
            {history && (
              <div>
                <span className="text-white/40">Recorrência recente:</span>{" "}
                <strong>{history.completed7d} registros concluídos</strong> em {history.activeDays} dia(s) da amostra
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AreaCard({
  event: e,
  now,
  shiftRemaining,
  onSelect,
}: {
  event: TerminalGeralEvent;
  now: number;
  shiftRemaining: number;
  onSelect?: () => void;
}) {
  const tone = STATUS_TONE[e.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-[150px] max-w-[240px] flex-1 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05] active:scale-[0.99] sm:flex-none sm:basis-[210px]"
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
      {e.status === "pendente" && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-white/40">
          <span>{e.reason || `janela encerra em ${formatRemaining(shiftRemaining)}`}</span>

        </div>
      )}
      {e.status === "completed" && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-white/35">
          <span>concluída nesta janela</span>

        </div>
      )}
    </button>
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
