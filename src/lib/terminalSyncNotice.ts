/**
 * Apresentação do monitor de sincronização do Terminal.
 * Não altera a classificação de integridade nem a execução do Listo360.
 * Uma tentativa falha com dados recentes merece atenção, mas não deve tomar
 * espaço de operação como uma interrupção persistente.
 */
export type TerminalSyncSnapshot = {
  status: "healthy" | "reconciling" | "degraded" | "stale" | "unavailable";
  checkedAt?: string;
  ageSeconds?: number | null;
  monitorFailures?: number;
  outOfLookback?: number;
  unobserved?: number;
  missingInDatabase?: number;
};

export type TerminalSyncNotice = {
  tone: "healthy" | "warning" | "critical" | "checking";
  label: string;
  detail: string;
  banner: string | null;
};

const CONFIRMATION_DELAY_SECONDS = 180;
const MONITOR_FAILURES_BEFORE_BANNER = 3;

function secondsSinceConfirmed(health: TerminalSyncSnapshot, nowMs: number): number | null {
  const age = health.ageSeconds;
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0) return null;
  const checkedAtMs = health.checkedAt ? Date.parse(health.checkedAt) : NaN;
  const extraSeconds = Number.isFinite(checkedAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, Math.floor((nowMs - checkedAtMs) / 1000))
    : 0;
  return age + extraSeconds;
}

function approximateAge(age: number | null): string {
  if (age === null) return "horário desconhecido";
  if (age < 60) return "menos de 1 min";
  return `${Math.floor(age / 60)} min`;
}

export function describeTerminalSyncNotice(
  health: TerminalSyncSnapshot | null,
  nowMs: number,
): TerminalSyncNotice {
  if (!health) {
    return {
      tone: "checking",
      label: "Verificando sync",
      detail: "Consultando a confirmação real de sincronização.",
      banner: null,
    };
  }

  const age = secondsSinceConfirmed(health, nowMs);
  const duration = approximateAge(age);

  if (health.status === "unavailable") {
    const persistent = (health.monitorFailures ?? 1) >= MONITOR_FAILURES_BEFORE_BANNER;
    return {
      tone: persistent ? "critical" : "warning",
      label: "Monitor indisponível",
      detail: "Não foi possível consultar o monitor; isso não comprova falha do Listo.",
      banner: persistent
        ? "Não foi possível verificar a sincronização nas últimas consultas. Confira as altas diretamente no Listo."
        : null,
    };
  }

  // A comparação de ativos prevalece sobre uma falha pontual do sincronizador:
  // há algo a conferir, independentemente do horário do último sucesso.
  const hasDivergence = health.status === "degraded" ||
    (health.outOfLookback ?? 0) > 0 ||
    (health.unobserved ?? 0) > 0 ||
    (health.missingInDatabase ?? 0) > 0;

  if (hasDivergence) {
    return {
      tone: "critical",
      label: "Conferir registros",
      detail: "Há divergências entre o banco e o último retrato de dados do Listo.",
      banner: "Há divergências entre os registros ativos e a última consulta do Listo. Confira os leitos no sistema de origem.",
    };
  }

  if (health.status === "stale") {
    if (age === null || age > CONFIRMATION_DELAY_SECONDS) {
      return {
        tone: "critical",
        label: "Sync sem confirmação",
        detail: `Último sucesso confirmado: ${duration} atrás.`,
        banner: age === null
          ? "Ainda não foi possível confirmar uma sincronização com o Listo. Confira as altas diretamente na origem."
          : `Sem sincronização confirmada há ${duration}. Os leitos podem estar desatualizados; confira as altas no Listo.`,
      };
    }
    return {
      tone: "warning",
      label: "Oscilação no Listo",
      detail: `Uma tentativa de sincronização falhou, mas houve sucesso há ${duration}.`,
      banner: null,
    };
  }

  return {
    tone: "healthy",
    label: "ao vivo",
    detail: health.status === "reconciling"
      ? "Sincronização confirmada; alguns registros ainda estão em observação."
      : "Sincronização com o Listo confirmada.",
    banner: null,
  };
}
