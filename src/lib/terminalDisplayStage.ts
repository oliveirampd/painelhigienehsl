import type { Discharge } from "./hospital";

type ActiveStage = "waiting_cleaning" | "en_route" | "in_progress";

export type TerminalStageMemory = Map<
  string,
  {
    answerId: string;
    status: ActiveStage;
    statusUpdatedAt: string;
    assignedStaffId: string | null;
  }
>;

const STAGE_RANK: Record<ActiveStage, number> = {
  waiting_cleaning: 0,
  en_route: 1,
  in_progress: 2,
};

function isActiveStage(status: Discharge["status"]): status is ActiveStage {
  return status === "waiting_cleaning" || status === "en_route" || status === "in_progress";
}

/**
 * Camada de apresentação exclusiva do Terminal.
 * Um update tardio do MESMO answer do Listo não pode fazer o leito regredir de
 * higiene iniciada para A Caminho/Alta Parada, nem apagar o colaborador já visto.
 *
 * Um novo last_answer_id representa outro ciclo e libera o novo estado normalmente.
 * Conclusões, pausas, manutenção e remoções não são retidas artificialmente.
 * Não grava no banco nem modifica a sincronização.
 */
export function preserveTerminalStageProgress(
  rows: Discharge[],
  previous: TerminalStageMemory,
): { rows: Discharge[]; memory: TerminalStageMemory } {
  const memory: TerminalStageMemory = new Map();

  const presented = rows.map((row) => {
    const isTerminal =
      row.external_id?.startsWith("listo:answer:") ||
      row.external_id?.startsWith("listo:box:");
    if (!isTerminal || !isActiveStage(row.status) || !row.last_answer_id) return row;

    const key = row.external_id ?? row.id;
    const old = previous.get(key);
    const sameCycle = old?.answerId === row.last_answer_id;

    const result: Discharge =
      sameCycle && old && STAGE_RANK[old.status] > STAGE_RANK[row.status]
        ? {
            ...row,
            status: old.status,
            status_updated_at: old.statusUpdatedAt,
            assigned_staff_id: row.assigned_staff_id ?? old.assignedStaffId,
          }
        : row;

    // Somente os leitos ainda ativos permanecem no histórico local de apresentação.
    memory.set(key, {
      answerId: row.last_answer_id,
      status: result.status as ActiveStage,
      statusUpdatedAt: result.status_updated_at,
      assignedStaffId: result.assigned_staff_id,
    });
    return result;
  });

  return { rows: presented, memory };
}
