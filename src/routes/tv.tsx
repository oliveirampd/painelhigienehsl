import {
  isExcludedUnit,
  isTerminalUtiBoxUnit,
  operationalBedKey,
} from "@/lib/operationalScope";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
   BrushCleaning,
  CirclePause,
  UsersRound,
  CircleCheck,
  BadgeCheck,
   AlertTriangle,
  Activity,
  Eye,
} from "lucide-react";

import { toast } from "sonner";
import { resolvePausedDischarge, updateDischargeServiceOrder } from "@/lib/hospital.functions";
import { PanelNav } from "@/components/PanelNav";
import { SyncCounter } from "@/components/SyncCounter";
import { ThemePicker } from "@/components/ThemePicker";
import { DischargeTimelineModal } from "@/components/DischargeTimelineModal";
import { AutoScroll } from "@/components/AutoScroll";

import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import { useTerminalTheme } from "@/hooks/useTerminalTheme";
import {
  elapsedMinutes,
  formatElapsed,
  formatClockTime,
  type Discharge,
  type Staff,
} from "@/lib/hospital";

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "TV — Painel de Higienização Terminal" },
      {
        name: "description",
        content:
          "Painel em tempo real: leitos em limpeza terminal, altas paradas, pausadas e colaboradores.",
      },
    ],
  }),
  component: TvPage,
});

const isTerminalBox = (d: Discharge) => (d.external_id || "").startsWith("listo:box:");
const isTerminal = (d: Discharge) =>
  (d.external_id || "").startsWith("listo:answer:") || isTerminalBox(d);
const isDesmont = (d: Discharge) => (d.external_id || "").startsWith("listo:desmont:");
const isLastCompletedSnapshot = (d: Discharge) =>
  (d.external_id || "").startsWith("snapshot:last-completed:");
const isBed = (d: Discharge) => (d.bed_number || "").toLowerCase().startsWith("leito");

function dismantleWasSuperseded(dismantle: Discharge, rows: Discharge[]): boolean {
  if (dismantle.status !== "in_progress") return false;
  const bedKey = operationalBedKey(dismantle.unit || "", dismantle.bed_number || "");
  const dismantleStart = new Date(dismantle.status_updated_at).getTime();
  if (!Number.isFinite(dismantleStart)) return false;
  const toleranceMs = 10 * 60 * 1000;

  return rows.some((row) => {
    if (operationalBedKey(row.unit || "", row.bed_number || "") !== bedKey) return false;

    if (isLastCompletedSnapshot(row)) {
      if (!row.completed_at) return false;
      const cleaningStarted = new Date(row.status_updated_at).getTime();
      const cleaningCompleted = new Date(row.completed_at).getTime();
      return (
        Number.isFinite(cleaningStarted) &&
        Number.isFinite(cleaningCompleted) &&
        cleaningStarted >= dismantleStart - toleranceMs &&
        cleaningCompleted >= dismantleStart
      );
    }

    if (!isTerminal(row) || (row.status !== "in_progress" && row.status !== "completed")) {
      return false;
    }
    const terminalMoment = new Date(row.status_updated_at).getTime();
    if (!Number.isFinite(terminalMoment) || terminalMoment < dismantleStart - toleranceMs) {
      return false;
    }
    return row.status !== "completed" || !row.completed_at ||
      new Date(row.completed_at).getTime() >= dismantleStart;
  });
}
const isTerminalDisplayLocation = (d: Discharge) => isBed(d) || isTerminalBox(d);

// 3C/3D continuam excluídos para leitos. A única exceção é Box UTI 3C/3D/3E,
// e ela existe exclusivamente nesta tela Terminal.
const isExcluded = (d: Discharge) =>
  isTerminalBox(d) ? !isTerminalUtiBoxUnit(d.unit || "") : isExcludedUnit(d.unit || "");
// Contorno de "caso crítico": só vale para os leitos do 8D/E e 7D/E.
const isCuidadoUnit = (d: Discharge) => /BLOCO\s+[DE]\s+0?[78]/i.test(d.unit || "");

