import type { Database } from "@/integrations/supabase/types";

export type Discharge = Database["public"]["Tables"]["discharges"]["Row"];
export type Staff = Database["public"]["Tables"]["staff"]["Row"];
export type DischargeStatus = Database["public"]["Enums"]["discharge_status"];
export type StaffStatus = Database["public"]["Enums"]["staff_status"];

// Alert thresholds (minutes) - easy to tweak
export const BREAK_LIMITS = {
  coffee_break: 20,
  lunch_break: 60,
  dinner_break: 60,
} as const;

export const DISCHARGE_STATUS_LABELS: Record<DischargeStatus, string> = {
  waiting_cleaning: "Aguardando",
  en_route: "A Caminho",
  in_progress: "Em Execução",
  paused: "Parada",
  maintenance: "Manutenção",
  completed: "Concluída",
  completed_with_issues: "Concluída com Pendências",
};

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  available: "Disponível",
  assigned: "Em Atividade",
  coffee_break: "Café",
  lunch_break: "Almoço",
  dinner_break: "Jantar",
  off_duty: "Fora de Turno",
};

export function elapsedMinutes(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
}

export function formatElapsed(iso: string, nowMs: number): string {
  const totalMin = elapsedMinutes(iso, nowMs);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function isBreakOverLimit(status: StaffStatus, minutes: number): boolean {
  const limit = (BREAK_LIMITS as Record<string, number>)[status];
  return limit !== undefined && minutes >= limit;
}
