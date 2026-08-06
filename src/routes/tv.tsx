import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { UtensilsCrossed, BrushCleaning, Footprints, OctagonX, CirclePause, UsersRound, Sparkles, Check, Clock } from "lucide-react";
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

type StaffActivity = "desmontando" | "em_alta" | "disponivel";

// NOTA: assume que a tabela `staff` tem uma coluna `status_updated_at` (timestamptz),
// igual ao padrão já usado em `discharges.status_updated_at`. Se o nome real da coluna
// for diferente, troca só a referência `s.status_updated_at` abaixo.
const BREAK_STATUSES: StaffStatus[] = ["coffee_break", "lunch_break", "dinner_break"];

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(15000);
  const clock = useClock();

  // Marca quando os dados mudaram pela última vez, pra mostrar "sincronizado há Xs"
  const lastSyncRef = useRef<number>(Date.now());
  useEffect(() => {
    lastSyncRef.current = Date.now();
  }, [discharges, staff]);

  // Detecta leitos cujo status mudou desde a última leitura, pra dar um flash
  // rápido de destaque. Usa uma "versão" por leito (não um timer) — cada mudança
  // incrementa a versão, o que remonta a linha e dispara uma animação CSS de um
  // disparo só. Isso não depende de nenhum timeout que possa ser cancelado por
  // outra atualização chegando no meio do caminho (era isso que prendia o flash).
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const flashVersionRef = useRef<Map<string, number>>(new Map());
  const [, forceFlashRerender] = useState(0);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const isFirstRun = prev.size === 0;
    let mudou = false;
    for (const d of discharges) {
      const before = prev.get(d.external_id ?? "");
      if (before !== undefined && before !== d.status) {
        flashVersionRef.current.set(d.external_id ?? "", (flashVersionRef.current.get(d.external_id ?? "") ?? 0) + 1);
        mudou = true;
      }
    }
    prevStatusRef.current = new Map(discharges.map((d) => [d.external_id ?? "", d.status]));
    if (mudou || isFirstRun) forceFlashRerender((n) => n + 1);
  }, [discharges]);

  // Finalizados recentes: apenas os concluídos nos últimos 30 minutos.
  // A janela é reavaliada a cada atualização de dados / tique do relógio,
  // então leitos antigos saem da faixa automaticamente.
  const recentCompletions = useMemo(() => {
    const cutoff = now - 30 * 60 * 1000;
    return discharges
      .filter(
        (d) =>
          !isExcluded(d) &&
          isBed(d) &&
          isTerminal(d) &&
          d.status === "completed" &&
          d.completed_at &&
          new Date(d.completed_at).getTime() >= cutoff,
      )
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
      .slice(0, 8)
      .map((d) => ({ bed: d.bed_number ?? "", completedAt: d.completed_at!, id: d.id }));
  }, [discharges, now]);

  const flashVersions = flashVersionRef.current;

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

  // "Time Altas": todo mundo logado no Listo (via healthcon), com o status derivado.
  // O que o Listo mostra (a caminho / desmontando / em higiene) tem PRIORIDADE sobre
  // o status do healthcon — a pessoa some da tela do healthcon assim que começa a
  // trabalhar de verdade, então isso não pode virar "deslogou".
  const timeAltasRows = useMemo(() => {
    const byId = new Map(staff.map((s) => [s.id, s]));
    const painelStaff = staff.filter((s) => (s.external_id || "").startsWith("painel:staff:"));

    // Comparação flexível: o Listo às vezes tem nome completo ("Hema Batista de
    // Oliveira") enquanto o healthcon mostra só "Hema Oliveira" — comparar só
    // primeiro + último nome (ignorando "de/da/dos" no meio) resolve isso.
    const normalizeName = (n: string) =>
      n
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w && !["de", "da", "do", "dos", "das", "e"].includes(w));

    const namesMatch = (a: string, b: string) => {
      const ta = normalizeName(a);
      const tb = normalizeName(b);
      if (!ta.length || !tb.length) return false;
      return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
    };

    const listaFor = (pred: (d: Discharge) => boolean) =>
      filtered
        .filter(pred)
        .map((d) => (d.assigned_staff_id ? byId.get(d.assigned_staff_id)?.name : null))
        .filter(Boolean) as string[];

    const nomesEmAlta = listaFor((d) => isTerminal(d) && d.status === "in_progress");
    const nomesACaminho = listaFor((d) => isTerminal(d) && d.status === "en_route");
    const nomesDesmontando = listaFor((d) => isDesmont(d) && d.status === "in_progress");

    return painelStaff
      .map((s) => {
        const nome = s.name || "";
        let kind: TimeAltasKind;
        if (nomesEmAlta.some((n) => namesMatch(n, nome))) kind = "em_alta";
        else if (nomesACaminho.some((n) => namesMatch(n, nome))) kind = "a_caminho";
        else if (nomesDesmontando.some((n) => namesMatch(n, nome))) kind = "desmontando";
        else {
          switch (s.status) {
            case "coffee_break": kind = "cafe"; break;
            case "lunch_break": kind = "almoco"; break;
            case "dinner_break": kind = "jantar"; break;
            case "off_duty": kind = "deslogou"; break;
            default: kind = "sem_alta";
          }
        }
        return { staff: s, kind };
      })
      .sort((a, b) => {
        const order = { em_alta: 0, a_caminho: 0, desmontando: 0, cafe: 1, almoco: 1, jantar: 1, sem_alta: 2, deslogou: 3 };
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        const aT = (a.staff as any).status_updated_at ?? "";
        const bT = (b.staff as any).status_updated_at ?? "";
        return new Date(bT).getTime() - new Date(aT).getTime();
      });
  }, [staff, filtered]);

  const activeCount = staffRows.filter((r) => r.kind !== "disponivel").length;
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  // --- Extras (desktop/TV) ---

  // 1) Tendência: guarda um retrato dos números a cada ~5min, pra comparar com
  // "há 1 hora" e mostrar seta de subida/descida nos KPIs.
  type Snapshot = { t: number; inFlight: number; enRoute: number; paused: number; completedIssues: number };
  const historyRef = useRef<Snapshot[]>([]);
  useEffect(() => {
    const t = Date.now();
    const last = historyRef.current[historyRef.current.length - 1];
    if (!last || t - last.t > 5 * 60 * 1000) {
      historyRef.current.push({ t, inFlight: inFlight.length, enRoute: enRoute.length, paused: paused.length, completedIssues: completedIssues.length });
      if (historyRef.current.length > 30) historyRef.current.shift();
    }
  }, [inFlight.length, enRoute.length, paused.length, completedIssues.length]);

  function trendFor(key: keyof Omit<Snapshot, "t">, currentValue: number): number | null {
    const hist = historyRef.current;
    if (hist.length === 0) return null;
    const target = Date.now() - 60 * 60 * 1000;
    let closest = hist[0];
    for (const s of hist) {
      if (Math.abs(s.t - target) < Math.abs(closest.t - target)) closest = s;
    }
    if (Math.abs(closest.t - target) > 20 * 60 * 1000) return null; // sem ponto de comparação confiável ainda
    return currentValue - closest[key];
  }

  // 2) Pior caso: o leito esperando há mais tempo, em qualquer categoria ativa —
  // recebe um destaque visual extra pra chamar atenção pro caso mais crítico.
  const worstCase = useMemo(() => {
    const all = [...inFlight, ...enRoute, ...paused, ...completedIssues];
    if (!all.length) return null;
    return all.reduce((oldest, d) =>
      new Date(d.status_updated_at).getTime() < new Date(oldest.status_updated_at).getTime() ? d : oldest,
    );
  }, [inFlight, enRoute, paused, completedIssues]);

  // 4) Resumo do dia: quantas altas foram concluídas hoje (desde 00:00 BRT),
  // separadas por agrupamento de blocos (D/E e B/C).
  const concluidasHojePorBloco = useMemo(() => {
    const agora = new Date();
    const inicioDiaBRT = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    inicioDiaBRT.setUTCHours(0, 0, 0, 0);
    const cutoff = inicioDiaBRT.getTime() + 3 * 60 * 60 * 1000;
    const done = discharges.filter(
      (d) => isTerminal(d) && d.status === "completed" && new Date(d.status_updated_at).getTime() >= cutoff,
    );
    let de = 0;
    let bc = 0;
    for (const d of done) {
      const m = (d.unit || "").toUpperCase().match(/BLOCO\s+([A-Z])/);
      const block = m?.[1];
      if (block === "D" || block === "E") de++;
      else if (block === "B" || block === "C") bc++;
    }
    return { total: done.length, de, bc };
  }, [discharges]);
  const concluidasHoje = concluidasHojePorBloco.total;


  // 5) Horário noturno (22h-6h, Brasília) — escurece um pouco a tela pra cansar
  // menos a vista/o painel de madrugada.
  const horaBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const isNoturno = horaBRT >= 22 || horaBRT < 6;

  return (
    <div
      className="min-h-screen lg:h-screen w-screen overflow-y-auto lg:overflow-hidden flex flex-col bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)] font-sans relative transition-[filter] duration-1000"
      style={isNoturno ? { filter: "brightness(0.82)" } : undefined}
    >
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent 0%, oklch(0.6 0.15 245 / 0.7) 25%, oklch(0.65 0.18 155 / 0.6) 50%, oklch(0.65 0.19 60 / 0.6) 75%, transparent 100%)",
          boxShadow: "0 0 16px 1px oklch(0.6 0.15 245 / 0.35)",
        }}
      />
      <header className="flex-none flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between px-4 lg:px-6 py-2.5 lg:py-2 border-b border-white/15">
        <h1 className="text-base sm:text-lg lg:text-2xl font-bold tracking-tight leading-tight">
          Painel de Higienização Terminal
        </h1>
        <div className="flex items-center justify-between lg:justify-end gap-3 lg:gap-4">
          <span className="flex items-center gap-1.5 text-[9px] lg:text-[10px] uppercase tracking-widest text-white/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            ao vivo
          </span>
          <span className="hidden sm:inline text-[10px] text-white/35 font-mono">
            sincronizado há {Math.max(0, Math.round((now - lastSyncRef.current) / 1000))}s
          </span>
          <span className="text-xl lg:text-3xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      {recentCompletions.length > 0 && (
        <div className="flex-none w-full overflow-hidden border-y border-[oklch(0.55_0.18_150_/_0.55)] bg-gradient-to-r from-[oklch(0.16_0.04_150)] via-[oklch(0.20_0.07_150)] to-[oklch(0.16_0.04_150)] py-2 shadow-[0_0_24px_0_oklch(0.55_0.18_150_/_0.25)]">
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,transparent_0%,oklch(0.65_0.20_150_/_0.12)_50%,transparent_100%)]" />
          <div className="animate-marquee flex items-center gap-4 lg:gap-6 whitespace-nowrap px-6">
            {recentCompletions.map((c, i) => (
              <div
                key={c.id}
                className={[
                  "activity-chip flex items-center gap-2.5 lg:gap-3 rounded-full border pl-1.5 pr-3 lg:pl-2 lg:pr-4 py-1 lg:py-1.5 shadow-lg",
                  i === 0
                    ? "border-[oklch(0.65_0.20_150_/_0.75)] bg-[oklch(0.18_0.06_150_/_0.85)] shadow-[oklch(0.55_0.18_150_/_0.35)]"
                    : "border-[oklch(0.55_0.16_150_/_0.45)] bg-[oklch(0.18_0.05_150_/_0.65)]",
                ].join(" ")}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="inline-flex h-5 w-5 lg:h-6 lg:w-6 shrink-0 items-center justify-center rounded-full bg-[oklch(0.55_0.18_150)] text-[oklch(0.15_0.02_150)] shadow-[0_0_10px_oklch(0.55_0.18_150_/_0.55)]">
                  <Check className="h-3 w-3 lg:h-3.5 lg:w-3.5 stroke-[3]" />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-[oklch(0.55_0.16_150_/_0.25)] px-1.5 py-0.5 text-[9px] lg:text-[10px] font-bold uppercase tracking-wider text-[oklch(0.75_0.12_150)]">
                    {i === 0 ? "RECENTE" : "CONCLUÍDO"}
                  </span>
                  <span className="text-sm lg:text-base font-bold text-white tracking-tight">{c.bed}</span>
                </span>
                <span className="hidden sm:flex items-center gap-1 text-[10px] lg:text-[11px] text-[oklch(0.72_0.08_150)]">
                  <Clock className="h-3 w-3" />
                  <span className="font-medium">{formatTime(c.completedAt)}</span>
                </span>
                <span className="text-[10px] lg:text-[11px] text-[oklch(0.60_0.06_150)]">há {formatElapsed(c.completedAt, now)}</span>
                {i === 0 && <Sparkles className="h-3.5 w-3.5 text-[oklch(0.70_0.14_150)] animate-pulse" />}
              </div>
            ))}
            {/* Repete para rolagem contínua sem quebra visual */}
            {recentCompletions.map((c, i) => (
              <div
                key={`dup-${c.id}`}
                className={[
                  "flex items-center gap-2.5 lg:gap-3 rounded-full border pl-1.5 pr-3 lg:pl-2 lg:pr-4 py-1 lg:py-1.5 shadow-lg",
                  i === 0
                    ? "border-[oklch(0.65_0.20_150_/_0.75)] bg-[oklch(0.18_0.06_150_/_0.85)] shadow-[oklch(0.55_0.18_150_/_0.35)]"
                    : "border-[oklch(0.55_0.16_150_/_0.45)] bg-[oklch(0.18_0.05_150_/_0.65)]",
                ].join(" ")}
              >
                <span className="inline-flex h-5 w-5 lg:h-6 lg:w-6 shrink-0 items-center justify-center rounded-full bg-[oklch(0.55_0.18_150)] text-[oklch(0.15_0.02_150)] shadow-[0_0_10px_oklch(0.55_0.18_150_/_0.55)]">
                  <Check className="h-3 w-3 lg:h-3.5 lg:w-3.5 stroke-[3]" />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-[oklch(0.55_0.16_150_/_0.25)] px-1.5 py-0.5 text-[9px] lg:text-[10px] font-bold uppercase tracking-wider text-[oklch(0.75_0.12_150)]">
                    {i === 0 ? "RECENTE" : "CONCLUÍDO"}
                  </span>
                  <span className="text-sm lg:text-base font-bold text-white tracking-tight">{c.bed}</span>
                </span>
                <span className="hidden sm:flex items-center gap-1 text-[10px] lg:text-[11px] text-[oklch(0.72_0.08_150)]">
                  <Clock className="h-3 w-3" />
                  <span className="font-medium">{formatTime(c.completedAt)}</span>
                </span>
                <span className="text-[10px] lg:text-[11px] text-[oklch(0.60_0.06_150)]">há {formatElapsed(c.completedAt, now)}</span>
                {i === 0 && <Sparkles className="h-3.5 w-3.5 text-[oklch(0.70_0.14_150)] animate-pulse" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-none grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 px-4 lg:px-6 py-2.5 lg:py-3">
        <KpiCard label="Em Limpeza" value={inFlight.length} accent="oklch(0.75 0.22 155)" trend={trendFor("inFlight", inFlight.length)} />
        <KpiCard label="A Caminho" value={enRoute.length} accent="oklch(0.74 0.18 230)" trend={trendFor("enRoute", enRoute.length)} />
        <KpiCard label="Altas Paradas" value={paused.length} accent="oklch(0.78 0.2 60)" trend={trendFor("paused", paused.length)} higherIsBad />
        <KpiCard label="Leitos Pausados" value={completedIssues.length} accent="oklch(0.72 0.23 25)" trend={trendFor("completedIssues", completedIssues.length)} higherIsBad />
        <KpiCard label="Colaboradores Ativos" value={activeCount} accent="oklch(0.72 0.2 245)" />
      </div>

      <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[1fr_0.8fr_1fr_1fr] gap-3 px-4 lg:px-6 pb-4">
        <BedsPanel
          title="Leitos em Limpeza Terminal"
          icon={<BrushCleaning className="w-4 h-4 text-white/60" />}
          rows={inFlight}
          nowMs={now}
          staffMap={staffMap}
          tone="green"
          empty="Nenhum leito em higienização terminal."
          flashVersions={flashVersions}
          worstId={worstCase?.id}
          caption="meta: até 90min"
          className="order-2 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-1"
        />
        <BedsPanel
          title="A Caminho"
          icon={<Footprints className="w-4 h-4 text-white/60" />}
          rows={enRoute}
          nowMs={now}
          staffMap={staffMap}
          tone="blue"
          empty="Nenhum leito a caminho."
          flashVersions={flashVersions}
          worstId={worstCase?.id}
          caption="meta: até 15min"
          className="order-3 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-2"
        />
        <BedsPanel
          title="Altas Paradas"
          icon={<OctagonX className="w-4 h-4 text-white/60" />}
          rows={paused}
          nowMs={now}
          staffMap={staffMap}
          tone="amber"
          empty="Nenhuma alta parada."
          flashVersions={flashVersions}
          worstId={worstCase?.id}
          caption="meta: intervir em até 30min"
          className="order-4 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-3"
        />
        <BedsPanel
          title="Leitos Pausados"
          icon={<CirclePause className="w-4 h-4 text-white/60" />}
          rows={completedIssues}
          nowMs={now}
          staffMap={staffMap}
          tone="red"
          showReason
          empty="Nenhum leito pausado hoje."
          flashVersions={flashVersions}
          worstId={worstCase?.id}
          className="order-6 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-4"
        />
        <StaffPanel
          rows={staffRows}
          nowMs={now}
          className={`order-1 lg:order-none lg:col-start-9 lg:col-span-4 ${
            staffRows.length === 0 && timeAltasRows.length > 0
              ? "lg:row-start-1 lg:row-span-1"
              : timeAltasRows.length === 0 && staffRows.length > 0
                ? "lg:row-start-1 lg:row-span-4"
                : "lg:row-start-1 lg:row-span-3"
          }`}
        />
        <BreaksPanel
          rows={timeAltasRows}
          nowMs={now}
          className={`order-5 lg:order-none lg:col-start-9 lg:col-span-4 ${
            staffRows.length === 0 && timeAltasRows.length > 0
              ? "lg:row-start-2 lg:row-span-3"
              : timeAltasRows.length === 0 && staffRows.length > 0
                ? "lg:row-start-4 lg:row-span-1"
                : "lg:row-start-4 lg:row-span-1"
          }`}
        />
      </div>

      <div className="hidden lg:flex flex-none items-center justify-center gap-2 px-6 py-1.5 border-t border-white/10 text-[11px] text-white/40">
        Hoje: <span className="text-white/70 font-semibold">{concluidasHoje}</span> altas concluídas
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

function KpiCard({
  label,
  value,
  accent,
  trend,
  higherIsBad,
}: {
  label: string;
  value: number;
  accent: string;
  trend?: number | null;
  higherIsBad?: boolean;
}) {
  const trendColor =
    trend == null || trend === 0
      ? "rgba(255,255,255,0.35)"
      : (trend > 0) === !!higherIsBad
        ? "oklch(0.7 0.19 25)" // piorou
        : "oklch(0.72 0.17 155)"; // melhorou
  return (
    <div
      className="rounded-xl px-3 lg:px-4 py-2 lg:py-2 border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-0.5 lg:gap-0"
      style={{
        background: `linear-gradient(180deg, ${accent.replace(")", " / 0.26)")} 0%, oklch(0.18 0.03 265) 100%)`,
        borderColor: accent.replace(")", " / 0.45)"),
        boxShadow: `inset 0 0 0 1px ${accent.replace(")", " / 0.55)")}, 0 0 24px -8px ${accent.replace(")", " / 0.5)")}`,
      }}
    >
      <div className="text-[9px] lg:text-[11px] uppercase tracking-widest text-white/70 font-medium leading-tight">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <div
          className="text-2xl lg:text-4xl tabular-nums leading-none"
          style={{ color: accent, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
        >
          {value}
        </div>
        {trend != null && trend !== 0 && (
          <span className="hidden lg:inline text-xs font-mono" style={{ color: trendColor }} title="Comparado a 1h atrás">
            {trend > 0 ? "▲" : "▼"}
            {Math.abs(trend)}
          </span>
        )}
      </div>
    </div>
  );
}

type Tone = "green" | "amber" | "red" | "blue";
const toneBg: Record<Tone, string> = {
  green: "oklch(0.32 0.13 155 / 0.2)",
  amber: "oklch(0.48 0.19 85 / 0.3)",
  red: "oklch(0.4 0.2 20 / 0.28)",
  blue: "oklch(0.37 0.15 230 / 0.24)",
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
  flashVersions,
  className,
  worstId,
  caption,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
  tone: Tone;
  showReason?: boolean;
  empty: string;
  flashVersions?: Map<string, number>;
  className?: string;
  worstId?: string;
  caption?: string;
}) {
  return (
    <section className={`h-[300px] lg:h-full rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col lg:min-h-0 ${className ?? ""}`}>
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        {caption && <div className="hidden lg:block text-[10px] text-white/30 mt-0.5">{caption}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">{empty}</div>
        ) : (
          <AutoScroll>
            <table className="w-full text-sm table-fixed">
              <thead className="text-[10px] uppercase tracking-widest text-white/50 sticky top-0 bg-[oklch(0.16_0.02_265)]">
                <tr>
                  <th className="text-left px-1.5 lg:px-4 py-1.5 w-[30%] lg:w-auto">Leito</th>
                  <th className="hidden lg:table-cell text-left px-3 py-1.5">Unidade</th>
                  {showReason ? (
                    <th className="text-left px-2.5 lg:px-3 py-1.5 w-[36%] lg:w-auto">Motivo</th>
                  ) : (
                    <th className="text-left px-2.5 lg:px-3 py-1.5 w-[26%] lg:w-auto">Tempo</th>
                  )}
                  <th className="text-left px-2.5 lg:px-4 py-1.5">Colaborador</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const overtime = elapsedMinutes(d.status_updated_at, nowMs) >= 60;
                  const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
                  const version = flashVersions?.get(d.external_id ?? "") ?? 0;
                  const isWorst = worstId && d.id === worstId;
                  return (
                    <tr
                      key={`${d.id}-v${version}`}
                      className={version > 0 ? "flash-row" : undefined}
                      style={{
                        background: overtime && tone === "green" ? "oklch(0.4 0.13 55 / 0.3)" : toneBg[tone],
                        boxShadow: isWorst ? "inset 0 0 0 2px oklch(0.7 0.22 25 / 0.8)" : undefined,
                      }}
                    >
                      <td className="px-1.5 lg:px-4 py-1.5 font-bold text-[13px] lg:text-base border-t border-white/5 truncate">
                        {isWorst && <span className="hidden lg:inline mr-1" title="Caso mais crítico do painel">⚠️</span>}
                        {d.bed_number}
                      </td>
                      <td className="hidden lg:table-cell px-3 py-1.5 text-white/80 text-xs border-t border-white/5">{d.unit}</td>
                      {showReason ? (
                        <td className="px-2.5 lg:px-3 py-1.5 text-white/90 text-[11px] lg:text-xs border-t border-white/5">{d.pause_reason || <span className="text-white/40">—</span>}</td>
                      ) : (
                        <td className="px-2.5 lg:px-3 py-1.5 font-mono tabular-nums text-xs lg:text-sm border-t border-white/5">{formatElapsed(d.status_updated_at, nowMs)}</td>
                      )}
                      <td className="px-2.5 lg:px-4 py-1.5 text-[11px] lg:text-xs border-t border-white/5 truncate">{name || "—"}</td>
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
  className,
}: {
  rows: Array<{ staff: Staff; kind: StaffActivity; start: string | null; bed: string | null }>;
  nowMs: number;
  className?: string;
}) {
  return (
    <section className={`h-[340px] lg:h-full rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col ${className ?? ""}`}>
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <UsersRound className="w-4 h-4 text-white/60" />
            Colaboradores
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        <div className="text-[10px] text-white/35 mt-0.5">Desmontagem e higienização terminal (Listo)</div>
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
                        ? "oklch(0.37 0.18 300 / 0.32)"
                        : kind === "em_alta"
                          ? "oklch(0.34 0.17 245 / 0.32)"
                          : "oklch(0.25 0.02 265 / 0.4)",
                    borderColor:
                      kind === "desmontando"
                        ? "oklch(0.68 0.2 300 / 0.5)"
                        : kind === "em_alta"
                          ? "oklch(0.63 0.19 245 / 0.5)"
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
type TimeAltasKind = "cafe" | "almoco" | "jantar" | "deslogou" | "em_alta" | "a_caminho" | "desmontando" | "sem_alta";

const TIME_ALTAS_LABELS: Record<TimeAltasKind, string> = {
  cafe: "CAFÉ",
  almoco: "ALMOÇO",
  jantar: "JANTAR",
  deslogou: "DESLOGOU",
  em_alta: "EM ALTA",
  a_caminho: "A CAMINHO",
  desmontando: "DESMONTANDO",
  sem_alta: "SEM ALTA",
};

const TIME_ALTAS_STYLE: Record<TimeAltasKind, { bg: string; border: string; text: string }> = {
  cafe: { bg: "oklch(0.42 0.18 55 / 0.35)", border: "oklch(0.72 0.21 55 / 0.55)", text: "oklch(0.82 0.21 55)" },
  almoco: { bg: "oklch(0.42 0.18 55 / 0.35)", border: "oklch(0.72 0.21 55 / 0.55)", text: "oklch(0.82 0.21 55)" },
  jantar: { bg: "oklch(0.42 0.18 55 / 0.35)", border: "oklch(0.72 0.21 55 / 0.55)", text: "oklch(0.82 0.21 55)" },
  em_alta: { bg: "oklch(0.37 0.15 230 / 0.32)", border: "oklch(0.63 0.19 230 / 0.55)", text: "oklch(0.78 0.19 230)" },
  a_caminho: { bg: "oklch(0.37 0.14 230 / 0.22)", border: "oklch(0.63 0.17 230 / 0.4)", text: "oklch(0.78 0.17 230)" },
  desmontando: { bg: "oklch(0.37 0.16 300 / 0.32)", border: "oklch(0.66 0.2 300 / 0.55)", text: "oklch(0.8 0.2 300)" },
  sem_alta: { bg: "oklch(0.37 0.17 25 / 0.32)", border: "oklch(0.63 0.21 25 / 0.55)", text: "oklch(0.78 0.21 25)" },
  deslogou: { bg: "oklch(0.22 0.005 0 / 0.4)", border: "oklch(0.32 0.005 0 / 0.5)", text: "rgba(255,255,255,0.35)" },
};

function BreaksPanel({
  rows,
  nowMs,
  className,
}: {
  rows: { staff: Staff; kind: TimeAltasKind }[];
  nowMs: number;
  className?: string;
}) {
  return (
    <section className={`h-[280px] lg:h-full rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col ${className ?? ""}`}>
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-white/60" />
            Time Altas
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        <div className="text-[10px] text-white/35 mt-0.5">Login e pausas do time de campo (healthcon)</div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Ninguém do time logado agora.</div>
        ) : (
          <AutoScroll>
            <ul className="p-2 space-y-1.5">
              {rows.map(({ staff: s, kind }) => {
                const startIso = (s as any).status_updated_at as string | undefined;
                const minutes = startIso ? elapsedMinutes(startIso, nowMs) : 0;
                const over =
                  startIso && (kind === "cafe" || kind === "almoco" || kind === "jantar")
                    ? isBreakOverLimit(s.status as StaffStatus, minutes)
                    : false;
                const style = TIME_ALTAS_STYLE[kind];
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md px-3 py-2 border"
                    style={{
                      background: over ? "oklch(0.45 0.2 25 / 0.4)" : style.bg,
                      borderColor: over ? "oklch(0.65 0.22 25 / 0.6)" : style.border,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate text-sm">{s.name}</div>
                      <div className="text-[11px] text-white/60 truncate uppercase tracking-widest">
                        {TIME_ALTAS_LABELS[kind]}
                      </div>
                    </div>
                    {startIso && (
                      <span
                        className="font-mono tabular-nums text-xs ml-2"
                        style={{ color: over ? "oklch(0.8 0.22 25)" : style.text }}
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
