import { useSyncExternalStore } from "react";
import type { Discharge, Staff } from "../../src/lib/hospital";
const listeners = new Set<() => void>();
const time = Date.now();
const stamp = (minutes: number) => new Date(time - minutes * 60_000).toISOString();
let rows: Discharge[] = [];
const staff = Array.from({ length: 50 }, (_, index) => ({
  id: `staff-${index}`,
  external_id: `listo:user:fixture-${index}`,
  name: `Colaborador de teste ${index}`,
  status: "assigned",
})) as Staff[];
const notify = () => listeners.forEach((listener) => listener());
export function reset(count = 40) {
  rows = Array.from({ length: count }, (_, index) => ({
    id: `fixture-${index}`,
    external_id: `listo:answer:fixture-${index}`,
    bed_number: `Leito ${1000 + index}`,
    unit: "Bloco D 10º Andar",
    status: index % 3 === 0 ? "waiting_cleaning" : index % 3 === 1 ? "en_route" : "in_progress",
    status_updated_at: stamp(20 + index),
    created_at: stamp(45 + index),
    updated_at: stamp(0),
    assigned_staff_id: `staff-${index}`,
    completed_at: null,
    pause_reason: null,
    service_order: null,
  })) as Discharge[];
  notify();
}
reset();
export function update(id: string, patch: Partial<Discharge>) {
  rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
  notify();
}
export function complete(ids: string[]) {
  rows = rows.map((row) =>
    ids.includes(row.id) ? { ...row, status: "completed", completed_at: stamp(0) } : row,
  );
  notify();
}
export function remove(id: string) {
  rows = rows.filter((row) => row.id !== id);
  notify();
}
export function useHospitalData() {
  const discharges = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => rows,
  );
  return { discharges, staff, loading: false, error: null };
}