// Turno atual em Brasília: manhã 06:20–13:40, tarde 13:40–22:00, noite 22:00–06:20.
// "Altas concluídas" usa o início do turno em curso como corte — reseta sozinho a
// cada troca de turno (bate com a operação real), em vez de só à meia-noite.
type Turno = "manha" | "tarde" | "noite";
const TURNO_LABEL: Record<Turno, string> = {
  manha: "Turno 06:20–13:40",
  tarde: "Turno 13:40–22:00",
  noite: "Turno 22:00–06:20",
};
function turnoAtualBRT(nowMs: number): { label: Turno; startMs: number } {
  const wall = new Date(nowMs - 3 * 60 * 60 * 1000); // campo de parede em horário de Brasília
  const minutos = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  const startAt = (hh: number, mm: number, dayOffset = 0) => {
    const w = new Date(wall);
    w.setUTCDate(w.getUTCDate() + dayOffset);
    w.setUTCHours(hh, mm, 0, 0);
    return w.getTime() + 3 * 60 * 60 * 1000; // volta pra instante real (UTC)
  };
  if (minutos >= 6 * 60 + 20 && minutos < 13 * 60 + 40)
    return { label: "manha", startMs: startAt(6, 20) };
  if (minutos >= 13 * 60 + 40 && minutos < 22 * 60)
    return { label: "tarde", startMs: startAt(13, 40) };
  if (minutos < 6 * 60 + 20) return { label: "noite", startMs: startAt(22, 0, -1) };
  return { label: "noite", startMs: startAt(22, 0) };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

type StaffActivity = "desmontando" | "em_alta" | "disponivel";

// Leitos "suíte" — têm meta de tempo maior (2h15 em vez de 1h15 nos blocos D/E).
const SUITE_BEDS = new Set([
  "1852",
  "1752",
  "1652",
  "1552",
  "1452",
  "1260",
  "1160",
  "1060",
  "960",
  "860",
  "760",
  "1855",
  "1755",
  "1655",
  "1555",
  "1455",
  "1261",
  "1161",
  "1061",
  "961",
  "861",
  "761",
  "1264",
  "1164",
  "1064",
  "964",
  "864",
  "764",
  "1267",
  "1167",
  "1067",
  "967",
  "884",
  "784",
  "877",
  "777",
  "878",
  "778",
]);

/** Meta de tempo de higiene (minutos), com base no bloco e se é leito suíte. */
function hygieneTargetMinutes(bedNumber: string, unit: string): number {
  const bedCode = (bedNumber.match(/\d+/) || [])[0] ?? "";
  const block = (unit.match(/Bloco\s+([A-Za-z])/i)?.[1] ?? "").toUpperCase();
  if (block === "C") return 50;
  if (block === "B") return 45;
  if (block === "D" || block === "E") return SUITE_BEDS.has(bedCode) ? 135 : 75;
  return 75; // fallback pra blocos não mapeados
}

function TvPage() {
  const { discharges, staff, loading, error } = useHospitalData();
  const now = useNow(15000);
  const clock = useClock();
  const { theme, setTheme, isDark, themeClass } = useTerminalTheme();
  const [selectedDischarge, setSelectedDischarge] = useState<Discharge | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [syncPulseVersion, setSyncPulseVersion] = useState(0);
  const didSyncOnceRef = useRef(false);
  const [completionFx, setCompletionFx] = useState<{ bed: string; key: number } | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shiftFxVersion, setShiftFxVersion] = useState(0);
  const prevTurnoStartRef = useRef<number | null>(null);

  // Realça visualmente quando chegam dados novos. O contador do topo tem
  // relógio próprio e acompanha o ciclo recorrente de 1 minuto do sincronizador.
  useEffect(() => {
    if (didSyncOnceRef.current) setSyncPulseVersion((v) => v + 1);
    else didSyncOnceRef.current = true;
  }, [discharges, staff]);

  useEffect(
    () => () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    },
    [],
  );

  // Detecta leitos cujo status mudou desde a última leitura, pra dar um flash
  // rápido de destaque. Usa uma "versão" por leito (não um timer) — cada mudança
  // incrementa a versão, o que remonta a linha e dispara uma animação CSS de um
  // disparo só. Isso não depende de nenhum timeout que possa ser cancelado por
  // outra atualização chegando no meio do caminho (era isso que prendia o flash).
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const flashVersionRef = useRef<Map<string, number>>(new Map());
  const entryVersionRef = useRef<Map<string, number>>(new Map());
  const [, forceFlashRerender] = useState(0);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const isFirstRun = prev.size === 0;
    let mudou = false;
    for (const d of discharges) {
      const externalId = d.external_id ?? "";
      const before = prev.get(externalId);
      if (!isFirstRun && before === undefined && externalId) {
        entryVersionRef.current.set(
          externalId,
          (entryVersionRef.current.get(externalId) ?? 0) + 1,
        );
        mudou = true;
      }
      if (before !== undefined && before !== d.status) {
        flashVersionRef.current.set(
          externalId,
          (flashVersionRef.current.get(externalId) ?? 0) + 1,
        );
        if (
          d.status === "completed" &&
          ["waiting_cleaning", "en_route", "in_progress"].includes(before)
        ) {
          setCompletionFx({ bed: d.bed_number, key: Date.now() });
          if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
          completionTimerRef.current = setTimeout(() => setCompletionFx(null), 1800);
        }
        mudou = true;
      }
    }
    prevStatusRef.current = new Map(discharges.map((d) => [d.external_id ?? "", d.status]));
    if (mudou || isFirstRun) forceFlashRerender((n) => n + 1);
  }, [discharges]);


  const flashVersions = flashVersionRef.current;
  const entryVersions = entryVersionRef.current;

  const filtered = useMemo(
    () => discharges.filter((d) => !isExcluded(d) && isTerminalDisplayLocation(d)),
    [discharges],
  );

  // Em Limpeza: terminal + in_progress
  const inFlight = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "in_progress")
        .sort(
          (a, b) =>
            new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime(),
        ),
    [filtered],
  );

  // A Caminho: terminal + en_route (colaborador alocado, ainda não iniciou)
  const enRoute = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "en_route")
        .sort(
          (a, b) =>
            new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime(),
        ),
    [filtered],
  );

  // Altas Paradas: sem colaborador alocado ainda
  const paused = useMemo(
    () =>
      filtered
        .filter((d) => isTerminal(d) && d.status === "waiting_cleaning")
        .sort(
          (a, b) =>
            new Date(a.status_updated_at).getTime() - new Date(b.status_updated_at).getTime(),
        ),
    [filtered],
  );

  // Pendências permanecem até uma resolução explícita, mesmo após 24 horas.
  const completedIssues = useMemo(() => {
    return filtered
      .filter(
        // Só "paused" de verdade (ainda bloqueado). "completed_with_issues" é o
        // status que o botão "concluir" usa pra resolver sem contar como alta de
        // verdade (ver CompleteButton) — some da lista assim que resolvido.
        (d) =>
          isTerminal(d) &&
          (d.status === "paused" || d.status === "maintenance"),
      )
      .sort(
        (a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime(),
      );
  }, [filtered]);

  // Desmontagens chegam pelo mesmo realtime. Se a limpeza terminal daquele ciclo
  // já começou ou terminou, a desmontagem não pode "ressuscitar" por um status
  // antigo ainda marcado como in_progress na origem.
  const dismantles = useMemo(() => filtered.filter(isDesmont), [filtered]);
  const dismantlesForDisplay = useMemo(
    () =>
      dismantles.map((d) =>
        dismantleWasSuperseded(d, filtered)
          ? { ...d, status: "completed" as const }
          : d,
      ),
    [dismantles, filtered],
  );
  const activeDesmont = useMemo(
    () => dismantlesForDisplay.filter((d) => d.status === "in_progress"),
    [dismantlesForDisplay],
  );

  // Colaboradores: derivar atividade por staff
  const staffRows = useMemo(() => {
    const activity = new Map<
      string,
      { kind: StaffActivity; start: string; bed: string; unit: string }
    >();

    // Se a limpeza terminal do mesmo leito já entrou em execução, a desmontagem
    // deixa de representar o estado atual tanto no card quanto na tabela de colaboradores.
    const inFlightBedKeys = new Set(
      inFlight.map((d) => operationalBedKey(d.unit || "", d.bed_number || "")),
    );

    for (const d of activeDesmont) {
      if (!d.assigned_staff_id) continue;
      const dismantleBedKey = operationalBedKey(d.unit || "", d.bed_number || "");
      if (inFlightBedKeys.has(dismantleBedKey)) continue;
      const prev = activity.get(d.assigned_staff_id);
      if (!prev || new Date(d.status_updated_at) > new Date(prev.start)) {
        activity.set(d.assigned_staff_id, {
          kind: "desmontando",
          start: d.status_updated_at,
          bed: d.bed_number,
          unit: d.unit,
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
          unit: d.unit,
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
          unit: a.unit,
        };
      })
      .sort((a, b) => {
        const order = { desmontando: 0, em_alta: 1, disponivel: 2 };
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        if (a.start && b.start) return new Date(b.start).getTime() - new Date(a.start).getTime();
        return a.staff.name.localeCompare(b.staff.name);
      });
  }, [inFlight, activeDesmont, staff]);

  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  // Memória operacional local da TV: permite detectar acúmulo de fila mesmo após
  // pequenas atualizações do realtime. Não escreve no banco.
  const [queueHistory, setQueueHistory] = useState<Array<{ t: number; count: number }>>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("tv:queueHistory") || "[]") as Array<{
        t: number;
        count: number;
      }>;
      setQueueHistory(raw.filter((p) => Date.now() - p.t < 2 * 60 * 60 * 1000));
    } catch {
      setQueueHistory([]);
    }
  }, []);
  useEffect(() => {
    setQueueHistory((prev) => {
      const nowPoint = Date.now();
      const last = prev[prev.length - 1];
      if (last && nowPoint - last.t < 2 * 60 * 1000 && last.count === paused.length) return prev;
      const next = [...prev, { t: nowPoint, count: paused.length }].filter(
        (p) => nowPoint - p.t < 2 * 60 * 60 * 1000,
      );
      localStorage.setItem("tv:queueHistory", JSON.stringify(next));
      return next;
    });
  }, [paused.length]);

  const queueDelta15 = useMemo(() => {
    if (!queueHistory.length) return 0;
    const target = now - 15 * 60 * 1000;
    const candidates = queueHistory.filter((p) => p.t <= target);
    const base = candidates[candidates.length - 1];
    return base ? paused.length - base.count : 0;
  }, [queueHistory, paused.length, now]);

  const oldestPausedMin = paused.length ? elapsedMinutes(paused[0].status_updated_at, now) : 0;

  const criticalBlock = useMemo(() => {
    const stats = new Map<string, { count: number; oldest: number }>();
    for (const d of paused) {
      const block = bedBlock(d) ?? "Outro";
      const minutes = elapsedMinutes(d.status_updated_at, now);
      const cur = stats.get(block) ?? { count: 0, oldest: 0 };
      stats.set(block, { count: cur.count + 1, oldest: Math.max(cur.oldest, minutes) });
    }
    return (
      Array.from(stats.entries())
        .map(([block, value]) => ({ block, ...value }))
        .sort((a, b) => b.count - a.count || b.oldest - a.oldest)[0] ?? null
    );
  }, [paused, now]);

  const operationState =
    paused.length >= 5 || queueDelta15 >= 3 || oldestPausedMin >= 45
      ? "critical"
      : paused.length >= 2 || queueDelta15 >= 2 || oldestPausedMin >= 25
        ? "attention"
        : "normal";

  const operationAttention = useMemo(() => {
    const items: string[] = [];
    if (paused[0]) {
      items.push(`${paused[0].bed_number} é a alta parada mais antiga (${oldestPausedMin} min)`);
    }
    if (criticalBlock && criticalBlock.count >= 2) {
      items.push(`Bloco ${criticalBlock.block} concentra ${criticalBlock.count} altas paradas`);
    }
    if (queueDelta15 >= 2) {
      items.push(`Fila cresceu +${queueDelta15} nos últimos 15 min`);
    }
    if (completedIssues.length > 0) {
      items.push(`${completedIssues.length} leito(s) pausado(s) aguardando resolução`);
    }
    if (!items.length) items.push("Sem exceções relevantes neste momento");
    return items.slice(0, 3);
  }, [paused, oldestPausedMin, criticalBlock, queueDelta15, completedIssues.length]);

  useEffect(() => {
    if (operationState !== "critical") return;
    const key = `${paused.length}|${criticalBlock?.block ?? "-"}|${queueDelta15}`;
    const last = localStorage.getItem("tv:lastOperationalAlert");
    if (last === key) return;
    localStorage.setItem("tv:lastOperationalAlert", key);
    toast.warning(
      criticalBlock
        ? `Operação crítica: ${paused.length} altas paradas · Bloco ${criticalBlock.block} concentra ${criticalBlock.count}`
        : `Operação crítica: ${paused.length} altas paradas`,
      { duration: 10000 },
    );
  }, [operationState, paused.length, criticalBlock, queueDelta15]);

  // --- Extras (desktop/TV) ---

  // 1) Tendência: guarda um retrato dos números a cada ~5min, pra comparar com
  // "há 1 hora" e mostrar seta de subida/descida nos KPIs.
  type Snapshot = {
    t: number;
    inFlight: number;
    enRoute: number;
    paused: number;
    completedIssues: number;
  };
  const historyRef = useRef<Snapshot[]>([]);
  useEffect(() => {
    const t = Date.now();
    const last = historyRef.current[historyRef.current.length - 1];
    if (!last || t - last.t > 5 * 60 * 1000) {
      historyRef.current.push({
        t,
        inFlight: inFlight.length,
        enRoute: enRoute.length,
        paused: paused.length,
        completedIssues: completedIssues.length,
      });
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
    const all = [...inFlight, ...enRoute, ...paused, ...completedIssues].filter(isCuidadoUnit);
    if (!all.length) return null;
    return all.reduce((oldest, d) =>
      new Date(d.status_updated_at).getTime() < new Date(oldest.status_updated_at).getTime()
        ? d
        : oldest,
    );
  }, [inFlight, enRoute, paused, completedIssues]);

  // O painel não possui o histórico completo A Caminho → início depois que o status muda.
  // Por isso, mostramos somente a idade média dos leitos que estão A Caminho agora.
  const avgEnRouteAge = useMemo(() => {
    if (!enRoute.length) return null;
    const sum = enRoute.reduce(
      (acc, d) => acc + elapsedMinutes(d.status_updated_at, now),
      0,
    );
    return Math.round(sum / enRoute.length);
  }, [enRoute, now]);

  const avgExecution = useMemo(() => {
    if (!inFlight.length) return null;
    const sum = inFlight.reduce((acc, d) => acc + elapsedMinutes(d.status_updated_at, now), 0);
    return Math.round(sum / inFlight.length);
  }, [inFlight, now]);

  // 4) Resumo do turno: quantas altas foram concluídas desde o início do turno em
  // curso (manhã/tarde/noite — ver turnoAtualBRT), separadas por bloco (D/E e B/C).
  // Fonte única: discharges.completed_at, direto do banco — nunca depende de um
  // "limpar" local, pra ser sempre 100% fiel ao que realmente aconteceu.
  const turnoAtual = useMemo(() => turnoAtualBRT(now), [now]);
  useEffect(() => {
    const previous = prevTurnoStartRef.current;
    if (previous !== null && previous !== turnoAtual.startMs) {
      setShiftFxVersion((v) => v + 1);
    }
    prevTurnoStartRef.current = turnoAtual.startMs;
  }, [turnoAtual.startMs]);

  const concluidasHojePorBloco = useMemo(() => {
    const done = discharges.filter(
      (d) =>
        !isExcluded(d) &&
        isTerminalDisplayLocation(d) &&
        isTerminal(d) &&
        d.status === "completed" &&
        !!d.completed_at &&
        new Date(d.completed_at).getTime() >= turnoAtual.startMs,
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
  }, [discharges, turnoAtual]);
  const concluidasHoje = concluidasHojePorBloco.total;

  const recentCompleted = useMemo(() => {
    const latestByBed = new Map<string, Discharge>();
    const candidates = discharges
      .filter(
        (d) =>
          !isExcluded(d) &&
          isTerminalDisplayLocation(d) &&
          !!d.completed_at &&
          new Date(d.completed_at).getTime() >= turnoAtual.startMs &&
          (isLastCompletedSnapshot(d) || (isTerminalBox(d) && d.status === "completed")),
      )
      .sort(
        (a, b) =>
          new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime(),
      );

    for (const d of candidates) {
      const key = operationalBedKey(d.unit || "", d.bed_number || "");
      if (!latestByBed.has(key)) latestByBed.set(key, d);
    }
    return Array.from(latestByBed.values());
  }, [discharges, turnoAtual.startMs]);

  const recentCompletionVersionRef = useRef<Map<string, number>>(new Map());
  const previousCompletionAtRef = useRef<Map<string, string>>(new Map());
  const recentCompletionInitializedRef = useRef(false);
  const [, forceRecentCompletionRerender] = useState(0);
  useEffect(() => {
    let changed = false;
    const next = new Map<string, string>();
    for (const d of recentCompleted) {
      const key = operationalBedKey(d.unit || "", d.bed_number || "");
      const completedAt = d.completed_at ?? "";
      next.set(key, completedAt);
      const before = previousCompletionAtRef.current.get(key);
      if (
        recentCompletionInitializedRef.current &&
        completedAt &&
        before !== completedAt
      ) {
        recentCompletionVersionRef.current.set(
          key,
          (recentCompletionVersionRef.current.get(key) ?? 0) + 1,
        );
        changed = true;
      }
    }
    previousCompletionAtRef.current = next;
    recentCompletionInitializedRef.current = true;
    if (changed) forceRecentCompletionRerender((v) => v + 1);
  }, [recentCompleted]);

  const recentCompletionVersions = recentCompletionVersionRef.current;

  const emExecucaoPorBloco = useMemo(() => {
    let de = 0;
    let b = 0;
    let c = 0;
    let outros = 0;
    for (const d of inFlight) {
      const block = bedBlock(d);
      if (block === "D" || block === "E") de++;
      else if (block === "B") b++;
      else if (block === "C") c++;
      else outros++;
    }
    return { de, b, c, outros };
  }, [inFlight]);

  // 5) Horário noturno (22h-6h, Brasília) — escurece um pouco a tela pra cansar
  // menos a vista/o painel de madrugada.
  const horaBRT = new Date(now - 3 * 60 * 60 * 1000).getUTCHours();
  const isNoturno = horaBRT >= 22 || horaBRT < 6;


  const filtros = theme === "original" && isNoturno ? "brightness(0.88)" : undefined;

  return (
    <div
      className={`${themeClass} tv-terminal-page scrollbar-hidden min-h-screen w-screen max-w-full overflow-x-hidden overflow-y-auto lg:h-screen lg:overflow-hidden flex flex-col font-sans relative transition-colors duration-300 bg-background text-foreground`}
      style={filtros ? { filter: filtros } : undefined}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ backgroundColor: "oklch(0.62 0.18 235)" }}
      />
      {shiftFxVersion > 0 && (
        <div
          key={shiftFxVersion}
          className="tv-shift-wash pointer-events-none fixed inset-0 z-[70] block overflow-hidden"
          aria-hidden="true"
        />
      )}
      {completionFx && (
        <div
          key={completionFx.key}
          className="tv-completion-fx pointer-events-none fixed left-1/2 top-[14%] z-[75] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-3 py-2 text-emerald-100 shadow-2xl sm:px-4 lg:top-[18%]"
          aria-hidden="true"
        >
          <CircleCheck className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            {completionFx.bed} finalizado
          </span>
        </div>
      )}
      <header className="panel-shell-header flex-none flex flex-col gap-1.5 border-b border-white/15 px-3 py-2 sm:px-4 sm:py-2.5 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="min-w-0 text-[15px] font-bold leading-tight tracking-tight sm:text-lg lg:text-2xl">
            Painel de Higienização Terminal
          </h1>
          <PanelNav />
          <a href="/control" className="inline-flex min-h-9 items-center rounded-md border border-white/20 px-2 text-[11px] text-white/75 sm:text-xs">
            Acesso do operador
          </a>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5 sm:gap-3 lg:justify-end lg:gap-4">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/50 sm:gap-1.5 sm:text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            ao vivo
          </span>
          <span
            key={syncPulseVersion}
            className={syncPulseVersion > 0 ? "tv-sync-pulse max-w-full" : "max-w-full"}
          >
            <SyncCounter
              cadenceSeconds={60}
              cadenceLabel="atualiza a cada 1min"
              alignToClock
            />
          </span>
          <button
            type="button"
            aria-pressed={exceptionsOnly}
            onClick={() => setExceptionsOnly((v) => !v)}
            title="Mostrar somente exceções na grade principal"
            className={`flex min-h-9 items-center gap-1 rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide transition-colors active:scale-95 sm:text-xs ${
              exceptionsOnly
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-white/15 text-white/55 hover:bg-white/10"
            }`}
          >
            <Eye className="h-3 w-3" /> Só exceções
          </button>

          <ThemePicker theme={theme} onChange={setTheme} />
          <span className="font-mono text-lg tabular-nums sm:text-xl lg:text-3xl">{clock}</span>
        </div>
      </header>
      {(error || loading) && (
        <p role="status" className="px-4 py-2 text-sm text-amber-200 lg:px-6">
          {error ?? "Carregando dados do painel…"}
        </p>
      )}

      <div className="min-w-0 max-w-full flex-none overflow-hidden px-4 pt-2.5 lg:px-6">
        <div className="grid min-w-0 max-w-full gap-2 lg:grid-cols-2">
          <div
            key={operationState}
            className={`tv-operation-state-change min-w-0 overflow-hidden rounded-xl border px-3 py-2.5 ${
              operationState === "critical"
                ? "border-red-400/35 bg-red-400/[0.08]"
                : operationState === "attention"
                  ? "border-amber-400/30 bg-amber-400/[0.07]"
                  : "border-emerald-400/20 bg-emerald-400/[0.045]"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {operationState === "normal" ? (
                  <Activity className="h-4 w-4 shrink-0 text-emerald-300" />
                ) : (
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 ${operationState === "critical" ? "text-red-300" : "text-amber-300"}`}
                  />
                )}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-white/40">
                    Situação da operação
                  </div>
                  <div className="text-sm font-bold uppercase">
                    {operationState === "critical"
                      ? "Crítica"
                      : operationState === "attention"
                        ? "Atenção"
                        : "Normal"}
                  </div>
                </div>
              </div>
              <span className="shrink-0 text-xs text-white/45 lg:text-xs">
                Fila 15m:{" "}
                <strong className={queueDelta15 > 0 ? "text-amber-200" : "text-white/75"}>
                  {queueDelta15 > 0 ? `+${queueDelta15}` : queueDelta15}
                </strong>
              </span>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-white/60 lg:text-xs">
              {operationAttention.slice(0, 2).map((item) => (
                <span key={item} className="truncate">
                  • {item}
                </span>
              ))}
            </div>
          </div>

          <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-400/[0.035] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CircleCheck className="h-4 w-4 shrink-0 text-emerald-300" />
              <div className="text-xs font-semibold uppercase tracking-widest text-white/45">
                Finalizados recentes
              </div>
            </div>
            {recentCompleted.length ? (
              <HorizontalAutoScroll resetKey={String(turnoAtual.startMs)}>
                <div className="mt-2 flex min-w-max gap-1.5 pr-3">
                  {recentCompleted.map((d) => {
                    const recentKey = operationalBedKey(d.unit || "", d.bed_number || "");
                    const recentVersion = recentCompletionVersions.get(recentKey) ?? 0;
                    return (
                    <div
                      key={`${d.id}-recent-v${recentVersion}`}
                      className={`flex min-w-[112px] shrink-0 items-center justify-between gap-1.5 rounded-lg border border-emerald-300/15 bg-black/10 px-2 py-1.5 sm:min-w-[126px] sm:gap-2 ${
                        recentVersion > 0 ? "tv-recent-completed-in" : ""
                      }`}
                    >
                      <span className="truncate text-xs font-semibold text-white/75 lg:text-xs">
                        {d.bed_number}
                      </span>
                      <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-emerald-200 lg:text-xs">
                        {formatClockTime(d.completed_at!)}
                      </span>
                    </div>
                    );
                  })}
                </div>
              </HorizontalAutoScroll>
            ) : (
              <div className="mt-2 text-xs text-white/35 lg:text-xs">
                Nenhuma higiene finalizada neste turno.
              </div>
            )}
          </div>
        </div>
      </div>



      <div className="flex-none grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 lg:gap-3 px-4 lg:px-6 py-2.5 lg:py-3">
        <KpiCard
          label="Em Limpeza"
          value={inFlight.length}
          accent="oklch(0.75 0.22 155)"
          trend={trendFor("inFlight", inFlight.length)}
        />
        <KpiCard
          label="A Caminho"
          value={enRoute.length}
          accent="oklch(0.74 0.18 230)"
          trend={trendFor("enRoute", enRoute.length)}
        />
        <KpiCard
          label="Altas Paradas"
          value={paused.length}
          accent="oklch(0.78 0.2 60)"
          trend={trendFor("paused", paused.length)}
          higherIsBad
        />
        <KpiCard
          label="Leitos Pausados"
          value={completedIssues.length}
          accent="oklch(0.72 0.23 25)"
          trend={trendFor("completedIssues", completedIssues.length)}
          higherIsBad
        />
        <KpiCard
          label="A Caminho · média agora"
          value={avgEnRouteAge ?? 0}
          display={avgEnRouteAge == null ? "—" : `${avgEnRouteAge}m`}
          accent="oklch(0.8 0.16 85)"
        />
        <KpiCard
          label="Em execução · média agora"
          value={avgExecution ?? 0}
          display={avgExecution == null ? "—" : `${avgExecution}m`}
          accent="oklch(0.75 0.14 195)"
        />
      </div>

      <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-3 px-4 lg:px-6 pb-4">
        <TerminalBedsPanel
          inFlight={exceptionsOnly ? [] : inFlight}
          enRoute={exceptionsOnly ? [] : enRoute}
          paused={paused}
          dismantles={dismantlesForDisplay}
          nowMs={now}
          staffMap={staffMap}
          flashVersions={flashVersions}
          entryVersions={entryVersions}
          worstId={worstCase?.id}
          onSelect={setSelectedDischarge}
          className={
            paused.length >= 4
              ? "order-2 lg:order-none lg:col-start-1 lg:col-span-9 lg:row-start-1"
              : "order-2 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-1"
          }
        />
        <BedsPanel
          title="Leitos Pausados"
          icon={<CirclePause className="w-4 h-4 text-white/60" />}
          rows={completedIssues}
          nowMs={now}
          staffMap={staffMap}
          tone="red"
          showReason
          showServiceOrder
          showComplete
          hideCount
          empty="Nenhum leito com pendência aberta."
          flashVersions={flashVersions}
          worstId={worstCase?.id}
          className={
            paused.length >= 4
              ? "order-6 lg:order-none lg:col-start-1 lg:col-span-9 lg:row-start-2"
              : "order-6 lg:order-none lg:col-start-1 lg:col-span-8 lg:row-start-2"
          }
        />
        <StaffPanel
          rows={staffRows}
          nowMs={now}
          emExecucaoPorBloco={emExecucaoPorBloco}
          className={
            paused.length >= 4
              ? "order-1 lg:order-none lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-2"
              : "order-1 lg:order-none lg:col-start-9 lg:col-span-4 lg:row-start-1 lg:row-span-2"
          }
        />
      </div>

      <div className="hidden lg:flex flex-none items-center justify-center gap-5 px-6 py-1.5 border-t border-white/10 text-xs text-white/40">
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="h-3.5 w-3.5 text-[oklch(0.72_0.16_150)]" />
          {TURNO_LABEL[turnoAtual.label]}:{" "}
          <span className="text-white/70 font-semibold">{concluidasHoje}</span> altas concluídas
        </span>
        <span className="text-white/20">·</span>
        <span>
          Bloco D/E:{" "}
          <span className="text-white/70 font-semibold">{concluidasHojePorBloco.de}</span>
        </span>
        <span className="text-white/20">·</span>
        <span>
          Bloco B/C:{" "}
          <span className="text-white/70 font-semibold">{concluidasHojePorBloco.bc}</span>
        </span>
        <span className="text-white/20">·</span>
        <span>
          Tempo médio em execução agora:{" "}
          <span className="text-white/70 font-semibold">
            {avgExecution == null ? "—" : `${avgExecution}m`}
          </span>
        </span>
      </div>
      {selectedDischarge && (
        <DischargeTimelineModal
          discharge={selectedDischarge}
          staffName={
            selectedDischarge.assigned_staff_id
              ? staffMap.get(selectedDischarge.assigned_staff_id)?.name
              : null
          }
          nowMs={now}
          onClose={() => setSelectedDischarge(null)}
        />
      )}
    </div>
  );
}

