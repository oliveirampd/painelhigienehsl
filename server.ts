import { DurableObject } from "cloudflare:workers";

/**
 * Executor singleton do sync Terminal.
 *
 * O Worker HTTP do plano Free tem um orçamento de CPU muito curto para
 * processar milhares de respostas do Listo. O Durable Object executa a mesma
 * rotina com orçamento próprio, mantendo a rota HTTP apenas como encaminhador.
 */
export class TerminalSyncDurableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const { handleListo360Sync } = await import(
      "./src/routes/api/public/hooks/sync-listo360"
    );
    return handleListo360Sync(request);
  }
}

// O Nitro compõe este entry com o servidor da aplicação. O fetch vazio mantém
// as rotas normais sob responsabilidade do runtime gerado.
export default {
  fetch() {},
};
