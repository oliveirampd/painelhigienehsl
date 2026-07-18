import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { UtensilsCrossed, BrushCleaning, Footprints, OctagonX, CirclePause, UsersRound } from "lucide-react";
import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import {
  elapsedMinutes,
  formatElapsed,
  isBreakOverLimit,
  STAFF_STATUS_LABELS,
  type Discharge,
  type Staff,
  type StaffStatus,
} from "@/lib/hospital";

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "TV — Painel de Higienização Terminal" },
      { name: "description", content: "Painel em tempo real: leitos em limpeza terminal, altas paradas, pausadas e colaboradores." },
    ],
  }),
  component: TvPage,
});

// Unidades excluídas, no formato { andar, bloco } — ex: 5º Andar, Bloco B.
// Cobre textos como "Bloco B 05º Andar" ou "Bloco B 5º Andar · Ala X".
const EXCLUDED_BLOCKS: Array<{ floor: number; block: string }> = [
  { floor: 3, block: "D" },
  { floor: 3, block: "C" },
  { floor: 12, block: "C" },
  { floor: 5, block: "B" },
];

function isExcluded(d: Discharge): boolean {
  const u = (d.unit || "").toUpperCase();
  const m = u.match(/BLOCO\s+([A-Z])[^\d]*0*(\d+)/);
  if (!m) return false;
  const block = m[1];
  const floor = parseInt(m[2], 10);
  return EXCLUDED_BLOCKS.some((ex) => ex.block === block && ex.floor === floor);
}

const isTerminal = (d: Discharge) => (d.external_id || "").startsWith("listo:answer:");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const isDesmont = (d: Discharge) => (d.external_id || "").startsWith("listo:desmont:");
const isBed = (d: Discharge) => (d.bed_number || "").toLowerCase().startsWith("leito");

type StaffActivity = "desmontando" | "em_alta" | "disponivel";