function HorizontalAutoScroll({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey: string;
}) {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref) return;
    ref.scrollLeft = 0;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const USER_PAUSE_MS = 15_000;
    let raf = 0;
    let direction = 1;
    let edgePause = 110;
    let pausedUntil = 0;
    let pos = 0;

    const pauseForUser = () => {
      pos = ref.scrollLeft;
      pausedUntil = Date.now() + USER_PAUSE_MS;
    };

    ref.addEventListener("wheel", pauseForUser, { passive: true });
    ref.addEventListener("touchstart", pauseForUser, { passive: true });
    ref.addEventListener("touchmove", pauseForUser, { passive: true });
    ref.addEventListener("pointerdown", pauseForUser, { passive: true });
    ref.addEventListener("focusin", pauseForUser);
    ref.addEventListener("keydown", pauseForUser);

    const step = () => {
      const max = Math.max(0, ref.scrollWidth - ref.clientWidth);
      if (max > 4) {
        if (Date.now() < pausedUntil) {
          pos = ref.scrollLeft;
        } else if (edgePause > 0) {
          edgePause -= 1;
        } else {
          const distanceToEdge = Math.min(pos, max - pos);
          const easing = Math.max(0.35, Math.min(1, distanceToEdge / 90));
          pos += direction * 0.46 * easing;
          if (pos >= max) {
            pos = max;
            direction = -1;
            edgePause = 110;
          } else if (pos <= 0) {
            pos = 0;
            direction = 1;
            edgePause = 110;
          }
          ref.scrollLeft = Math.floor(pos);
        }
      } else {
        pos = 0;
        ref.scrollLeft = 0;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ref.removeEventListener("wheel", pauseForUser);
      ref.removeEventListener("touchstart", pauseForUser);
      ref.removeEventListener("touchmove", pauseForUser);
      ref.removeEventListener("pointerdown", pauseForUser);
      ref.removeEventListener("focusin", pauseForUser);
      ref.removeEventListener("keydown", pauseForUser);
    };
  }, [ref, resetKey]);

  return (
    <div
      ref={setRef}
      className="scrollbar-hidden w-full max-w-full overflow-x-auto overscroll-contain"
    >
      {children}
    </div>
  );
}

