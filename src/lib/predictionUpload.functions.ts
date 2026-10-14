import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizePriorityRows } from "@/lib/predictions";
import type { Json } from "@/integrations/supabase/types";

const source = z.object({
  sector: z.string().max(120),
  bed: z.string().max(60),
  status: z.string().max(80),
  predictedAt: z.string().max(40),
}).strict();

const importInput = z.object({
  code: z.string().min(1).max(256),
  rows: z.array(source).min(1).max(3000),
}).strict();

// Uma senha SOMENTE para o botao de upload. Nao ha login para visualizar a TV.
// Sem esse segredo configurado no Worker, todas as importacoes sao recusadas.
async function verifyImportCode(supplied: string) {
  const configured = process.env.PREDICTIONS_IMPORT_KEY;
  if (!configured || configured.length < 12) {
    throw new Error("Configure PREDICTIONS_IMPORT_KEY como Secret no Cloudflare.");
  }
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(actual);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  if (different !== 0) throw new Error("Codigo de importacao incorreto.");
}

export const uploadDischargePredictions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => importInput.parse(data))
  .handler(async ({ data }) => {
    await verifyImportCode(data.code);
    const rows = normalizePriorityRows(data.rows);
    if (!rows.length) {
      throw new Error("Nenhum leito válido com horário previsto passou pelos filtros. O lote anterior foi preservado.");
    }
    if (rows.length > 500) throw new Error("Quantidade de previsoes acima do limite de 500 leitos.");
    // A lista permanece até a próxima importação; não expira por troca de plantão.
    // Evita usar o banco antigo se a URL do Worker divergir da URL da TV.
    // Nunca envia chaves ou senhas para o navegador.
    const workerSupabaseUrl = process.env.SUPABASE_URL;
    const browserSupabaseUrl = process.env.VITE_SUPABASE_URL;
    if (workerSupabaseUrl && browserSupabaseUrl &&
        new URL(workerSupabaseUrl).hostname !== new URL(browserSupabaseUrl).hostname) {
      throw new Error("O Cloudflare está conectado a um projeto Supabase diferente do painel. Confira SUPABASE_URL.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error, status } = await supabaseAdmin.rpc("replace_discharge_predictions", {
      p_rows: rows as unknown as Json,
      // Mantido apenas por compatibilidade com a assinatura SQL existente.
      // A migração de previsões persistentes não usa mais esse valor.
      p_expires_at: new Date().toISOString(),
    });
    if (error) {
      const code = (error.code || "").toUpperCase();
      const reference = /^[A-Z0-9]{3,18}$/.test(code) ? code : `HTTP ${status || "?"}`;
      console.error("[uploadDischargePredictions]", {
        code: error.code,
        httpStatus: status,
        message: error.message,
        hint: error.hint,
      });
      let guidance: string;
      if (code === "PGRST202" || code === "PGRST205" || code === "42P01") {
        guidance = "Função ou tabela não encontrada pela API. Verifique o projeto Supabase usado pelo Cloudflare.";
      } else if (code === "42501" || status === 401 || status === 403) {
        guidance = "Permissão recusada. Confira SUPABASE_SERVICE_ROLE_KEY no Worker e se a chave pertence ao projeto correto.";
      } else if (code === "23505") {
        guidance = "Há leitos duplicados na importação. Nenhum dado foi substituído.";
      } else {
        guidance = "Confira a conexão do Worker com o Supabase e informe este código para diagnóstico.";
      }
      throw new Error(`Não foi possível salvar as previsões (${reference}). ${guidance}`);
    }
    return { imported: Number(inserted ?? rows.length), ok: true as const };
  });