// NOTA: assume que a tabela `staff` tem uma coluna `status_updated_at` (timestamptz),
// igual ao padrão já usado em `discharges.status_updated_at`. Se o nome real da coluna
// for diferente, troca só a referência `s.status_updated_at` abaixo.
const BREAK_STATUSES: StaffStatus[] = ["coffee_break", "lunch_break", "dinner_break"];

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(15000);
  const clock = useClock();

  const filtered = useMemo(
    () => discharges.filter((d) => !isExcluded(d) && isBed(d)),
    [discharges],
  );

  // Em Limpeza: terminal + in_progress
  const inFlight = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "in_progress")
        .sort((a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime()),
    [filtered],
  );

  // A Caminho: terminal + en_route (colaborador alocado, ainda não iniciou)
  const enRoute = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "en_route")
        .sort((a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime()),
    [filtered],
  );

  // Altas Paradas: sem colaborador alocado ainda
  const paused = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "waiting_cleaning")
        .sort((a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime()),
    [filtered],
  );

  // Leitos Pausados: "Pendente" no Listo (motivo/comentário), só as de hoje
  const completedIssues = useMemo(() => {
    const cutoff = now - ONE_DAY_MS;
    return filtered
      .filter(
        (d) =>
          isTerminal(d) &&
          (d.status === "paused" || d.status === "completed_with_issues") &&
          new Date(d.status_updated_at).getTime() >= cutoff,
      )
      .sort((a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime());
  }, [filtered, now]);

  // Desmontagens em andamento
  const activeDesmont = useMemo(
    () => filtered.filter((d) => isDesmont(d) && d.status === "in_progress"),
    [filtered],
  );

  // Colaboradores: derivar atividade por staff
  const staffRows = useMemo(() => {
    const activity = new Map<string, { kind: StaffActivity; start: string; bed: string }>();

    for (const d of activeDesmont) {
      if (!d.assigned_staff_id) continue;
      const prev = activity.get(d.assigned_staff_id);
      if (!prev || new Date(d.status_updated_at) > new Date(prev.start)) {
        activity.set(d.assigned_staff_id, {
          kind: "desmontando",
          start: d.status_updated_at,
          bed: d.bed_number,
        });
      }
    }
    for (const d of inFlight) {
      if (!d.assigned_staff_id) continue;
      // desmontando tem prioridade se ambos existirem (raro), mas mais recente vence
      const prev = activity.get(d.assigned_staff_id);
      if (!prev || new Date(d.status_updated_at) > new Date(prev.start)) {
        activity.set(d.assigned_staff_id, {
          kind: "em_alta",
          start: d.status_updated_at,
          bed: d.bed_number,
        });
      }
    }

    const listoStaff = staff.filter((s) => (s.external_id || "").startsWith("listo:user:"));
    return listoStaff
      .filter((s) => activity.has(s.id)) // só quem está ativo agora (desmontando ou em alta)
      .map((s) => {
        const a = activity.get(s.id)!;
        return {
          staff: s,
          kind: a.kind,
          start: a.start,
          bed: a.bed,
        };
      })
      .sort((a, b) => {
        const order = { desmontando: 0, em_alta: 1, disponivel: 2 };
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        if (a.start && b.start) return new Date(b.start).getTime() - new Date(a.start).getTime();
        return a.staff.name.localeCompare(b.staff.name);
      });
  }, [inFlight, activeDesmont, staff]);

  // Colaboradores em pausa (Café / Almoço / Janta), vindos direto de staff.status
  const breakRows = useMemo(
    () =>
      staff
        .filter((s) => BREAK_STATUSES.includes(s.status as StaffStatus))
        .sort(
          (a, b) =>
            new Date((b as any).status_updated_at).getTime() -
            new Date((a as any).status_updated_at).getTime(),
        ),
    [staff],
  );

  const activeCount = staffRows.filter((r) => r.kind !== "disponivel").length;
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)] font-sans">
      <header className="flex-none flex items-center justify-between px-6 py-2 border-b border-white/10">
        <h1 className="text-xl xl:text-2xl font-bold tracking-tight">
          Painel de Higienização Terminal
        </h1>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            ao vivo
          </span>
          <span className="text-2xl xl:text-3xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="flex-none grid grid-cols-5 gap-3 px-6 py-3">
        <KpiCard label="Em Limpeza" value={inFlight.length} accent="oklch(0.72 0.19 155)" />
        <KpiCard label="A Caminho" value={enRoute.length} accent="oklch(0.72 0.15 230)" />
        <KpiCard label="Altas Paradas" value={paused.length} accent="oklch(0.75 0.17 60)" />
        <KpiCard label="Leitos Pausados" value={completedIssues.length} accent="oklch(0.7 0.2 25)" />
        <KpiCard label="Colaboradores Ativos" value={activeCount} accent="oklch(0.7 0.17 245)" />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 px-6 pb-4">
        <div className="col-span-8 grid grid-rows-[1fr_0.8fr_1fr_1fr] gap-3 min-h-0">
          <BedsPanel title="Leitos em Limpeza Terminal" icon={<BrushCleaning className="w-4 h-4 text-white/60" />} rows={inFlight} nowMs={now} staffMap={staffMap} tone="green" empty="Nenhum leito em higienização terminal." />
          <BedsPanel title="A Caminho" icon={<Footprints className="w-4 h-4 text-white/60" />} rows={enRoute} nowMs={now} staffMap={staffMap} tone="blue" empty="Nenhum leito a caminho." />
          <BedsPanel title="Altas Paradas" icon={<OctagonX className="w-4 h-4 text-white/60" />} rows={paused} nowMs={now} staffMap={staffMap} tone="amber" empty="Nenhuma alta parada." />
          <BedsPanel title="Leitos Pausados" icon={<CirclePause className="w-4 h-4 text-white/60" />} rows={completedIssues} nowMs={now} staffMap={staffMap} tone="red" showReason empty="Nenhum leito pausado hoje." />
        </div>
        <div className="col-span-4 min-h-0 grid grid-rows-[1.3fr_1fr] gap-3">
          <StaffPanel rows={staffRows} nowMs={now} />
          <BreaksPanel rows={breakRows} nowMs={now} />
        </div>
      </div>
    </div>
  );
}

