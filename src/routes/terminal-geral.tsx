import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock3, QrCode, X } from "lucide-react";
import { getTerminalGeral, type TerminalGeralEvent, type TerminalGeralBlock } from "@/lib/terminalGeral.functions";
import { useCarouselScroll } from "@/hooks/useCarouselScroll";
import { UpdatesModal } from "@/components/UpdatesModal";
import { PanelNav } from "@/components/PanelNav";

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
  const [events, setEvents] = useState<TerminalGeralEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number>(Date.now());
  const [clock, setClock] = useState("");
  const [now, setNow] = useState(Date.now());
  const [selectedArea, setSelectedArea] = useState<TerminalGeralEvent | null>(null);
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
  const shift = shiftInfoBRT(now);
  const coverage = events.length ? Math.round((concluidas.length / events.length) * 100) : 0;

  const blockAttention = useMemo(() => {
    return BLOCK_ORDER.map((block) => {
      const items = events.filter((e) => e.block === block);
      const pending = items.filter((e) => e.status === "pendente").length;
      return {
        block,
        total: items.length,
        pending,
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
      .slice(0, 6);
  }, [events, blockAttention, shift.progress]);

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
    <div className="dark h-screen w-full flex flex-col overflow-hidden font-sans bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)]">
      <header className="flex-none flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between px-4 lg:px-6 py-2.5 border-b border-white/15">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-sm lg:text-2xl font-bold tracking-tight">Limpeza Terminal Geral — Áreas Comuns</h1>
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
          <span className="text-lg lg:text-2xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="flex-none grid grid-cols-3 gap-2 px-4 lg:px-6 py-3">
        <Kpi label="Em andamento" value={emAndamento.length} color="oklch(0.75 0.22 155)" />
        <Kpi label="Pendentes" value={pendentes.length} color="oklch(0.78 0.2 60)" />
        <Kpi label="Concluídas" value={concluidas.length} color="oklch(0.72 0.16 235)" />
      </div>

      <div className="flex-none px-4 lg:px-6 pb-3">
        <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 lg:grid-cols-[1fr_1.4fr]">
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
              Cadência atual: 1 ciclo por área no turno. Áreas concluídas voltam a ser esperadas no próximo turno.
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/35">Áreas que merecem atenção agora</div>
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
                  </button>
                ))
              ) : (
                <span className="text-xs text-white/40">
                  {shift.progress < 0.65 ? "Turno ainda em andamento, sem concentração crítica." : "Nenhuma concentração crítica agora."}
                </span>
              )}
            </div>
          </div>
        </div>
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
      {selectedArea && <AreaDetailModal event={selectedArea} onClose={() => setSelectedArea(null)} />}
    </div>
  );
}

function AreaDetailModal({ event: e, onClose }: { event: TerminalGeralEvent; onClose: () => void }) {
  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/terminal-geral?area=${encodeURIComponent(e.area)}&unit=${encodeURIComponent(e.unit)}`;
  const qr = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&ecc=M&qzone=2&data=${encodeURIComponent(url)}`
    : "";
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm lg:items-center lg:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-white/15 bg-[oklch(0.18_0.025_265)] p-4 lg:rounded-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/35">Área comum</div>
            <h3 className="mt-1 text-xl font-bold">{e.area}</h3>
            <p className="mt-0.5 text-xs text-white/45">{e.unit}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="space-y-2 text-sm">
            <div><span className="text-white/40">Status:</span> <strong>{STATUS_LABEL[e.status]}</strong></div>
            <div><span className="text-white/40">Colaborador:</span> {e.staff || "—"}</div>
            {e.at && <div><span className="text-white/40">Horário:</span> {new Date(e.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</div>}
            {e.reason && <div><span className="text-white/40">Observação:</span> {e.reason}</div>}
            <div className="rounded-lg border border-white/10 bg-black/10 p-2 text-xs text-white/45">
              Este QR abre diretamente esta área no painel para consulta rápida no local.
            </div>
          </div>
          {qr && (
            <div className="rounded-xl bg-white p-2">
              <img src={qr} alt={`QR da área ${e.area}`} className="h-[164px] w-[164px]" />
            </div>
          )}
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
      className="flex min-w-[150px] max-w-[240px] flex-1 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-transform hover:-translate-y-0.5 sm:flex-none sm:basis-[210px]"
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
          <QrCode className="h-3 w-3 shrink-0 text-white/25" />
        </div>
      )}
      {e.status === "completed" && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-white/35">
          <span>próxima janela: próximo turno</span>
          <QrCode className="h-3 w-3 shrink-0 text-white/25" />
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
