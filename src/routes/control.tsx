import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalData } from "@/hooks/useHospitalData";
import { useNow } from "@/hooks/useNow";
import {
  DISCHARGE_STATUS_LABELS,
  STAFF_STATUS_LABELS,
  formatElapsed,
  type Discharge,
  type DischargeStatus,
  type Staff,
  type StaffStatus,
} from "@/lib/hospital";
import { toast } from "sonner";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "Controle — Higienização Terminal" },
      { name: "description", content: "Painel do operador: atribuir equipe, atualizar status de leitos e gerenciar pausas." },
    ],
  }),
  component: ControlPage,
});

const DISCHARGE_STATUSES: DischargeStatus[] = [
  "waiting_cleaning",
  "en_route",
  "in_progress",
  "paused",
  "maintenance",
  "completed",
];

const STAFF_STATUSES: StaffStatus[] = [
  "available",
  "assigned",
  "coffee_break",
  "lunch_break",
  "dinner_break",
  "off_duty",
];

function ControlPage() {
  const { discharges, staff, loading } = useHospitalData();
  const now = useNow(30000);

  const active = useMemo(
    () => discharges.filter((d) => d.status !== "completed"),
    [discharges],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Painel de Controle</h1>
            <p className="text-sm text-muted-foreground">Higienização Terminal — Operador</p>
          </div>
          <a
            href="/tv"
            target="_blank"
            rel="noreferrer"
            className="text-sm px-3 py-2 rounded-md border border-border hover:bg-accent"
          >
            Abrir TV ↗
          </a>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 space-y-6">
          <DischargeForm staff={staff} />
        </section>

        <section className="lg:col-span-7 space-y-6">
          <ActiveDischarges
            discharges={active}
            staff={staff}
            nowMs={now}
            loading={loading}
          />
          <StaffPanel staff={staff} nowMs={now} />
        </section>
      </main>
    </div>
  );
}

/* -------------------- Discharge form -------------------- */

