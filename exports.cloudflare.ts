import { DurableObject } from "cloudflare:workers";

/**
 * Executor singleton do sync Terminal.
 *
 * Este projeto usa uma beta do Nitro v3 que exporta classes Cloudflare através
 * de exports.cloudflare.ts. O Worker HTTP apenas encaminha a requisição; o
 * processamento pesado do Listo acontece aqui, fora do orçamento de CPU do
 * request HTTP.
 */
export class TerminalSyncDurableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const { handleListo360Sync } = await import(
      "./src/routes/api/public/hooks/sync-listo360"
    );
    return handleListo360Sync(request);
  }
}
