import type { Discharge } from "./hospital";

/**
 * Timeouts de exibição exclusivos do Terminal.
 *
 * Uma atividade esquecida deixa de constar como ATIVA após o limite,
 * mas nunca é convertida em "completed": sem confirmação no Listo,
 * não houve conclusão comprovada para indicadores de produtividade.
 *
 * Este filtro é calculado por status_updated_at do próprio registro;
 * não grava no banco nem cria bloqueio persistente por número de leito.
 * Um novo ciclo do Listo, com novo horário de início, aparece normalmente.
 */
export const TERMINAL_DISMANTLE_TIMEOUT_MS = 35 * 60 * 1000;
export const TERMINAL_HYGIENE_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function isTerminalActivityTimedOut(
  discharge: Pick<Discharge, "external_id" | "status" | "status_updated_at">,
  nowMs: number,
): boolean {
  if (discharge.status !== "in_progress") return false;

  const source = discharge.external_id ?? "";
  const limitMs = source.startsWith("listo:desmont:")
    ? TERMINAL_DISMANTLE_TIMEOUT_MS
    : source.startsWith("listo:answer:") || source.startsWith("listo:box:")
      ? TERMINAL_HYGIENE_TIMEOUT_MS
      : null;

  if (limitMs === null) return false;
  const startedMs = Date.parse(discharge.status_updated_at);

  // Data inválida não autoriza inventar uma conclusão ou estado novo.
  return Number.isFinite(startedMs) &&
    Number.isFinite(nowMs) &&
    nowMs >= startedMs + limitMs;
}
