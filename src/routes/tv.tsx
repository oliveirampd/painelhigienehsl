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
      { name: "description", content: "Exibição em tempo real: leitos em limpeza terminal e colaboradores em atividade." },
    ],
  }),
  component: TvPage,
});

// Unidades que NÃO devem aparecer no painel (não são limpeza terminal de leito).
const EXCLUDED_UNITS = new Set(["3D", "3C", "11C", "12C", "5B"]);

function isExcluded(d: Discharge): boolean {
  const u = (d.unit || "").trim().toUpperCase();
  const b = (d.bed_number || "").trim().toUpperCase();
  for (const ex of EXCLUDED_UNITS) {
    if (u === ex || u.includes(ex) || b.startsWith(ex)) return true;
  }
  return false;
}

function TvPage() {
  const { discharges, staff } = useHospitalData();
  const now = useNow(30000);
  const clock = useClock();

  // Apenas leitos em andamento de limpeza terminal (em execução ou a caminho).
  const inFlight = useMemo(
    () =>
      discharges
        .filter(
          (d) =>
            (d.status === "in_progress" || d.status === "en_route") &&
            !isExcluded(d),
        )
        .sort(
          (a, b) =>
            new Date(a.status_updated_at).getTime() -
            new Date(b.status_updated_at).getTime(),
        ),
    [discharges],
  );

  // Colaboradores em atividade = os que aparecem atribuídos em algum leito filtrado.
  const activeStaffIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of inFlight) if (d.assigned_staff_id) s.add(d.assigned_staff_id);
    return s;
  }, [inFlight]);

  const activeStaff = useMemo(
    () => staff.filter((s) => activeStaffIds.has(s.id)),
    [staff, activeStaffIds],
  );

  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const bedByStaff = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of inFlight) if (d.assigned_staff_id) m.set(d.assigned_staff_id, d.bed_number);
    return m;
  }, [inFlight]);

  return (
    <div className="min-h-screen bg-[oklch(0.145_0.02_265)] text-[oklch(0.98_0.005_260)] font-sans">
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">
          Painel de Higienização Terminal — Leitos em Andamento
        </h1>
        <div className="flex items-center gap-6">
          <div className="text-xs uppercase tracking-widest text-white/50">ao vivo</div>
          <div className="text-4xl xl:text-5xl font-mono tabular-nums">{clock}</div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 px-8 py-5">
        <KpiCard label="Leitos em Limpeza" value={inFlight.length} accent="oklch(0.72 0.19 155)" />
        <KpiCard label="Colaboradores em Atividade" value={activeStaff.length} accent="oklch(0.7 0.17 245)" />
      </div>

      <div className="grid grid-cols-12 gap-4 px-8 pb-8">
        <section className="col-span-8">
          <BedsTable rows={inFlight} nowMs={now} staffMap={staffMap} />
        </section>
        <section className="col-span-4">
          <ActiveStaffColumn staff={activeStaff} nowMs={now} bedByStaff={bedByStaff} />
        </section>
      </div>
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

function BedsTable({
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
        <h2 className="text-2xl font-bold">Leitos em Limpeza Terminal</h2>
        <span className="text-sm text-white/50">Ordenados por tempo de execução</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-white/40 text-lg">
          Nenhum leito em limpeza no momento.
        </div>
      ) : (
        <table className="w-full text-lg">
          <thead className="text-xs uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-6 py-3">Leito</th>
              <th className="text-left px-4 py-3">Unidade</th>
              <th className="text-left px-4 py-3">Tempo</th>
              <th className="text-left px-6 py-3">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const mins = elapsedMinutes(d.status_updated_at, nowMs);
              const overtime = mins >= 60;
              const name = d.assigned_staff_id ? staffMap.get(d.assigned_staff_id)?.name : "—";
              return (
                <tr
                  key={d.id}
                  className="border-t border-white/5"
                  style={{
                    background: overtime
                      ? "oklch(0.4 0.13 55 / 0.3)"
                      : "oklch(0.3 0.1 155 / 0.15)",
                  }}
                >
                  <td className="px-6 py-4 font-bold text-2xl">{d.bed_number}</td>
                  <td className="px-4 py-4 text-white/80">{d.unit}</td>
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

function ActiveStaffColumn({
  staff,
  nowMs,
  bedByStaff,
}: {
  staff: Staff[];
  nowMs: number;
  bedByStaff: Map<string, string>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="text-2xl font-bold mb-4">Colaboradores em Atividade</h2>
      {staff.length === 0 ? (
        <p className="text-white/40">Nenhum colaborador em atividade no momento.</p>
      ) : (
        <ul className="space-y-2">
          {staff.map((s) => {
            const bed = bedByStaff.get(s.id);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg px-4 py-3 bg-[oklch(0.3_0.12_245)/0.18] border border-[oklch(0.6_0.15_245)/0.25]"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{s.name}</div>
                  {bed && <div className="text-xs text-white/60">Leito {bed}</div>}
                </div>
                <span className="font-mono tabular-nums text-sm text-white/70">
                  {formatElapsed(s.status_updated_at, nowMs)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
