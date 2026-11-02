export async function resolvePausedDischarge() {
  throw new Error("Operational writes are disabled in visual fixtures");
}
export async function updateDischargeServiceOrder() {
  throw new Error("Operational writes are disabled in visual fixtures");
}
export async function getLastCompletedDischarge() {
  const mode = new URLSearchParams(location.search).get("history");
  if (mode === "error") throw new Error("Synthetic history error");
  if (mode === "empty") return null;
  return {
    completedAt: "2026-11-02T12:30:00Z",
    startedAt: "2026-11-02T11:45:00Z",
    staffName: "Colaborador de teste com nome extenso para validar quebra de linha",
    durationMinutes: 45,
    sourceAnswerId: "fixture-only",
  };
}
