import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  UtensilsCrossed,
  BrushCleaning,
  CirclePause,
  UsersRound,
  CircleCheck,
  BadgeCheck,
  Sun,
  Moon,
  Eraser,
  ChevronRight,
  AlertTriangle,
  Activity,
  Eye,
} from "lucide-react";

import { toast } from "sonner";
import { updateDischarge } from "@/lib/hospital.functions";
import { PanelNav } from "@/components/PanelNav";
import { DischargeTimelineModal } from "@/components/DischargeTimelineModal";

import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import {
  elapsedMinutes,
  formatElapsed,
  formatClockTime,
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
      {
        name: "description",
        content:
          "Painel em tempo real: leitos em limpeza terminal, altas paradas, pausadas e colaboradores.",
      },
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

// NOTA: assume que a tabela `staff` tem uma coluna `status_updated_at` (timestamptz),
// igual ao padrão já usado em `discharges.status_updated_at`. Se o nome real da coluna
// for diferente, troca só a referência `s.status_updated_at` abaixo.
const BREAK_STATUSES: StaffStatus[] = ["coffee_break", "lunch_break", "dinner_break"];

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(15000);
  const clock = useClock();
  const [selectedDischarge, setSelectedDischarge] = useState<Discharge | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);

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
        flashVersionRef.current.set(
          d.external_id ?? "",
          (flashVersionRef.current.get(d.external_id ?? "") ?? 0) + 1,
        );
        mudou = true;
      }
    }
    prevStatusRef.current = new Map(discharges.map((d) => [d.external_id ?? "", d.status]));
    if (mudou || isFirstRun) forceFlashRerender((n) => n + 1);
  }, [discharges]);

  // Marco de "limpar recentes" (só localStorage deste navegador/TV, nunca escreve no
  // banco): esconde da faixa de finalizados recentes as conclusões antes desse
  // horário. Não afeta em nada a contagem do turno — essa vem sempre direto do banco
  // (ver concluidasHojePorBloco), então limpar a faixa nunca "some" uma alta contada.
  const [recentClearedAt, setRecentClearedAt] = useState(0);
  useEffect(() => {
    setRecentClearedAt(Number(localStorage.getItem("tv:recentClearedAt") ?? 0));
  }, []);

  // Finalizados recentes: apenas os concluídos nos últimos 30 minutos.
  // A janela é reavaliada a cada atualização de dados / tique do relógio,
  // então leitos antigos saem da faixa automaticamente. Deduplicado por leito
  // (se o mesmo leito tiver mais de um evento de conclusão na janela, só o
  // mais recente aparece — evita repetir o mesmo leito na faixa).
  const recentCompletions = useMemo(() => {
    const cutoff = Math.max(now - 30 * 60 * 1000, recentClearedAt);
    const byBed = new Map<string, Discharge>();
    for (const d of discharges) {
      if (
        !isExcluded(d) &&
        isBed(d) &&
        isTerminal(d) &&
        d.status === "completed" &&
        d.completed_at
      ) {
        const completedAt = new Date(d.completed_at).getTime();
        if (completedAt < cutoff) continue;
        const bed = d.bed_number ?? "";
        const prev = byBed.get(bed);
        if (!prev || new Date(prev.completed_at!).getTime() < completedAt) byBed.set(bed, d);
      }
    }
    return Array.from(byBed.values())
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
      .slice(0, 8)
      .map((d) => ({ bed: d.bed_number ?? "", completedAt: d.completed_at!, id: d.id }));
  }, [discharges, now, recentClearedAt]);

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

  // Leitos Pausados: "Pendente" no Listo (motivo/comentário), só as de hoje
  const completedIssues = useMemo(() => {
    const cutoff = now - ONE_DAY_MS;
    return filtered
      .filter(
        // Só "paused" de verdade (ainda bloqueado). "completed_with_issues" é o
        // status que o botão "concluir" usa pra resolver sem contar como alta de
        // verdade (ver CompleteButton) — some da lista assim que resolvido.
        (d) =>
          isTerminal(d) &&
          d.status === "paused" &&
          new Date(d.status_updated_at).getTime() >= cutoff,
      )
      .sort(
        (a, b) => new Date(b.status_updated_at).getTime() - new Date(a.status_updated_at).getTime(),
      );
  }, [filtered, now]);

  // Desmontagens em andamento
  const activeDesmont = useMemo(
    () => filtered.filter((d) => isDesmont(d) && d.status === "in_progress"),
    [filtered],
  );

  // Colaboradores: derivar atividade por staff
  const staffRows = useMemo(() => {
    const activity = new Map<
      string,
      { kind: StaffActivity; start: string; bed: string; unit: string }
    >();

    for (const d of activeDesmont) {
      if (!d.assigned_staff_id) continue;
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
            case "coffee_break":
              kind = "cafe";
              break;
            case "lunch_break":
              kind = "almoco";
              break;
            case "dinner_break":
              kind = "jantar";
              break;
            case "off_duty":
              kind = "deslogou";
              break;
            default:
              kind = "sem_alta";
          }
        }
        return { staff: s, kind };
      })
      .sort((a, b) => {
        const order = {
          em_alta: 0,
          a_caminho: 0,
          desmontando: 0,
          cafe: 1,
          almoco: 1,
          jantar: 1,
          sem_alta: 2,
          deslogou: 3,
        };
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        const aT = (a.staff as any).status_updated_at ?? "";
        const bT = (b.staff as any).status_updated_at ?? "";
        return new Date(bT).getTime() - new Date(aT).getTime();
      });
  }, [staff, filtered]);

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
    return Array.from(stats.entries())
      .map(([block, value]) => ({ block, ...value }))
      .sort((a, b) => b.count - a.count || b.oldest - a.oldest)[0] ?? null;
  }, [paused, now]);

  const availableStaff = timeAltasRows.filter((r) => r.kind === "sem_alta").length;
  const busyStaff = timeAltasRows.filter((r) =>
    r.kind === "em_alta" || r.kind === "a_caminho" || r.kind === "desmontando",
  ).length;

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
    if (paused.length > 0 && availableStaff === 0) {
      items.push("Nenhum colaborador livre enquanto há altas aguardando");
    } else if (paused.length > availableStaff && availableStaff > 0) {
      items.push(`Fila (${paused.length}) está maior que a equipe livre (${availableStaff})`);
    }
    if (completedIssues.length > 0) {
      items.push(`${completedIssues.length} leito(s) pausado(s) aguardando resolução`);
    }
    if (!items.length) items.push("Sem exceções relevantes neste momento");
    return items.slice(0, 3);
  }, [paused, oldestPausedMin, criticalBlock, queueDelta15, availableStaff, completedIssues.length]);

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

  // Sem um timestamp explícito de entrada na fila + início da execução, created_at
  // não é confiável (a linha é reutilizada por upsert). Até o modelo de dados guardar
  // esse ciclo, não exibimos uma média enganosa.
  const avgToStart = null;

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
  const concluidasHojePorBloco = useMemo(() => {
    const done = discharges.filter(
      (d) =>
        !isExcluded(d) &&
        isBed(d) &&
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

  // 5) Horário noturno (22h-6h, Brasília) — escurece um pouco a tela pra cansar
  // menos a vista/o painel de madrugada.
  const horaBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  const isNoturno = horaBRT >= 22 || horaBRT < 6;

  const [isDark, setIsDark] = useState(true);

  // Só esconde a faixa de finalizados recentes neste navegador — 100% local,
  // nunca mexe no banco. A contagem do turno não usa esse marco, então nunca é
  // afetada por isso (era esse o bug: limpar aqui antes apagava completed_at no
  // banco, e o próximo sync do Listo recriava o registro, contando de novo).
  function limparRecentes() {
    const ts = Date.now();
    setRecentClearedAt(ts);
    localStorage.setItem("tv:recentClearedAt", String(ts));
    toast.success("Recentes limpos.");
  }

  const filtros = [
    !isDark ? "invert(1) hue-rotate(180deg)" : null,
    isNoturno ? "brightness(0.82)" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="dark min-h-screen lg:h-screen w-screen overflow-y-auto lg:overflow-hidden flex flex-col font-sans relative transition-[filter] duration-700 bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)]"
      style={filtros ? { filter: filtros } : undefined}
    >
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, oklch(0.6 0.15 245 / 0.7) 25%, oklch(0.65 0.18 155 / 0.6) 50%, oklch(0.65 0.19 60 / 0.6) 75%, transparent 100%)",
          boxShadow: "0 0 16px 1px oklch(0.6 0.15 245 / 0.35)",
        }}
      />
      <header className="flex-none flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between px-4 lg:px-6 py-2.5 lg:py-2 border-b border-white/15">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base sm:text-lg lg:text-2xl font-bold tracking-tight leading-tight">
            Painel de Higienização Terminal
          </h1>
          <PanelNav />
        </div>
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
          <button
            onClick={() => setExceptionsOnly((v) => !v)}
            title="Mostrar somente exceções na grade principal"
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide transition-colors active:scale-95 ${
              exceptionsOnly
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-white/15 text-white/55 hover:bg-white/10"
            }`}
          >
            <Eye className="h-3 w-3" /> Só exceções
          </button>
          <button
            onClick={limparRecentes}
            title="Esconder a faixa de finalizados recentes (só neste painel — não afeta a contagem do turno)"
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] uppercase tracking-wide text-white/55 transition-colors hover:bg-white/10 active:scale-95"
          >
            <Eraser className="h-3 w-3" /> Recentes
          </button>
          <button
            onClick={() => setIsDark((v) => !v)}
            aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
            className="flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-white/10 active:scale-95"
            title={isDark ? "Tema claro" : "Tema escuro"}
          >
            {isDark ? (
              <Sun className="h-4 w-4 lg:h-5 lg:w-5 text-[oklch(0.85_0.08_80)]" />
            ) : (
              <Moon className="h-4 w-4 lg:h-5 lg:w-5 text-primary" />
            )}
          </button>
          <span className="text-xl lg:text-3xl font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="flex-none px-4 lg:px-6 pt-2.5">
        <div
          className={`grid gap-2 rounded-xl border px-3 py-2.5 lg:grid-cols-[180px_1fr_auto] lg:items-center ${
            operationState === "critical"
              ? "border-red-400/35 bg-red-400/[0.08]"
              : operationState === "attention"
                ? "border-amber-400/30 bg-amber-400/[0.07]"
                : "border-emerald-400/20 bg-emerald-400/[0.045]"
          }`}
        >
          <div className="flex items-center gap-2">
            {operationState === "normal" ? (
              <Activity className="h-4 w-4 text-emerald-300" />
            ) : (
              <AlertTriangle
                className={`h-4 w-4 ${operationState === "critical" ? "text-red-300" : "text-amber-300"}`}
              />
            )}
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/40">Situação da operação</div>
              <div className="text-sm font-bold uppercase">
                {operationState === "critical" ? "Crítica" : operationState === "attention" ? "Atenção" : "Normal"}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
            {operationAttention.map((item) => (
              <span key={item} className="truncate">• {item}</span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[10px] lg:text-xs">
            <span className="text-white/45">
              Fila 15m: <strong className={queueDelta15 > 0 ? "text-amber-200" : "text-white/75"}>
                {queueDelta15 > 0 ? `+${queueDelta15}` : queueDelta15}
              </strong>
            </span>
            <span className="text-white/45">
              Colab. livres: <strong className="text-white/75">{availableStaff}</strong>
            </span>
            <span className="text-white/45">
              Colab. em atividade: <strong className="text-white/75">{busyStaff}</strong>
            </span>
          </div>
        </div>
      </div>

      {recentCompletions.length > 0 && (
        <div className="flex-none w-full flex items-stretch overflow-hidden border-b border-[oklch(0.55_0.14_150_/_0.28)] bg-[oklch(0.17_0.03_150_/_0.6)]">
          <div className="flex-none flex items-center gap-1.5 px-3 lg:px-4 bg-[oklch(0.22_0.05_150_/_0.65)] border-r border-[oklch(0.55_0.14_150_/_0.28)]">
            <CircleCheck className="h-3.5 w-3.5 shrink-0 text-[oklch(0.72_0.16_150)]" />
            <span className="text-[10px] lg:text-[11px] font-semibold uppercase tracking-wide text-[oklch(0.80_0.06_150)] whitespace-nowrap">
              Finalizados recentes
            </span>
          </div>
          <div className="flex-1 overflow-hidden py-1.5">
            {(() => {
              // Preenche a faixa com repetições suficientes do conteúdo real pra
              // nunca deixar espaço em branco enquanto rola (a técnica de loop
              // contínuo exige que uma "volta" já preencha bem mais que a tela).
              // Com poucos leitos, repete só o necessário; com muitos, não repete.
              const MIN_TRACK_ITEMS = 14;
              const reps = Math.max(1, Math.ceil(MIN_TRACK_ITEMS / recentCompletions.length));
              const track = Array.from({ length: reps }, () => recentCompletions).flat();
              const durationS = Math.max(18, track.length * 2.6);
              return (
                <div
                  className="animate-marquee flex items-center gap-6 lg:gap-8 whitespace-nowrap px-6"
                  style={{ animationDuration: `${durationS}s` }}
                >
                  {[...track, ...track].map((c, i) => (
                    <div
                      key={`${c.id}-${i}`}
                      className="flex items-center gap-2 text-[11px] lg:text-xs text-[oklch(0.80_0.06_150)]"
                    >
                      <span className="font-semibold text-white/90">{c.bed}</span>
                      <span className="font-mono tabular-nums text-white/55">
                        {formatClockTime(c.completedAt)}
                      </span>
                      <span className="text-white/30">há {formatElapsed(c.completedAt, now)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

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
          label="Média p/ Iniciar"
          value={avgToStart ?? 0}
          display={avgToStart == null ? "—" : `${avgToStart}m`}
          accent="oklch(0.8 0.16 85)"
        />
        <KpiCard
          label="Média de Execução"
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
          nowMs={now}
          staffMap={staffMap}
          flashVersions={flashVersions}
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
          showComplete
          empty="Nenhum leito pausado hoje."
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
          className={
            paused.length >= 4
              ? "order-1 lg:order-none lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-2"
              : "order-1 lg:order-none lg:col-start-9 lg:col-span-4 lg:row-start-1 lg:row-span-2"
          }
        />
      </div>

      <div className="hidden lg:flex flex-none items-center justify-center gap-5 px-6 py-1.5 border-t border-white/10 text-[11px] text-white/40">
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
          Execução média agora:{" "}
          <span className="text-white/70 font-semibold">{avgExecution == null ? "—" : `${avgExecution}m`}</span>
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
      className="rounded-xl px-3 lg:px-4 py-2 lg:py-2 border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-0.5 lg:gap-0"
      style={{
        background: `linear-gradient(180deg, ${accent.replace(")", " / 0.26)")} 0%, oklch(0.18 0.03 265) 100%)`,
        borderColor: accent.replace(")", " / 0.45)"),
        boxShadow: `inset 0 0 0 1px ${accent.replace(")", " / 0.55)")}, 0 0 24px -8px ${accent.replace(")", " / 0.5)")}`,
      }}
    >
      <div className="text-[9px] lg:text-[11px] uppercase tracking-widest text-white/70 font-medium leading-tight">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <div
          className="text-2xl lg:text-4xl tabular-nums leading-none"
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
  green: "oklch(0.32 0.13 155 / 0.2)",
  amber: "oklch(0.48 0.19 85 / 0.3)",
  red: "oklch(0.4 0.2 20 / 0.28)",
  blue: "oklch(0.37 0.15 230 / 0.24)",
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
function TerminalBedsPanel({
  inFlight,
  enRoute,
  paused,
  nowMs,
  staffMap,
  flashVersions,
  worstId,
  onSelect,
  className,
}: {
  inFlight: Discharge[];
  enRoute: Discharge[];
  paused: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
  flashVersions?: Map<string, number>;
  worstId?: string;
  onSelect?: (discharge: Discharge) => void;
  className?: string;
}) {
  const KIND_ORDER = { parada: 0, caminho: 1, execucao: 2 } as const;
  const KIND_COLOR = {
    parada: "oklch(0.78 0.2 60)", // laranja — padrão já usado pra alta parada
    caminho: "oklch(0.74 0.18 230)", // azul
    execucao: "oklch(0.72 0.17 155)", // verde
  } as const;
  const KIND_LABEL = {
    parada: "Alta Parada",
    caminho: "A Caminho",
    execucao: "Em Execução",
  } as const;
  // Em execução que estourou a meta: vermelho, sem chamar mais atenção que isso
  // (sem piscar, sem selo extra) — só a cor muda e o rótulo vira "Estourado".
  const OVERDUE_COLOR = "oklch(0.68 0.19 25)";

  const cards = [
    ...paused.map((d) => ({ d, kind: "parada" as const })),
    ...enRoute.map((d) => ({ d, kind: "caminho" as const })),
    ...inFlight.map((d) => ({ d, kind: "execucao" as const })),
  ].sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (
      elapsedMinutes(b.d.status_updated_at, nowMs) - elapsedMinutes(a.d.status_updated_at, nowMs)
    );
  });
  const total = cards.length;

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
      className={`h-[520px] lg:h-full rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col lg:min-h-0 ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold flex items-center gap-2">
            <BrushCleaning className="w-4 h-4 text-white/60" />
            Leitos em Higienização
          </h2>
          <span className="text-[11px] text-white/50 shrink-0">{total}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] lg:text-xs font-medium text-white/55">
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
              <span className="h-2 w-2 rounded-full" style={{ background: OVERDUE_COLOR }} />
              Estourado
            </span>
          </div>
          {/* Altas paradas por bloco — sempre visível, mobile incluso. */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] lg:text-[11px] font-semibold uppercase tracking-wide text-white/40 whitespace-nowrap">
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
                className="inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight"
                style={{
                  borderColor: KIND_COLOR.parada.replace(")", " / 0.4)"),
                  background: KIND_COLOR.parada.replace(")", " / 0.12)"),
                }}
              >
                <span className="font-semibold uppercase tracking-wide text-white/60">
                  Bloco {label}
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
      <div className="flex-1 min-h-0 overflow-hidden">
        {cards.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">Nenhum leito em higienização.</div>
        ) : (
          <AutoScroll>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-3">
              {cards.map(({ d, kind }) => {
                const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : null;
                const version = flashVersions?.get(d.external_id ?? "") ?? 0;
                const isWorst = worstId && d.id === worstId;
                const minutes = elapsedMinutes(d.status_updated_at, nowMs);
                const overtime = kind === "execucao" && minutes >= 60;
                const base = overtime ? OVERDUE_COLOR : KIND_COLOR[kind];
                return (
                  <div
                    key={`${d.id}-v${version}`}
                    onClick={() => onSelect?.(d)}
                    role={onSelect ? "button" : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (onSelect && (e.key === "Enter" || e.key === " ")) onSelect(d);
                    }}
                    className={`relative flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 ${
                      onSelect ? "cursor-pointer hover:-translate-y-0.5 hover:bg-white/[0.05]" : ""
                    } ${version > 0 ? "flash-row" : ""}`}
                    style={{
                      borderColor: base.replace(")", " / 0.45)"),
                      background: base.replace(")", " / 0.14)"),
                    }}
                  >
                    {isWorst && (
                      <span
                        className="absolute -top-1.5 -right-1.5 rounded-[3px] border px-1 py-px text-[8px] font-semibold uppercase tracking-wide"
                        style={{
                          borderColor: "oklch(0.7 0.2 25 / 0.5)",
                          background: "oklch(0.22 0.02 265)",
                          color: "oklch(0.78 0.19 25)",
                        }}
                      >
                        crítico
                      </span>
                    )}
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-bold text-base lg:text-xl tabular-nums truncate">
                        {d.bed_number}
                      </span>
                      {kind !== "parada" && (
                        <span className="font-mono tabular-nums text-sm shrink-0 text-white/80">
                          {formatElapsed(d.status_updated_at, nowMs)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center py-1 text-center min-h-[48px]">
                      {kind === "parada" ? (
                        <>
                          <span className="text-[10px] lg:text-xs font-semibold uppercase tracking-widest text-white/55">
                            Parada há
                          </span>
                          <span
                            className="font-mono tabular-nums text-xl lg:text-2xl font-bold leading-none mt-1"
                            style={{ color: base }}
                          >
                            {formatElapsed(d.status_updated_at, nowMs)}
                          </span>
                          <span className="mt-1 text-[10px] lg:text-[11px] text-white/55 leading-tight line-clamp-1">
                            {d.unit || "Unidade não informada"}
                          </span>
                        </>
                      ) : (
                        <span
                          className="text-[13px] lg:text-[15px] font-bold leading-tight line-clamp-2"
                          style={{ color: name ? base : "rgba(255,255,255,0.4)" }}
                        >
                          {name ?? "sem colaborador"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide"
                        style={{ color: base, background: base.replace(")", " / 0.18)") }}
                      >
                        {overtime ? "Estourado" : KIND_LABEL[kind]}
                      </span>
                      {kind === "parada" && (
                        <span className="font-mono tabular-nums text-[10px] text-white/50 shrink-0">
                          detectada {formatClockTime(d.status_updated_at)}
                        </span>
                      )}
                    </div>
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
  showComplete,
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
  showComplete?: boolean;
  empty: string;
  flashVersions?: Map<string, number>;
  className?: string;
  worstId?: string;
  caption?: string;
}) {
  return (
    <section
      className={`h-[300px] lg:h-full rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col lg:min-h-0 ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        {caption && (
          <div className="hidden lg:block text-[10px] text-white/30 mt-0.5">{caption}</div>
        )}
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
                  {showComplete && <th className="w-8 px-1.5 py-1.5" aria-label="Concluir" />}
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
                        background:
                          overtime && tone === "green" ? "oklch(0.4 0.13 55 / 0.3)" : toneBg[tone],
                      }}
                    >
                      <td className="px-1.5 lg:px-4 py-1.5 font-bold text-[13px] lg:text-base border-t border-white/5 truncate">
                        <span className="inline-flex items-center gap-1.5">
                          {d.bed_number}
                          {isWorst && (
                            <span
                              title="Andar crítico"
                              className="shrink-0 rounded-[3px] border px-1 py-px text-[8px] lg:text-[9px] font-semibold uppercase tracking-wide"
                              style={{
                                borderColor: "oklch(0.7 0.2 25 / 0.5)",
                                color: "oklch(0.78 0.19 25)",
                              }}
                            >
                              andar crítico
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell px-3 py-1.5 text-white/80 text-xs border-t border-white/5">
                        {d.unit}
                      </td>
                      {showReason ? (
                        <td className="px-2.5 lg:px-3 py-1.5 text-white/90 text-[11px] lg:text-xs border-t border-white/5">
                          {d.pause_reason || <span className="text-white/40">—</span>}
                        </td>
                      ) : (
                        <td className="px-2.5 lg:px-3 py-1.5 font-mono tabular-nums text-xs lg:text-sm border-t border-white/5">
                          {formatElapsed(d.status_updated_at, nowMs)}
                        </td>
                      )}
                      <td className="px-2.5 lg:px-4 py-1.5 text-[11px] lg:text-xs border-t border-white/5 truncate">
                        {name || "—"}
                      </td>
                      {showComplete && (
                        <td className="px-1.5 py-1.5 border-t border-white/5 text-center">
                          <CompleteButton dischargeId={d.id} />
                        </td>
                      )}
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
      await updateDischarge({
        data: { id: dischargeId, patch: { status: "completed_with_issues", pause_reason: null } },
      });
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
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors disabled:opacity-40"
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
  className?: string;
}) {
  return (
    <section
      className={`h-[340px] lg:h-full lg:min-h-0 rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <UsersRound className="w-4 h-4 text-white/60" />
            Colaboradores
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        <div className="text-[10px] text-white/35 mt-0.5">
          Desmontagem e higienização terminal (Listo)
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
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
                    className="flex flex-col gap-1.5 rounded-md px-3 py-2 border"
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
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate text-sm">{staff.name}</div>
                        <div className="text-[11px] text-white/60 truncate">
                          <StatusPill kind={kind} />
                          {bed ? <span className="ml-1">· {bed}</span> : null}
                        </div>
                      </div>
                      {start && (
                        <div className="flex flex-col items-end ml-2">
                          <span
                            className="font-mono tabular-nums text-xs"
                            style={{
                              color: overTarget ? "oklch(0.75 0.19 25)" : "rgba(255,255,255,0.7)",
                            }}
                          >
                            {formatElapsed(start, nowMs)}
                          </span>
                          <span className="font-mono tabular-nums text-[10px] text-white/40">
                            início {formatClockTime(start)}
                          </span>
                        </div>
                      )}
                    </div>
                    {pct != null && (
                      <div>
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width]"
                            style={{
                              width: `${pct}%`,
                              background: overTarget
                                ? "oklch(0.65 0.2 25)"
                                : "oklch(0.68 0.17 245)",
                            }}
                          />
                        </div>
                        <div className="mt-0.5 text-right text-[9px] font-mono text-white/35">
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

// Café / Almoço / Janta — direto de staff.status, com alerta quando passa do limite (hospital.ts)
type TimeAltasKind =
  "cafe" | "almoco" | "jantar" | "deslogou" | "em_alta" | "a_caminho" | "desmontando" | "sem_alta";

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
  cafe: {
    bg: "oklch(0.42 0.18 55 / 0.35)",
    border: "oklch(0.72 0.21 55 / 0.55)",
    text: "oklch(0.82 0.21 55)",
  },
  almoco: {
    bg: "oklch(0.42 0.18 55 / 0.35)",
    border: "oklch(0.72 0.21 55 / 0.55)",
    text: "oklch(0.82 0.21 55)",
  },
  jantar: {
    bg: "oklch(0.42 0.18 55 / 0.35)",
    border: "oklch(0.72 0.21 55 / 0.55)",
    text: "oklch(0.82 0.21 55)",
  },
  em_alta: {
    bg: "oklch(0.37 0.15 230 / 0.32)",
    border: "oklch(0.63 0.19 230 / 0.55)",
    text: "oklch(0.78 0.19 230)",
  },
  a_caminho: {
    bg: "oklch(0.37 0.14 230 / 0.22)",
    border: "oklch(0.63 0.17 230 / 0.4)",
    text: "oklch(0.78 0.17 230)",
  },
  desmontando: {
    bg: "oklch(0.37 0.16 300 / 0.32)",
    border: "oklch(0.66 0.2 300 / 0.55)",
    text: "oklch(0.8 0.2 300)",
  },
  sem_alta: {
    bg: "oklch(0.37 0.17 25 / 0.32)",
    border: "oklch(0.63 0.21 25 / 0.55)",
    text: "oklch(0.78 0.21 25)",
  },
  deslogou: {
    bg: "oklch(0.22 0.005 0 / 0.4)",
    border: "oklch(0.32 0.005 0 / 0.5)",
    text: "rgba(255,255,255,0.35)",
  },
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
    <section
      className={`h-[280px] lg:h-full lg:min-h-0 rounded-xl border border-white/15 bg-white/[0.035] overflow-hidden flex flex-col ${className ?? ""}`}
    >
      <div className="flex-none px-4 py-2 border-b border-white/10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-white/60" />
            Time Altas
          </h2>
          <span className="text-[11px] text-white/50">{rows.length}</span>
        </div>
        <div className="text-[10px] text-white/35 mt-0.5">
          Login e pausas do time de campo (healthcon)
        </div>
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
  const label =
    kind === "desmontando" ? "Desmontando" : kind === "em_alta" ? "Em Alta" : "Disponível";
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