function useClock() {
  const [t, setT] = useState<string>("");
  useEffect(() => {
    setT(new Date().toLocaleTimeString("pt-BR"));
    const id = setInterval(() => setT(new Date().toLocaleTimeString("pt-BR")), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div
      className="rounded-xl px-4 py-2 border border-white/10 flex items-center justify-between"
      style={{
        background: `linear-gradient(180deg, ${accent.replace(")", " / 0.14)")} 0%, oklch(0.19 0.03 265) 100%)`,
        boxShadow: `inset 0 0 0 1px ${accent.replace(")", " / 0.35)")}`,
      }}
    >
      <div className="text-[11px] uppercase tracking-widest text-white/60">{label}</div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  );
}

type Tone = "green" | "amber" | "red" | "blue";
const toneBg: Record<Tone, string> = {
  green: "oklch(0.3 0.1 155 / 0.12)",
  amber: "oklch(0.45 0.15 60 / 0.18)",
  red: "oklch(0.4 0.15 25 / 0.18)",
  blue: "oklch(0.35 0.12 230 / 0.16)",
};

function BedsPanel({
  title,
  icon,
  rows,
  nowMs,
  staffMap,
  tone,
  showReason,
  empty,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
  tone: Tone;
  showReason?: boolean;
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden flex flex-col min-h-0">
      <div className="flex-none px-4 py-2 border-b border-white/10 flex items-baseline justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          {icon}
          {title}
        </h2>
        <span className="text-[11px] text-white/50">{rows.length}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">{empty}</div>
        ) : (
          <AutoScroll>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-white/50 sticky top-0 bg-[oklch(0.16_0.02_265)]">
                <tr>
                  <th className="text-left px-4 py-1.5">Leito</th>
                  <th className="text-left px-3 py-1.5">Unidade</th>
                  {showReason ? (
                    <th className="text-left px-3 py-1.5">Motivo</th>
                  ) : (
                    <th className="text-left px-3 py-1.5">Tempo</th>
                  )}
                  <th className="text-left px-4 py-1.5">Colaborador</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const overtime = elapsedMinutes(d.status_updated_at, nowMs) >= 60;
                  const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
                  return (
                    <tr key={d.id} className="border-t border-white/5" style={{ background: overtime && tone === "green" ? "oklch(0.4 0.13 55 / 0.3)" : toneBg[tone] }}>
                      <td className="px-4 py-1.5 font-bold text-base">{d.bed_number}</td>
                      <td className="px-3 py-1.5 text-white/80 text-xs">{d.unit}</td>
                      {showReason ? (
                        <td className="px-3 py-1.5 text-white/90 text-xs">{d.pause_reason || <span className="text-white/40">—</span>}</td>
                      ) : (
                        <td className="px-3 py-1.5 font-mono tabular-nums text-sm">{formatElapsed(d.status_updated_at, nowMs)}</td>
                      )}
                      <td className="px-4 py-1.5 text-xs">{name || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AutoScroll>
        )}
      </div>
    </section>
  );
}

function StaffPanel({
  rows,
  nowMs,
}: {
  rows: Array<{ staff: Staff; kind: StaffActivity; start: string | null; bed: string | null }>;
  nowMs: number;
}) {
  return (
    <section className="h-full rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden flex flex-col">
      <div className="flex-none px-4 py-2 border-b border-white/10 flex items-baseline justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <UsersRound className="w-4 h-4 text-white/60" />
          Colaboradores
        </h2>
        <span className="text-[11px] text-white/50">{rows.length}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Nenhum colaborador.</div>
        ) : (
          <AutoScroll>
            <ul className="p-2 space-y-1.5">
              {rows.map(({ staff, kind, start, bed }) => (
                <li
                  key={staff.id}
                  className="flex items-center justify-between rounded-md px-3 py-2 border"
                  style={{
                    background:
                      kind === "desmontando"
                        ? "oklch(0.35 0.14 300 / 0.22)"
                        : kind === "em_alta"
                          ? "oklch(0.32 0.13 245 / 0.22)"
                          : "oklch(0.25 0.02 265 / 0.4)",
                    borderColor:
                      kind === "desmontando"
                        ? "oklch(0.65 0.18 300 / 0.35)"
                        : kind === "em_alta"
                          ? "oklch(0.6 0.15 245 / 0.35)"
                          : "oklch(0.4 0.02 265 / 0.4)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate text-sm">{staff.name}</div>
                    <div className="text-[11px] text-white/60 truncate">
                      <StatusPill kind={kind} />
                      {bed ? <span className="ml-1">· {bed}</span> : null}
                    </div>
                  </div>
                  {start && (
                    <span className="font-mono tabular-nums text-xs text-white/70 ml-2">
                      {formatElapsed(start, nowMs)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </AutoScroll>
        )}
      </div>
    </section>
  );
}

// Café / Almoço / Janta — direto de staff.status, com alerta quando passa do limite (hospital.ts)
function BreaksPanel({ rows, nowMs }: { rows: Staff[]; nowMs: number }) {
  return (
    <section className="h-full rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden flex flex-col">
      <div className="flex-none px-4 py-2 border-b border-white/10 flex items-baseline justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <UtensilsCrossed className="w-4 h-4 text-white/60" />
          Café / Almoço / Janta
        </h2>
        <span className="text-[11px] text-white/50">{rows.length}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Ninguém em pausa agora.</div>
        ) : (
          <AutoScroll>
            <ul className="p-2 space-y-1.5">
              {rows.map((s) => {
                // NOTA: assume coluna `status_updated_at` na tabela staff — confirmar nome real.
                const startIso = (s as any).status_updated_at as string | undefined;
                const minutes = startIso ? elapsedMinutes(startIso, nowMs) : 0;
                const over = startIso ? isBreakOverLimit(s.status as StaffStatus, minutes) : false;
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md px-3 py-2 border"
                    style={{
                      background: over ? "oklch(0.4 0.13 55 / 0.3)" : "oklch(0.3 0.1 245 / 0.16)",
                      borderColor: over ? "oklch(0.7 0.17 55 / 0.5)" : "oklch(0.5 0.12 245 / 0.35)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate text-sm">{s.name}</div>
                      <div className="text-[11px] text-white/60 truncate uppercase tracking-widest">
                        {STAFF_STATUS_LABELS[s.status as StaffStatus] ?? s.status}
                      </div>
                    </div>
                    {startIso && (
                      <span
                        className="font-mono tabular-nums text-xs ml-2"
                        style={{ color: over ? "oklch(0.8 0.17 55)" : "rgba(255,255,255,0.7)" }}
                      >
                        {formatElapsed(startIso, nowMs)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </AutoScroll>
        )}
      </div>
    </section>
  );
}

function StatusPill({ kind }: { kind: StaffActivity }) {
  const label = kind === "desmontando" ? "Desmontando" : kind === "em_alta" ? "Em Alta" : "Disponível";
  const color =
    kind === "desmontando"
      ? "oklch(0.8 0.15 300)"
      : kind === "em_alta"
        ? "oklch(0.75 0.15 245)"
        : "oklch(0.7 0.02 265)";
  return (
    <span className="uppercase tracking-widest text-[10px] font-semibold" style={{ color }}>
      {label}
    </span>
  );
}

// Auto-scroll vertical: se o conteúdo não couber, rola devagar em loop.
function AutoScroll({ children }: { children: React.ReactNode }) {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref) return;
    let raf = 0;
    let dir = 1;
    let paused = 0;
    let pos = 0;
    let needs = ref.scrollHeight > ref.clientHeight + 4;

    const recheck = () => {
      needs = ref.scrollHeight > ref.clientHeight + 4;
      if (!needs) {
        pos = 0;
        ref.scrollTop = 0;
      }
    };

    const ro = new ResizeObserver(recheck);
    ro.observe(ref);
    const mo = new MutationObserver(recheck);
    mo.observe(ref, { childList: true, subtree: true, characterData: true });

    const step = () => {
      if (needs) {
        if (paused > 0) {
          paused -= 1;
        } else {
          pos += dir * 0.35;
          const max = ref.scrollHeight - ref.clientHeight;
          if (pos >= max) {
            pos = max;
            dir = -1;
            paused = 120;
          } else if (pos <= 0) {
            pos = 0;
            dir = 1;
            paused = 120;
          }
          ref.scrollTop = Math.floor(pos);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);

  return (
    <div ref={setRef} className="h-full overflow-hidden">
      {children}
    </div>
  );
}
