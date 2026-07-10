import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import {
  DISCHARGE_STATUS_LABELS,
  elapsedMinutes,
  formatElapsed,
  isBreakOverLimit,
  type Discharge,
  type Staff,
  type StaffStatus,
} from "@/lib/hospital";

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "TV — Painel de Higienização Terminal" },
      { name: "description", content: "Exibição em tempo real para monitor: altas paradas, equipe em pausa e leitos em manutenção." },
    ],
  }),
  component: TvPage,
});

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(30000);
  const clock = useClock();

  const paused = useMemo(
    () =>
      discharges
        .filter((d) => d.status === "paused")
        .sort(
          (a, b) =>
            new Date(a.status_updated_at).getTime() -
            new Date(b.status_updated_at).getTime(),
        ),
    [discharges],
  );
  const inFlight = useMemo(
    () => discharges.filter((d) => d.status === "in_progress" || d.status === "en_route"),
    [discharges],
  );
  const maintenance = useMemo(
    () => discharges.filter((d) => d.status === "maintenance"),
    [discharges],
  );
  const priorityCount = discharges.filter(
    (d) => d.priority && d.status !== "completed",
  ).length;
  const onBreak = staff.filter((s) =>
    s.status === "coffee_break" || s.status === "lunch_break" || s.status === "dinner_break",
  ).length;

  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  return (
    <div className="min-h-screen bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)] font-sans">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">
          Painel de Controle de Altas — Higienização Terminal
        </h1>
        <div className="flex items-center gap-6">
          <div className="text-xs uppercase tracking-widest text-white/50">
            Atualizado {formatElapsed(new Date(now).toISOString(), now + 1000)} atrás · ao vivo
          </div>
          <div className="text-4xl xl:text-5xl font-mono tabular-nums">{clock}</div>
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 px-8 py-5">
        <KpiCard
          label="Altas Paradas"
          value={paused.length}
          accent="oklch(0.65 0.24 25)"
        />
        <KpiCard
          label="Altas Prioridade"
          value={priorityCount}
          accent="oklch(0.72 0.18 305)"
        />
        <KpiCard
          label="Colaboradores em Pausa"
          value={onBreak}
          accent="oklch(0.78 0.16 75)"
        />
        <KpiCard
          label="Em Execução"
          value={inFlight.length}
          accent="oklch(0.72 0.19 155)"
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-4 px-8 pb-4">
        <section className="col-span-8 flex flex-col gap-4">
          <PausedTable rows={paused} nowMs={now} staffMap={staffMap} />
          <InFlightList rows={inFlight} nowMs={now} />
        </section>
        <section className="col-span-4">
          <StaffColumn staff={staff} nowMs={now} discharges={discharges} />
        </section>
      </div>

      {/* Bottom maintenance strip */}
      <MaintenanceStrip rows={maintenance} nowMs={now} />
    </div>
  );
}

function useClock() {
  const [t, setT] = useState<string>("");
  useEffect(() => { setT(new Date().toLocaleTimeString("pt-BR")); }, []);
  useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString("pt-BR")), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div
      className="rounded-2xl p-5 border border-white/10"
      style={{
        background: `linear-gradient(180deg, ${accent.replace(")", " / 0.14)")} 0%, oklch(0.19 0.03 265) 100%)`,
        boxShadow: `inset 0 0 0 1px ${accent.replace(")", " / 0.35)")}`,
      }}
    >
      <div className="text-sm uppercase tracking-widest text-white/60">{label}</div>
      <div className="mt-2 text-6xl font-bold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

/* -------------------- Paused table -------------------- */

function pausedRowColors(minutes: number): { bg: string; pulse: boolean } {
  if (minutes >= 30) return { bg: "oklch(0.35 0.12 25 / 0.45)", pulse: true };
  if (minutes >= 15) return { bg: "oklch(0.42 0.13 75 / 0.35)", pulse: false };
  return { bg: "oklch(0.35 0.1 155 / 0.28)", pulse: false };
}

