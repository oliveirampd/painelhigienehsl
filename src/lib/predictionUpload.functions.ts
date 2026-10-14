import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nextPredictionShift, normalizePredictionRows } from "@/lib/predictions";

const source = z.object({
  establishment: z.string().max(80),
  sector: z.string().max(120),
  bed: z.string().max(60),
  probability: z.string().max(80),
  predictedTime: z.string().max(40).nullable().optional(),
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
    const rows = normalizePredictionRows(data.rows);
    if (!rows.length) {
      throw new Error("Nenhuma previsao da Bela Vista passou pelos filtros. O lote anterior foi preservado.");
    }
    if (rows.length > 500) throw new Error("Quantidade de previsoes acima do limite de 500 leitos.");
    const expiresAt = nextPredictionShift(Date.now());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin.rpc("replace_discharge_predictions", {
      p_rows: rows,
      p_expires_at: expiresAt,
    });
    if (error) {
      console.error("[uploadDischargePredictions]", error.code, error.message);
      throw new Error("Nao foi possivel substituir as previsoes. Confira se a migracao SQL foi executada.");
    }
    return { imported: Number(inserted ?? rows.length), ok: true as const };
  });
