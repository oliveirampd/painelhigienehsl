import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import {
  elapsedMinutes,
  formatElapsed,
  type Discharge,
  type Staff,
} from "@/lib/hospital";

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "TV — Painel de Higienização Terminal" },
      { name: "description", content: "Exibição em tempo real: leitos em limpeza terminal, altas paradas e altas concluídas com pendências." },
    ],
  }),
  component: TvPage,
});

// Unidades excluídas do painel.
const EXCLUDED_UNITS = ["3D", "3C", "11C", "12C", "5B"];

function isExcluded(d: Discharge): boolean {
  const u = (d.unit || "").toUpperCase();
  const b = (d.bed_number || "").toUpperCase();
  return EXCLUDED_UNITS.some((ex) => u.includes(ex) || b.includes(` ${ex}`));
}

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(30000);
  const clock = useClock();

  const filtered = useMemo(
    () => discharges.filter((d) => !isExcluded(d)),
    [discharges],
  );

  // Leitos em execução (in_progress ou a caminho)
  const inFlight = useMemo(
    () =>
      filtered
        .filter((d) => d.status === "in_progress" || d.status === "en_route")
        .sort(
          (a, b) =>
            new Date(b.status_updated_at).getTime() -
            new Date(a.status_updated_at).getTime(),
        ),
    [filtered],
  );

  // Altas paradas (rotinas pendentes / paused)
  const paused = useMemo(
    () =>
      filtered
        .filter((d) => d.status === "paused" || d.status === "waiting_cleaning")
        .sort(
          (a, b) =>
            new Date(b.status_updated_at).getTime() -
            new Date(a.status_updated_at).getTime(),
        ),
    [filtered],
  );

  // Altas concluídas com pendências
  const completedIssues = useMemo(
    () =>
      filtered
        .filter((d) => d.status === "completed_with_issues")
        .sort(
          (a, b) =>
            new Date(b.status_updated_at).getTime() -
            new Date(a.status_updated_at).getTime(),
        ),
    [filtered],
  );

  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  // Colaboradores em atividade: apenas quem tem leito em execução.
  // Ordenados pelo início mais recente.
  const activeStaff = useMemo(() => {
    const startByStaff = new Map<string, { start: string; bed: string }>();
    for (const d of inFlight) {
      if (!d.assigned_staff_id) continue;
      const prev = startByStaff.get(d.assigned_staff_id);
      if (!prev || new Date(d.status_updated_at) > new Date(prev.start)) {
        startByStaff.set(d.assigned_staff_id, {
          start: d.status_updated_at,
          bed: d.bed_number,
        });
      }
    }
    return Array.from(startByStaff.entries())
      .map(([id, info]) => ({ staff: staffMap.get(id), ...info }))
      .filter((x): x is { staff: Staff; start: string; bed: string } => !!x.staff)
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [inFlight, staffMap]);

  return (
    <div className="min-h-screen bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)] font-sans">
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">
          Painel de Higienização Terminal
        </h1>
        <div className="flex items-center gap-6">
          <div className="text-xs uppercase tracking-widest text-white/50">ao vivo</div>
          <div className="text-4xl xl:text-5xl font-mono tabular-nums">{clock}</div>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-4 px-8 py-5">
        <KpiCard label="Em Limpeza" value={inFlight.length} accent="oklch(0.72 0.19 155)" />
        <KpiCard label="Altas Paradas" value={paused.length} accent="oklch(0.75 0.17 60)" />
        <KpiCard label="Concluídas c/ Pendência" value={completedIssues.length} accent="oklch(0.7 0.2 25)" />
        <KpiCard label="Colaboradores Ativos" value={activeStaff.length} accent="oklch(0.7 0.17 245)" />
      </div>

      <div className="grid grid-cols-12 gap-4 px-8 pb-8">
        <section className="col-span-8 space-y-4">
          <BedsTable rows={inFlight} nowMs={now} staffMap={staffMap} />
          <PausedTable rows={paused} nowMs={now} staffMap={staffMap} />
          <CompletedIssuesTable rows={completedIssues} nowMs={now} staffMap={staffMap} />
        </section>
        <section className="col-span-4">
          <ActiveStaffColumn rows={activeStaff} nowMs={now} />
        </section>
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
      className="rounded-2xl p-5 border border-white/10"
      style={{
        background: `linear-gradient(180deg, ${accent.replace(")", " / 0.14)")} 0%, oklch(0.19 0.03 265) 100%)`,
        boxShadow: `inset 0 0 0 1px ${accent.replace(")", " / 0.35)")}`,
      }}
    >
      <div className="text-xs uppercase tracking-widest text-white/60">{label}</div>
      <div className="mt-2 text-5xl font-bold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-6 py-3 border-b border-white/10 flex items-baseline justify-between">
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle && <span className="text-xs text-white/50">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function BedsTable({ rows, nowMs, staffMap }: { rows: Discharge[]; nowMs: number; staffMap: Map<string, Staff> }) {
  return (
    <SectionCard title="Leitos em Limpeza Terminal" subtitle="Mais recentes primeiro">
      {rows.length === 0 ? (
        <div className="p-6 text-center text-white/40">Nenhum leito em limpeza.</div>
      ) : (
        <table className="w-full text-base">
          <thead className="text-xs uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-6 py-2">Leito</th>
              <th className="text-left px-4 py-2">Unidade</th>
              <th className="text-left px-4 py-2">Tempo</th>
              <th className="text-left px-6 py-2">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const overtime = elapsedMinutes(d.status_updated_at, nowMs) >= 60;
              const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
              return (
                <tr
                  key={d.id}
                  className="border-t border-white/5"
                  style={{ background: overtime ? "oklch(0.4 0.13 55 / 0.3)" : "oklch(0.3 0.1 155 / 0.12)" }}
                >
                  <td className="px-6 py-3 font-bold text-xl">{d.bed_number}</td>
                  <td className="px-4 py-3 text-white/80">{d.unit}</td>
                  <td className="px-4 py-3 font-mono tabular-nums font-semibold">
                    {formatElapsed(d.status_updated_at, nowMs)}
                  </td>
                  <td className="px-6 py-3">{name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function PausedTable({ rows, nowMs, staffMap }: { rows: Discharge[]; nowMs: number; staffMap: Map<string, Staff> }) {
  return (
    <SectionCard title="Altas Paradas (Rotinas Pendentes)" subtitle={`${rows.length} leitos`}>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-white/40">Nenhuma alta parada no momento.</div>
      ) : (
        <table className="w-full text-base">
          <thead className="text-xs uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-6 py-2">Leito</th>
              <th className="text-left px-4 py-2">Unidade</th>
              <th className="text-left px-4 py-2">Motivo</th>
              <th className="text-left px-6 py-2">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
              return (
                <tr key={d.id} className="border-t border-white/5" style={{ background: "oklch(0.45 0.15 60 / 0.18)" }}>
                  <td className="px-6 py-3 font-bold text-xl">{d.bed_number}</td>
                  <td className="px-4 py-3 text-white/80">{d.unit}</td>
                  <td className="px-4 py-3 text-white/90">{d.pause_reason || <span className="text-white/40">—</span>}</td>
                  <td className="px-6 py-3">{name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function CompletedIssuesTable({ rows, nowMs, staffMap }: { rows: Discharge[]; nowMs: number; staffMap: Map<string, Staff> }) {
  void nowMs;
  return (
    <SectionCard title="Altas Concluídas com Pendências" subtitle={`${rows.length} leitos`}>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-white/40">Nenhuma alta concluída com pendência.</div>
      ) : (
        <table className="w-full text-base">
          <thead className="text-xs uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-6 py-2">Leito</th>
              <th className="text-left px-4 py-2">Unidade</th>
              <th className="text-left px-4 py-2">Pendência</th>
              <th className="text-left px-6 py-2">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
              return (
                <tr key={d.id} className="border-t border-white/5" style={{ background: "oklch(0.4 0.15 25 / 0.18)" }}>
                  <td className="px-6 py-3 font-bold text-xl">{d.bed_number}</td>
                  <td className="px-4 py-3 text-white/80">{d.unit}</td>
                  <td className="px-4 py-3 text-white/90">{d.pause_reason || <span className="text-white/40">—</span>}</td>
                  <td className="px-6 py-3">{name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function ActiveStaffColumn({
  rows,
  nowMs,
}: {
  rows: Array<{ staff: Staff; start: string; bed: string }>;
  nowMs: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="text-xl font-bold mb-4">Colaboradores em Atividade</h2>
      {rows.length === 0 ? (
        <p className="text-white/40">Nenhum colaborador em atividade.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ staff, start, bed }) => (
            <li
              key={staff.id}
              className="flex items-center justify-between rounded-lg px-4 py-3 bg-[oklch(0.3_0.12_245)/0.18] border border-[oklch(0.6_0.15_245)/0.25]"
            >
              <div className="min-w-0">
                <div className="font-semibold truncate">{staff.name}</div>
                <div className="text-xs text-white/60">{bed}</div>
              </div>
              <span className="font-mono tabular-nums text-sm text-white/70">
                {formatElapsed(start, nowMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