function DischargeForm({ staff }: { staff: Staff[] }) {
  const [bed, setBed] = useState("");
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState<DischargeStatus>("waiting_cleaning");
  const [priority, setPriority] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [assigned, setAssigned] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const showReason = status === "paused" || status === "maintenance";

  async function save() {
    if (!bed.trim() || !unit.trim()) {
      toast.error("Informe leito e unidade.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("discharges").insert({
      bed_number: bed.trim(),
      unit: unit.trim(),
      status,
      priority,
      pause_reason: showReason ? pauseReason.trim() || null : null,
      assigned_staff_id: assigned || null,
      status_updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Alta registrada.");
    setBed("");
    setUnit("");
    setStatus("waiting_cleaning");
    setPriority(false);
    setPauseReason("");
    setAssigned("");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-4">Nova / Atualizar Alta</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1">
          <span className="text-xs text-muted-foreground">Leito</span>
          <input
            className="mt-1 w-full h-11 px-3 rounded-md border border-input bg-background"
            value={bed}
            onChange={(e) => setBed(e.target.value)}
            placeholder="ex. 305"
          />
        </label>
        <label className="col-span-1">
          <span className="text-xs text-muted-foreground">Unidade</span>
          <input
            className="mt-1 w-full h-11 px-3 rounded-md border border-input bg-background"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="ex. UTI 3º Andar"
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="text-xs text-muted-foreground">Status</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {DISCHARGE_STATUSES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 h-10 rounded-md border text-sm transition-colors ${
                status === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {DISCHARGE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {showReason && (
        <label className="mt-4 block">
          <span className="text-xs text-muted-foreground">Motivo</span>
          <input
            className="mt-1 w-full h-11 px-3 rounded-md border border-input bg-background"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="Descreva o motivo"
          />
        </label>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-1">
          <span className="text-xs text-muted-foreground">Colaborador</span>
          <select
            className="mt-1 w-full h-11 px-3 rounded-md border border-input bg-background"
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
          >
            <option value="">— Não atribuir —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-1 flex items-end">
          <button
            type="button"
            onClick={() => setPriority((p) => !p)}
            className={`w-full h-11 rounded-md border text-sm font-medium transition-colors ${
              priority
                ? "bg-amber-500 text-black border-amber-500"
                : "border-border hover:bg-accent"
            }`}
          >
            {priority ? "★ Prioridade" : "☆ Marcar prioridade"}
          </button>
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-5 w-full h-12 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar alta"}
      </button>
    </div>
  );
}

/* -------------------- Active discharges list -------------------- */

async function updateDischarge(id: string, patch: Partial<Discharge>) {
  const { error } = await supabase
    .from("discharges")
    .update({ ...patch, status_updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) toast.error("Erro: " + error.message);
}

function ActiveDischarges({
  discharges,
  staff,
  nowMs,
  loading,
}: {
  discharges: Discharge[];
  staff: Staff[];
  nowMs: number;
  loading: boolean;
}) {
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-semibold">Altas Ativas</h2>
        <span className="text-xs text-muted-foreground">{discharges.length} leitos</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : discharges.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma alta ativa.</p>
      ) : (
        <ul className="divide-y divide-border">
          {discharges.map((d) => {
            const staffName = d.assigned_staff_id
              ? staffMap.get(d.assigned_staff_id)?.name
              : null;
            return (
              <li key={d.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {d.priority && <span className="text-amber-500">★</span>}
                    <span className="font-semibold">Leito {d.bed_number}</span>
                    <span className="text-xs text-muted-foreground">· {d.unit}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {DISCHARGE_STATUS_LABELS[d.status]} · há{" "}
                    {formatElapsed(d.status_updated_at, nowMs)}
                    {staffName && <> · {staffName}</>}
                    {d.pause_reason && <> · {d.pause_reason}</>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <QuickBtn
                    onClick={() => updateDischarge(d.id, { status: "paused" })}
                    active={d.status === "paused"}
                    label="Parar"
                  />
                  <QuickBtn
                    onClick={() => updateDischarge(d.id, { status: "in_progress" })}
                    active={d.status === "in_progress"}
                    label="Executar"
                  />
                  <QuickBtn
                    onClick={() => updateDischarge(d.id, { status: "completed" })}
                    label="Concluir"
                  />
                  <QuickBtn
                    onClick={() => updateDischarge(d.id, { priority: !d.priority })}
                    active={d.priority}
                    label={d.priority ? "★" : "☆"}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function QuickBtn({
  onClick,
  active,
  label,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3 rounded-md border text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

/* -------------------- Staff panel -------------------- */

function StaffPanel({ staff, nowMs }: { staff: Staff[]; nowMs: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function setStaffStatus(id: string, status: StaffStatus) {
    setOpenId(null);
    const { error } = await supabase
      .from("staff")
      .update({ status, status_updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error("Erro: " + error.message);
  }

  async function addStaff() {
    if (!newName.trim()) return;
    const { error } = await supabase.from("staff").insert({ name: newName.trim() });
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Colaborador adicionado.");
      setNewName("");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-semibold">Equipe</h2>
        <span className="text-xs text-muted-foreground">{staff.length} colaboradores</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {staff.map((s) => (
          <div key={s.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId((v) => (v === s.id ? null : s.id))}
              className="h-10 px-3 rounded-full border border-border bg-background text-sm hover:bg-accent flex items-center gap-2"
            >
              <StatusDot status={s.status} />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                {STAFF_STATUS_LABELS[s.status]} · {formatElapsed(s.status_updated_at, nowMs)}
              </span>
            </button>
            {openId === s.id && (
              <div className="absolute z-10 mt-1 w-52 rounded-lg border border-border bg-popover shadow-lg p-1">
                {STAFF_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStaffStatus(s.id, st)}
                    className="w-full text-left px-3 h-9 rounded-md text-sm hover:bg-accent flex items-center gap-2"
                  >
                    <StatusDot status={st} />
                    {STAFF_STATUS_LABELS[st]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <input
          className="flex-1 h-10 px-3 rounded-md border border-input bg-background"
          placeholder="Nome do novo colaborador"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          onClick={addStaff}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium"
        >
          + Adicionar
        </button>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: StaffStatus }) {
  const color: Record<StaffStatus, string> = {
    available: "bg-emerald-500",
    assigned: "bg-blue-500",
    coffee_break: "bg-amber-500",
    lunch_break: "bg-orange-500",
    dinner_break: "bg-orange-500",
    off_duty: "bg-neutral-400",
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${color[status]}`} />;
}