function useClock() {
  const [t, setT] = useState<string>("");
  useEffect(() => {
    const readClock = () =>
      new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
    setT(readClock());
    const id = setInterval(() => setT(readClock()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function KpiCard({
  label,
  value,
  display,
  accent,
  trend,
  higherIsBad,
}: {
  label: string;
  value: number;
  display?: string;
  accent: string;
  trend?: number | null;
  higherIsBad?: boolean;
}) {
  const trendColor =
    trend == null || trend === 0
      ? "rgba(255,255,255,0.35)"
      : trend > 0 === !!higherIsBad
        ? "oklch(0.7 0.19 25)" // piorou
        : "oklch(0.72 0.17 155)"; // melhorou
  return (
    <div
      className="panel-kpi-card flex flex-col gap-0.5 rounded-xl border px-2.5 py-2 sm:px-3 lg:flex-row lg:items-center lg:justify-between lg:gap-0 lg:px-4"
      style={{
        ["--panel-accent" as string]: accent,
        backgroundColor: accent.replace(")", " / 0.12)"),
        borderColor: accent.replace(")", " / 0.42)"),
      }}
    >
      <div className="text-[10px] font-medium uppercase leading-tight tracking-widest text-white/70 sm:text-xs">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <div
          key={display ?? value}
          className="tv-kpi-value-change text-xl tabular-nums leading-none sm:text-2xl lg:text-4xl"
          style={{ color: accent, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
        >
          {display ?? value}
        </div>
        {trend != null && trend !== 0 && (
          <span
            className="hidden lg:inline text-xs font-mono"
            style={{ color: trendColor }}
            title="Comparado a 1h atrás"
          >
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
  green: "oklch(0.72 0.17 155 / 0.13)",
  amber: "oklch(0.80 0.18 80 / 0.16)",
  red: "oklch(0.68 0.20 25 / 0.13)",
  blue: "oklch(0.72 0.18 235 / 0.13)",
};

/**
 * Bloco do leito ("D", "E", "B", "C"...) a partir do texto da unidade
 * (ex: "Bloco D 12º Andar · Ala 2"). Mesma regex usada no resumo do dia.
 */
function bedBlock(d: Discharge): string | null {
  return (d.unit || "").toUpperCase().match(/BLOCO\s+([A-Z])/)?.[1] ?? null;
}

/**
 * "Leitos em Limpeza Terminal" + "A Caminho" + "Altas Paradas" unidos num único
 * painel de cards: leito, tempo e nome do colaborador. Verde = em execução
 * (higienizando agora), azul = a caminho, laranja = alta parada (padrão já usado
 * no resto do painel para leito sem colaborador alocado). Mantém, sempre visível,
 * a contagem de altas paradas por bloco (D/E, B, C).
 */
type DismantleMarker = {
  row: Discharge;
  startedAt: string;
  active: boolean;
};

function findDismantleForTerminal(
  terminal: Discharge,
  dismantles: Discharge[],
  nowMs: number,
): DismantleMarker | null {
  const bedKey = operationalBedKey(terminal.unit || "", terminal.bed_number || "");
  const terminalAt = new Date(terminal.status_updated_at).getTime();
  // Para Alta Parada/A Caminho, a desmontagem deve pertencer ao ciclo que nasceu
  // naquele estado. Em execução, aceitamos até 4h antes do início da higiene,
  // porque a desmontagem normalmente antecede a limpeza terminal.
  const earliest =
    terminal.status === "in_progress"
      ? terminalAt - 4 * 60 * 60 * 1000
      : terminalAt - 30 * 60 * 1000;

  const candidates = dismantles
    .filter((d) => operationalBedKey(d.unit || "", d.bed_number || "") === bedKey)
    .filter((d) => d.status === "in_progress" || d.status === "completed")
    .map((d) => ({
      row: d,
      startedAt: d.status_updated_at,
      active: d.status === "in_progress",
      startedMs: new Date(d.status_updated_at).getTime(),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.startedMs) &&
        item.startedMs >= earliest &&
        item.startedMs <= nowMs + 5 * 60 * 1000,
    )
    .sort((a, b) => b.startedMs - a.startedMs);

  const latest = candidates[0];
  return latest
    ? { row: latest.row, startedAt: latest.startedAt, active: latest.active }
    : null;
}

function TerminalBedsPanel({
  inFlight,
  enRoute,
  paused,
  dismantles,
  nowMs,
  staffMap,
  flashVersions,
  entryVersions,
  worstId,
  onSelect,
  className,
}: {
  inFlight: Discharge[];
  enRoute: Discharge[];
  paused: Discharge[];
  dismantles: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
  flashVersions?: Map<string, number>;
  entryVersions?: Map<string, number>;
  worstId?: string;
  onSelect?: (discharge: Discharge) => void;
  className?: string;
}) {
  const KIND_ORDER = { parada: 0, desmontagem: 1, caminho: 2, execucao: 3 } as const;
  const KIND_COLOR = {
    parada: "oklch(0.78 0.2 60)", // laranja — padrão já usado pra alta parada
    desmontagem: "oklch(0.68 0.20 300)", // roxo — desmontagem em andamento
    caminho: "oklch(0.74 0.18 230)", // azul
    execucao: "oklch(0.72 0.17 155)", // verde
  } as const;
  const KIND_LABEL = {
    parada: "Alta Parada",
    desmontagem: "Em Desmontagem",
    caminho: "A Caminho",
    execucao: "Em Execução",
  } as const;
  // Em execução que estourou a meta: vermelho, sem chamar mais atenção que isso
  // (sem piscar, sem selo extra) — só a cor muda e o rótulo vira "Estourado".
  const OVERDUE_COLOR = "oklch(0.68 0.19 25)";

  const terminalCards = [
    ...paused.map((d) => ({ d, kind: "parada" as const })),
    ...enRoute.map((d) => ({ d, kind: "caminho" as const })),
    ...inFlight.map((d) => ({ d, kind: "execucao" as const })),
  ];
  const terminalBedKeys = new Set(
    terminalCards.map(({ d }) => operationalBedKey(d.unit || "", d.bed_number || "")),
  );
  const standaloneDismantles = dismantles
    .filter((d) => d.status === "in_progress")
    .filter((d) => !terminalBedKeys.has(operationalBedKey(d.unit || "", d.bed_number || "")))
    .map((d) => ({ d, kind: "desmontagem" as const }));

  const cards = [...terminalCards, ...standaloneDismantles].sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (
      elapsedMinutes(b.d.status_updated_at, nowMs) - elapsedMinutes(a.d.status_updated_at, nowMs)
    );
  });
  const paradasPorBloco = useMemo(() => {
    let de = 0;
    let b = 0;
    let c = 0;
    let outros = 0;
    for (const d of paused) {
      const block = bedBlock(d);
      if (block === "D" || block === "E") de++;
      else if (block === "B") b++;
      else if (block === "C") c++;
      else outros++;
    }
    return { de, b, c, outros };
  }, [paused]);

  return (
    <section
      className={`h-[520px] lg:h-full panel-surface rounded-xl border overflow-hidden flex flex-col lg:min-h-0 ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold sm:text-base">
            <BrushCleaning className="w-4 h-4 text-white/60" />
            Leitos em Higienização
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs lg:text-xs font-medium text-white/55">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR.execucao }} />
              Em execução
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR.caminho }} />A
              caminho
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR.parada }} />
              Alta parada
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR.desmontagem }} />
              Em desmontagem
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: OVERDUE_COLOR }} />
              Estourado
            </span>
          </div>
          {/* Altas paradas por bloco — sempre visível, mobile incluso. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto sm:flex-nowrap">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40 sm:whitespace-nowrap sm:text-xs">
              Altas paradas por bloco:
            </span>
            {(
              [
                ["D/E", paradasPorBloco.de],
                ["B", paradasPorBloco.b],
                ["C", paradasPorBloco.c],
                ...(paradasPorBloco.outros > 0
                  ? [["Outros", paradasPorBloco.outros] as const]
                  : []),
              ] as const
            ).map(([label, value]) => (
              <span
                key={label}
                title={`Altas paradas no Bloco ${label}`}
                className="inline-flex min-w-0 items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-tight sm:text-xs"
                style={{
                  borderColor: KIND_COLOR.parada.replace(")", " / 0.4)"),
                  background: KIND_COLOR.parada.replace(")", " / 0.12)"),
                }}
              >
                <span className="font-semibold uppercase tracking-wide text-white/60">
                  <span className="hidden sm:inline">Bloco </span>{label}
                </span>
                <span
                  className="font-bold tabular-nums"
                  style={{ color: value > 0 ? KIND_COLOR.parada : "rgba(255,255,255,0.4)" }}
                >
                  {value}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="terminal-panel-content flex-1 min-h-0 overflow-hidden">
        {cards.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Nenhum leito em higienização.</div>
        ) : (
          <AutoScroll>
            <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 sm:gap-2 sm:p-3 lg:grid-cols-4 xl:grid-cols-5">
              {cards.map(({ d, kind }) => {
                const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : null;
                const version = flashVersions?.get(d.external_id ?? "") ?? 0;
                const entryVersion = entryVersions?.get(d.external_id ?? "") ?? 0;
                const isWorst = worstId && d.id === worstId;
                const minutes = elapsedMinutes(d.status_updated_at, nowMs);
                const target =
                  kind === "execucao" ? hygieneTargetMinutes(d.bed_number, d.unit) : null;
                const overtime = target != null && minutes >= target;
                const dismantle =
                  kind === "execucao"
                    ? null
                    : kind === "desmontagem"
                      ? { row: d, startedAt: d.status_updated_at, active: true }
                      : findDismantleForTerminal(d, dismantles, nowMs);
                // A desmontagem ativa pode substituir visualmente Alta Parada/A Caminho,
                // mas nunca uma Limpeza Terminal que já entrou em execução.
                const isDismantling = kind !== "execucao" && dismantle?.active === true;
                const dismantleName = isDismantling && dismantle.row.assigned_staff_id
                  ? staffMap.get(dismantle.row.assigned_staff_id)?.name
                  : null;
                const displayName = dismantleName ?? name;
                const base = isDismantling
                  ? KIND_COLOR.desmontagem
                  : overtime ? OVERDUE_COLOR : KIND_COLOR[kind];
                return (
                  <div
                    key={`${d.id}-v${version}`}
                    onClick={() => onSelect?.(d)}
                    role={onSelect ? "button" : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (onSelect && (e.key === "Enter" || e.key === " ")) onSelect(d);
                    }}
                    className={`relative flex min-w-0 flex-col gap-1 rounded-lg border px-2 py-1.5 sm:gap-1.5 sm:px-2.5 sm:py-2 ${
                      onSelect ? "cursor-pointer hover:-translate-y-0.5 hover:bg-white/[0.05]" : ""
                    } ${entryVersion > 0 ? "tv-card-enter" : ""} ${
                      version > 0 ? "tv-card-status-change flash-row" : ""
                    } ${overtime || isWorst ? "tv-critical-breathe" : ""}`}
                    style={{
                      borderColor: base.replace(")", " / 0.45)"),
                      background: base.replace(")", " / 0.14)"),
                    }}
                  >
                    {isWorst && (
                      <span
                        className="panel-critical-badge absolute -right-1 -top-1 rounded-[3px] border px-1 py-px text-[9px] font-semibold uppercase tracking-wide sm:-right-1.5 sm:-top-1.5 sm:text-xs"
                        style={{
                          borderColor: "oklch(0.7 0.2 25 / 0.5)",
                          background: "oklch(0.98 0.01 250)",
                          color: "oklch(0.78 0.19 25)",
                        }}
                      >
                        mais antigo
                      </span>
                    )}
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="truncate text-sm font-bold tabular-nums sm:text-base lg:text-xl">
                        {d.bed_number}
                      </span>
                      {(kind !== "parada" || isDismantling) && (
                        <span className="shrink-0 font-mono text-xs tabular-nums text-white/80 sm:text-sm">
                          {formatElapsed(isDismantling ? dismantle.startedAt : d.status_updated_at, nowMs)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center py-1 text-center min-h-[48px]">
                      {kind === "parada" && !isDismantling ? (
                        <>
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/55 sm:text-xs">
                            Aguardando há
                          </span>
                          <span
                            className="mt-1 font-mono text-lg font-bold leading-none tabular-nums sm:text-xl lg:text-2xl"
                            style={{ color: base }}
                          >
                            {formatElapsed(d.status_updated_at, nowMs)}
                          </span>
                          <span className="mt-1 line-clamp-1 text-[11px] leading-tight text-white/55 sm:text-xs">
                            {d.unit || "Unidade não informada"}
                          </span>
                        </>
                      ) : (
                        <span
                          className="line-clamp-2 text-[12px] font-bold leading-tight sm:text-[13px] lg:text-[15px]"
                          style={{ color: displayName ? base : "rgba(255,255,255,0.4)" }}
                        >
                          {displayName ?? "sem colaborador"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${
                          version > 0 ? "tv-status-pill-morph" : ""
                        }`}
                        style={{ color: base, background: base.replace(")", " / 0.18)") }}
                      >
                        {isDismantling ? KIND_LABEL.desmontagem : overtime ? "Estourado" : KIND_LABEL[kind]}
                      </span>
                      {isDismantling ? (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/65 sm:text-xs">
                          Início {formatClockTime(dismantle.startedAt)}
                        </span>
                      ) : kind === "execucao" ? (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/55 sm:text-xs">
                          Início {formatClockTime(d.status_updated_at)}
                        </span>
                      ) : dismantle ? (
                        <span
                          className="shrink-0 font-mono text-[10px] tabular-nums sm:text-xs"
                          style={{
                            color: dismantle.active
                              ? KIND_COLOR.desmontagem
                              : "rgba(255,255,255,0.62)",
                          }}
                        >
                          {dismantle.active ? "Em desmontagem" : "Desmontado"}{" "}
                          {formatClockTime(dismantle.startedAt)}
                        </span>
                      ) : kind === "parada" ? (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/50 sm:text-xs">
                          Registro {formatClockTime(d.status_updated_at)}
                        </span>
                      ) : null}
                    </div>
                    {kind === "execucao" && target != null && (
                      <div className="tv-card-progress-track h-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="tv-card-progress-fill h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round((minutes / target) * 100))}%`,
                            background: overtime ? OVERDUE_COLOR : base,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AutoScroll>
        )}
      </div>
    </section>
  );
}

function BedsPanel({
  title,
  icon,
  rows,
  nowMs,
  staffMap,
  tone,
  showReason,
  showServiceOrder,
  showComplete,
  empty,
  flashVersions,
  className,
  worstId,
  caption,
  hideCount,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
  tone: Tone;
  showReason?: boolean;
  showServiceOrder?: boolean;
  showComplete?: boolean;
  empty: string;
  flashVersions?: Map<string, number>;
  className?: string;
  worstId?: string;
  caption?: string;
  hideCount?: boolean;
}) {
  const renderBedLabel = (d: Discharge, isWorst: boolean | "") => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{d.bed_number}</span>
      {isWorst && (
        <span
          title="Caso ativo há mais tempo no recorte operacional"
          className="shrink-0 rounded-[3px] border px-1 py-px text-xs lg:text-xs font-semibold uppercase tracking-wide"
          style={{
            borderColor: "oklch(0.7 0.2 25 / 0.5)",
            color: "oklch(0.78 0.19 25)",
          }}
        >
          mais antigo
        </span>
      )}
    </span>
  );

  return (
    <section
      className={`h-[300px] lg:h-full panel-surface rounded-xl border overflow-hidden flex flex-col lg:min-h-0 min-w-0 max-w-full ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {!hideCount && <span className="text-xs text-white/50">{rows.length}</span>}
        </div>
        {caption && (
          <div className="hidden lg:block text-xs text-white/30 mt-0.5">{caption}</div>
        )}
      </div>
      <div className="terminal-panel-content flex-1 min-h-0 min-w-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">{empty}</div>
        ) : (
          <AutoScroll>
            <div className="min-w-0 max-w-full">
              <div className="space-y-2 p-2 md:hidden">
                {rows.map((d) => {
                  const overtime = elapsedMinutes(d.status_updated_at, nowMs) >= 60;
                  const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
                  const version = flashVersions?.get(d.external_id ?? "") ?? 0;
                  const isWorst = !!(worstId && d.id === worstId);
                  return (
                    <div
                      key={`${d.id}-mobile-v${version}`}
                      className={`panel-status-row min-w-0 rounded-lg border border-white/8 px-2.5 py-2 ${version > 0 ? "flash-row" : ""}`}
                      style={{
                        background:
                          overtime && tone === "green" ? "oklch(0.4 0.13 55 / 0.3)" : toneBg[tone],
                      }}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0 font-bold text-[13px]">
                          {renderBedLabel(d, isWorst)}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className="font-mono text-xs font-semibold tabular-nums text-white/85"
                            title="Horário do registro da pausa no painel"
                          >
                            {formatClockTime(d.status_updated_at)}
                          </span>
                          {showComplete && <CompleteButton dischargeId={d.id} />}
                        </div>
                      </div>

                      {showReason && (
                        <div className="mt-1.5 min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wider text-white/35">
                            Motivo
                          </div>
                          <div className="break-words text-xs leading-snug text-white/90">
                            {d.pause_reason || <span className="text-white/40">—</span>}
                          </div>
                        </div>
                      )}

                      <div
                        className={`mt-2 grid min-w-0 gap-2 ${
                          showServiceOrder
                            ? "grid-cols-[minmax(0,1fr)_minmax(112px,0.85fr)]"
                            : "grid-cols-1"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wider text-white/35">
                            Colaborador
                          </div>
                          <div className="truncate text-xs text-white/80">{name || "—"}</div>
                        </div>
                        {showServiceOrder && (
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wider text-white/35">
                              OS
                            </div>
                            <ServiceOrderEditor discharge={d} compact />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <table className="hidden w-full table-fixed text-sm md:table">
                <thead className="panel-paused-table-head sticky top-0 bg-card text-xs uppercase tracking-widest text-white/70">
                  <tr>
                    <th className="w-[18%] px-2 py-1.5 text-left lg:px-3">Leito / Box</th>
                    <th className="w-[15%] whitespace-nowrap px-2 py-1.5 text-left">
                      Horário da pausa
                    </th>
                    {showReason ? (
                      <th className="w-[25%] px-2 py-1.5 text-left lg:px-3">Motivo</th>
                    ) : (
                      <th className="w-[18%] px-2.5 py-1.5 text-left lg:px-3">Tempo</th>
                    )}
                    {showServiceOrder && (
                      <th className="w-[17%] px-2 py-1.5 text-left lg:px-3">OS</th>
                    )}
                    <th className="px-2.5 py-1.5 text-left lg:px-4">Colaborador</th>
                    {showComplete && <th className="w-9 px-1.5 py-1.5" aria-label="Concluir" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const overtime = elapsedMinutes(d.status_updated_at, nowMs) >= 60;
                    const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
                    const version = flashVersions?.get(d.external_id ?? "") ?? 0;
                    const isWorst = !!(worstId && d.id === worstId);
                    return (
                      <tr
                        key={`${d.id}-desktop-v${version}`}
                        className={`panel-status-row ${version > 0 ? "flash-row" : ""}`}
                        style={{
                          background:
                            overtime && tone === "green" ? "oklch(0.4 0.13 55 / 0.3)" : toneBg[tone],
                        }}
                      >
                        <td className="truncate border-t border-white/5 px-2 py-1.5 text-[13px] font-bold lg:px-4 lg:text-base">
                          {renderBedLabel(d, isWorst)}
                        </td>
                        <td
                          className="whitespace-nowrap border-t border-white/5 px-2 py-1.5 font-mono text-xs font-semibold tabular-nums text-white/85 lg:text-xs"
                          title="Horário do registro da pausa no painel"
                        >
                          {formatClockTime(d.status_updated_at)}
                        </td>
                        {showReason ? (
                          <td className="border-t border-white/5 px-2.5 py-1.5 text-xs text-white/90 lg:px-3 lg:text-xs">
                            <div className="line-clamp-2 break-words">
                              {d.pause_reason || <span className="text-white/40">—</span>}
                            </div>
                          </td>
                        ) : (
                          <td className="border-t border-white/5 px-2.5 py-1.5 font-mono text-xs tabular-nums lg:px-3 lg:text-sm">
                            {formatElapsed(d.status_updated_at, nowMs)}
                          </td>
                        )}
                        {showServiceOrder && (
                          <td className="border-t border-white/5 px-2 py-1.5 lg:px-3">
                            <ServiceOrderEditor discharge={d} />
                          </td>
                        )}
                        <td className="truncate border-t border-white/5 px-2.5 py-1.5 text-xs lg:px-4 lg:text-xs">
                          {name || "—"}
                        </td>
                        {showComplete && (
                          <td className="border-t border-white/5 px-1.5 py-1.5 text-center">
                            <CompleteButton dischargeId={d.id} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AutoScroll>
        )}
      </div>
    </section>
  );
}

function ServiceOrderEditor({
  discharge,
  compact = false,
}: {
  discharge: Discharge;
  compact?: boolean;
}) {
  const [value, setValue] = useState(discharge.service_order ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(discharge.service_order ?? "");
  }, [discharge.id, discharge.service_order]);

  const save = async () => {
    if (saving) return;
    const next = value.trim();
    const current = (discharge.service_order ?? "").trim();
    if (next === current) return;

    setSaving(true);
    try {
      await updateDischargeServiceOrder({
        data: {
          id: discharge.id,
          service_order: next || null,
        },
      });
    } catch {
      setValue(current);
      toast.error("Não foi possível salvar a OS.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={80}
      value={value}
      disabled={saving}
      aria-label={`OS do ${discharge.bed_number}`}
      placeholder="Adicionar OS"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setValue(discharge.service_order ?? "");
          event.currentTarget.blur();
        }
      }}
      className={`w-full min-w-0 rounded-md border border-white/15 bg-black/15 px-2 font-mono tabular-nums text-white/90 outline-none transition-colors placeholder:text-white/30 focus:border-sky-300/60 focus:bg-sky-300/[0.06] disabled:opacity-50 ${
        compact ? "h-8 text-[12px]" : "h-7 text-xs lg:text-xs"
      }`}
    />
  );
}

function CompleteButton({ dischargeId }: { dischargeId: string }) {
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // "completed_with_issues", não "completed": essa é uma resolução manual
      // (clique do colaborador), não uma confirmação real da Listo de que a
      // higienização terminal aconteceu — então não pode contar como "alta
      // concluída" (ver concluidasHojePorBloco, que exige status === "completed").
      await resolvePausedDischarge({ data: { id: dischargeId } });
      toast.success("Leito marcado como concluído.");
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível concluir o leito.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      title="Marcar leito como concluído (pausa resolvida)"
      aria-label="Marcar leito como concluído com pendências"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-40"
      style={{
        borderColor: "oklch(0.55 0.15 155 / 0.5)",
        color: "oklch(0.72 0.16 150)",
        background: "oklch(0.72 0.16 150 / 0.12)",
      }}
    >
      <CircleCheck className="h-4 w-4" />
    </button>
  );
}

function StaffPanel({
  rows,
  nowMs,
  emExecucaoPorBloco,
  className,
}: {
  rows: Array<{
    staff: Staff;
    kind: StaffActivity;
    start: string | null;
    bed: string | null;
    unit: string | null;
  }>;
  nowMs: number;
  emExecucaoPorBloco: { de: number; b: number; c: number; outros: number };
  className?: string;
}) {
  return (
    <section
      className={`h-[340px] lg:h-full lg:min-h-0 panel-surface rounded-xl border overflow-hidden flex flex-col ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <UsersRound className="w-4 h-4 text-white/60" />
            Colaboradores
          </h2>
          <span className="text-xs text-white/50">{rows.length}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs lg:text-xs">
          <span className="mr-0.5 font-semibold uppercase tracking-wide text-white/35">
            Em execução:
          </span>
          {(
            [
              ["D/E", emExecucaoPorBloco.de],
              ["B", emExecucaoPorBloco.b],
              ["C", emExecucaoPorBloco.c],
              ...(emExecucaoPorBloco.outros > 0
                ? [["Outros", emExecucaoPorBloco.outros] as const]
                : []),
            ] as const
          ).map(([label, value]) => (
            <span
              key={label}
              className="inline-flex items-baseline gap-1 rounded-md border px-1.5 py-px leading-tight"
              style={{
                borderColor: "oklch(0.72 0.17 155 / 0.35)",
                background: "oklch(0.72 0.17 155 / 0.10)",
              }}
            >
              <span className="font-semibold text-white/55">{label}</span>
              <span
                className="font-bold tabular-nums"
                style={{ color: value > 0 ? "oklch(0.72 0.17 155)" : "rgba(255,255,255,0.38)" }}
              >
                {value}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="terminal-panel-content flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Nenhum colaborador.</div>
        ) : (
          <AutoScroll>
            <ul className="p-2 space-y-1.5">
              {rows.map(({ staff, kind, start, bed, unit }) => {
                const target =
                  kind === "em_alta" && start && bed && unit
                    ? hygieneTargetMinutes(bed, unit)
                    : null;
                const elapsedMin = start ? elapsedMinutes(start, nowMs) : 0;
                const pct = target ? Math.min(100, Math.round((elapsedMin / target) * 100)) : null;
                const overTarget = target != null && elapsedMin >= target;
                return (
                  <li
                    key={staff.id}
                    className="tv-staff-row-in flex flex-col gap-1.5 rounded-md px-3 py-2 border"
                    style={{
                      background:
                        kind === "desmontando"
                          ? "oklch(0.68 0.20 300 / 0.13)"
                          : kind === "em_alta"
                            ? "oklch(0.66 0.19 245 / 0.13)"
                            : "oklch(0.65 0.03 255 / 0.10)",
                      borderColor:
                        kind === "desmontando"
                          ? "oklch(0.68 0.2 300 / 0.5)"
                          : kind === "em_alta"
                            ? "oklch(0.63 0.19 245 / 0.5)"
                            : "oklch(0.4 0.02 265 / 0.4)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate text-sm">{staff.name}</div>
                        <div className="text-xs text-white/60 truncate">
                          <StatusPill kind={kind} />
                          {bed ? <span className="ml-1">· {bed}</span> : null}
                        </div>
                      </div>
                      {start && (
                        <div className="flex flex-col items-end ml-2">
                          <span
                            className="font-mono tabular-nums text-xs"
                            style={{
                              color: overTarget ? "oklch(0.62 0.22 25)" : "currentColor",
                            }}
                          >
                            {formatElapsed(start, nowMs)}
                          </span>
                          <span className="font-mono tabular-nums text-xs text-white/40">
                            início {formatClockTime(start)}
                          </span>
                        </div>
                      )}
                    </div>
                    {pct != null && (
                      <div>
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="tv-progress-glow h-full rounded-full transition-[width] duration-700 ease-out"
                            style={{
                              width: `${pct}%`,
                              background: overTarget
                                ? "oklch(0.65 0.2 25)"
                                : "oklch(0.68 0.17 245)",
                            }}
                          />
                        </div>
                        <div className="mt-0.5 text-right text-xs font-mono text-white/35">
                          meta {target}min{overTarget ? " · estourou" : ""}
                        </div>
                      </div>
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
  const label =
    kind === "desmontando" ? "Desmontando" : kind === "em_alta" ? "Em Alta" : "Disponível";
  const color =
    kind === "desmontando"
      ? "oklch(0.8 0.15 300)"
      : kind === "em_alta"
        ? "oklch(0.75 0.15 245)"
        : "oklch(0.7 0.02 265)";
  return (
    <span className="uppercase tracking-widest text-xs font-semibold" style={{ color }}>
      {label}
    </span>
  );
}
