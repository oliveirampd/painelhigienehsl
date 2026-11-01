import "./lib/error-capture";

import { DurableObject } from "cloudflare:workers";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type DurableObjectStubLike = {
  fetch: (request: Request) => Promise<Response>;
};

type DurableObjectNamespaceLike = {
  idFromName: (name: string) => unknown;
  get: (id: unknown) => DurableObjectStubLike;
};

type CloudflareEnv = {
  TERMINAL_SYNC_DO?: DurableObjectNamespaceLike;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

/**
 * O sync do Listo processa milhares de respostas por ciclo. Em um Worker HTTP
 * do plano Free isso pode ultrapassar o limite de CPU de 10 ms e ser encerrado
 * pela Cloudflare com erro 1102. O Durable Object tem orçamento de CPU próprio
 * e mantém o processamento pesado fora do request HTTP que atende o painel.
 *
 * O estado operacional continua no Supabase; o DO é apenas o executor singleton.
 */
export class TerminalSyncDurableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const { handleListo360Sync } = await import(
      "./routes/api/public/hooks/sync-listo360"
    );
    return handleListo360Sync(request);
  }
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const cloudflareEnv = env as CloudflareEnv;

      // Mantém o Worker HTTP extremamente leve e entrega somente o sync pesado
      // ao singleton. Todas as demais rotas continuam no TanStack/Nitro normal.
      if (
        url.pathname === "/api/public/hooks/sync-listo360" &&
        cloudflareEnv.TERMINAL_SYNC_DO
      ) {
        const namespace = cloudflareEnv.TERMINAL_SYNC_DO;
        const id = namespace.idFromName("listo360");
        return await namespace.get(id).fetch(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