function PausedTable({
  rows,
  nowMs,
  staffMap,
}: {
  rows: Discharge[];
  nowMs: number;
  staffMap: Map<string, Staff>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-baseline justify-between">
        <h2 className="text-2xl font-bold">Altas Paradas</h2>
        <span className="text-sm text-white/50">Ordenadas por tempo parado</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-white/40 text-lg">
          Nenhuma alta parada no momento.
        </div>
      ) : (
        <table className="w-full text-lg">
          <thead className="text-xs uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-6 py-3">Leito</th>
              <th className="text-left px-4 py-3">Unidade</th>
              <th className="text-left px-4 py-3">Prio</th>
              <th className="text-left px-4 py-3">Motivo</th>
              <th className="text-left px-4 py-3">Tempo Parada</th>
              <th className="text-left px-6 py-3">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const mins = elapsedMinutes(d.status_updated_at, nowMs);
              const { bg, pulse } = pausedRowColors(mins);
              const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
              return (
                <tr
                  key={d.id}
                  className={`border-t border-white/5 ${pulse ? "pulse-critical" : ""}`}
                  style={{ background: bg }}
                >
                  <td className="px-6 py-4 font-bold text-2xl">{d.bed_number}</td>
                  <td className="px-4 py-4">{d.unit}</td>
                  <td className="px-4 py-4">
                    {d.priority ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[oklch(0.72_0.18_305)/0.25] text-[oklch(0.85_0.15_305)] font-semibold">
                        ★ Prioridade
                      </span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-white/80">{d.pause_reason || "—"}</td>
                  <td className="px-4 py-4 font-mono tabular-nums font-semibold">
                    {formatElapsed(d.status_updated_at, nowMs)}
                  </td>
                  <td className="px-6 py-4">{name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InFlightList({ rows, nowMs }: { rows: Discharge[]; nowMs: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-lg font-semibold mb-3 text-white/80">Em Execução / A Caminho</h3>
      {rows.length === 0 ? (
        <p className="text-white/40">Nenhuma limpeza em andamento.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {rows.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-lg px-4 py-3 bg-[oklch(0.3_0.1_155)/0.2] border border-[oklch(0.6_0.15_155)/0.3]"
            >
              <div>
                <span className="font-bold text-xl">Leito {d.bed_number}</span>
                <span className="ml-2 text-sm text-white/60">
                  {DISCHARGE_STATUS_LABELS[d.status]}
                </span>
              </div>
              <span className="font-mono tabular-nums text-white/80">
                {formatElapsed(d.status_updated_at, nowMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------- Staff column -------------------- */

const STAFF_GROUPS: Array<{
  label: string;
  statuses: StaffStatus[];
  accent: string;
}> = [
  { label: "Disponível", statuses: ["available"], accent: "oklch(0.72 0.19 155)" },
  { label: "Em Atividade", statuses: ["assigned"], accent: "oklch(0.7 0.17 245)" },
  { label: "Café", statuses: ["coffee_break"], accent: "oklch(0.78 0.16 75)" },
  { label: "Almoço", statuses: ["lunch_break"], accent: "oklch(0.72 0.16 55)" },
  { label: "Jantar", statuses: ["dinner_break"], accent: "oklch(0.72 0.16 55)" },
  { label: "Fora de Turno", statuses: ["off_duty"], accent: "oklch(0.6 0.02 260)" },
];

function StaffColumn({
  staff,
  nowMs,
  discharges,
}: {
  staff: Staff[];
  nowMs: number;
  discharges: Discharge[];
}) {
  const assignedBeds = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of discharges) {
      if (d.assigned_staff_id && d.status !== "completed") {
        m.set(d.assigned_staff_id, d.bed_number);
      }
    }
    return m;
  }, [discharges]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="text-2xl font-bold mb-4">Equipe</h2>
      <div className="space-y-5">
        {STAFF_GROUPS.map((g) => {
          const members = staff.filter((s) => g.statuses.includes(s.status));
          return (
            <div key={g.label}>
              <div
                className="flex items-center gap-2 mb-2 text-sm uppercase tracking-widest"
                style={{ color: g.accent }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: g.accent }} />
                {g.label}
                <span className="text-white/40">· {members.length}</span>
              </div>
              {members.length === 0 ? (
                <p className="text-white/30 text-sm ml-4">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {members.map((s) => {
                    const mins = elapsedMinutes(s.status_updated_at, nowMs);
                    const alert = isBreakOverLimit(s.status, mins);
                    const bed = assignedBeds.get(s.id);
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between rounded-lg px-3 py-2"
                        style={{
                          background: alert
                            ? "oklch(0.4 0.15 25 / 0.35)"
                            : "oklch(1 0 0 / 0.03)",
                          border: alert
                            ? "1px solid oklch(0.7 0.2 25 / 0.6)"
                            : "1px solid transparent",
                        }}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {alert && <span className="mr-1">⚠</span>}
                            {s.name}
                          </div>
                          {bed && s.status === "assigned" && (
                            <div className="text-xs text-white/50">Leito {bed}</div>
                          )}
                        </div>
                        <span
                          className="font-mono tabular-nums text-sm"
                          style={{ color: alert ? "oklch(0.85 0.18 25)" : "oklch(0.7 0.02 260)" }}
                        >
                          {formatElapsed(s.status_updated_at, nowMs)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------- Maintenance strip -------------------- */

function MaintenanceStrip({ rows, nowMs }: { rows: Discharge[]; nowMs: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="mx-8 mb-6 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3">
      <div className="flex items-center gap-3 overflow-x-auto">
        <span className="text-xs uppercase tracking-widest text-white/50 shrink-0">
          Em Manutenção
        </span>
        {rows.map((d) => (
          <div
            key={d.id}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
          >
            <span className="font-bold">Leito {d.bed_number}</span>
            <span className="text-white/50">·</span>
            <span className="text-white/70">{d.pause_reason || "sem motivo"}</span>
            <span className="text-white/50">·</span>
            <span className="font-mono tabular-nums text-white/60">
              {formatElapsed(d.status_updated_at, nowMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
