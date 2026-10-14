import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadDischargePredictions } from "@/lib/predictionUpload.functions";
import { parseCommandCenterCsv, type PredictionRecord, type PredictionSourceRow } from "@/lib/predictions";
import { isExcludedUnit } from "@/lib/operationalScope";
import type { Discharge } from "@/lib/hospital";

type PendingCsv = {
  name: string;
  total: number;
  belaVista: number;
  altaMedica: number;
  altaReal: number;
  eligible: number;
  sources: PredictionSourceRow[];
};

// O mesmo número de leito pode existir em blocos diferentes: sempre compare bloco + leito.
function predictionBedKey(unit: string, bedNumber: string): string | null {
  const block = unit.match(/\bbloco\s+([a-z])\b/i)?.[1]?.toUpperCase();
  const number = bedNumber.match(/^leito\s+(\d+)$/i)?.[1];
  return block && number ? `${block}:${Number(number)}` : null;
}

export function DischargePredictionsPanel({
  nowMs,
  discharges,
  className,
}: {
  nowMs: number;
  discharges: Discharge[];
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<PendingCsv | null>(null);
  const [code, setCode] = useState("");
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("discharge_predictions")
      .select("id, bed_number, unit, source_sector, probability_text, probability_value, predicted_time, expires_at")
      .gt("expires_at", new Date().toISOString())
      .order("probability_value", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setPredictions((data ?? []) as PredictionRecord[]);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const visible = useMemo(() => {
    // Inclui leitos que já entraram em Altas Paradas, A Caminho, Higienização,
    // Pausados ou Concluídos no dia. Ignora desmontagem e conclusões antigas.
    const localDay = new Date(nowMs - 3 * 60 * 60_000);
    const todayStartMs = Date.UTC(
      localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(),
    ) + 3 * 60 * 60_000;
    const inDischargeFlow = new Set(
      discharges
        .filter((d) => (d.external_id ?? "").startsWith("listo:answer:bed:"))
        .filter((d) => d.status !== "completed" ||
          (d.completed_at !== null && new Date(d.completed_at).getTime() >= todayStartMs))
        .map((d) => predictionBedKey(d.unit, d.bed_number))
        .filter((key): key is string => key !== null),
    );

    return predictions.filter((p) => {
      const key = predictionBedKey(p.unit, p.bed_number);
      return new Date(p.expires_at).getTime() > nowMs &&
        !isExcludedUnit(p.unit) &&
        key !== null &&
        !inDischargeFlow.has(key);
    });
  }, [predictions, discharges, nowMs]);

  async function selectCsv(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast.error("O arquivo deve ter no maximo 1 MB.");
      return;
    }
    try {
      const content = await file.text();
      const parsed = parseCommandCenterCsv(content);
      const belaVistaRows = parsed.sources.filter(
        (row) => row.establishment.trim().toLocaleLowerCase("pt-BR") === "bela vista",
      );
      const altaMedica = parsed.predictions.filter((p) => p.probability_text === "Alta Médica").length;
      const altaReal = parsed.predictions.filter((p) => p.probability_text === "Alta Real").length;
      setPending({
        name: file.name,
        total: parsed.total,
        belaVista: belaVistaRows.length,
        altaMedica,
        altaReal,
        eligible: parsed.predictions.length,
        sources: parsed.sources,
      });
      setCode("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV invalido.");
    }
  }

  async function importCsv() {
    if (!pending || importing) return;
    if (!code.trim()) {
      toast.error("Informe o codigo de importacao.");
      return;
    }
    if (!pending.eligible) {
      toast.error("O arquivo nao contem previsoes elegiveis. Nenhum dado foi alterado.");
      return;
    }
    setImporting(true);
    try {
      const result = await uploadDischargePredictions({
        data: { code, rows: pending.sources },
      });
      toast.success(`${result.imported} previsoes importadas.`);
      setPending(null);
      setCode("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao importar previsoes.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className={`h-[300px] lg:h-full panel-surface rounded-xl border overflow-hidden flex flex-col lg:min-h-0 ${className ?? ""}`}>
      <div className="flex-none px-3 py-2 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm lg:text-base font-bold flex items-center gap-2 min-w-0 truncate">
            <CalendarClock className="w-4 h-4 shrink-0 text-[#ff667a]" />
            <span className="truncate">Previsões de Alta</span>
            <span className="text-xs font-mono text-[#ff8091]">{visible.length}</span>
          </h2>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Arquivo CSV do Command Center"
            onChange={(event) => {
              void selectCsv(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#ff687b]/45 bg-[#ef354f]/15 text-[#ff8e9d] hover:bg-[#ef354f]/25 text-[10px] lg:text-xs font-semibold transition-colors"
            title="Importar CSV do Command Center"
          >
            <FileUp className="w-3.5 h-3.5" />
            Importar CSV
          </button>
        </div>
      </div>

      <div className="terminal-panel-content flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {loadError && visible.length === 0 ? (
          <div className="text-xs text-center text-white/45 p-4">
            Previsões indisponíveis. Confira a configuração da tabela.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-[70px] items-center justify-center text-center text-xs lg:text-sm text-white/50 p-3">
            Aguardando novas previsões
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visible.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-[#ee4962]/55 bg-[#cc1f3b]/15 px-2.5 py-2 flex flex-col gap-1"
              >
                <div className="flex justify-between items-baseline gap-1">
                  <span className="text-sm lg:text-base font-bold text-white truncate">
                    {p.bed_number}
                  </span>
                  <span className="shrink-0 font-mono text-xs lg:text-sm font-bold text-[#ff748a]">
                    {p.probability_text}
                  </span>
                </div>
                <div className="text-[10px] lg:text-xs text-white/70 leading-tight truncate" title={p.source_sector}>
                  {p.source_sector}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Importar previsões de alta"
            className="w-full max-w-md rounded-xl border border-[#ec5b71]/40 bg-[#151a29] text-white shadow-2xl p-5 flex flex-col gap-4"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Importar previsões</h3>
              <button type="button" onClick={() => setPending(null)} aria-label="Fechar" disabled={importing}
                className="p-1.5 rounded hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-sm text-white/75 space-y-2">
              <p className="truncate" title={pending.name}>Arquivo: <strong>{pending.name}</strong></p>
              <p>Registros no CSV: <strong>{pending.total}</strong></p>
              <p>Registros da Bela Vista: <strong>{pending.belaVista}</strong></p>
              <p>Alta Médica elegível: <strong>{pending.altaMedica}</strong></p>
              <p>Alta Real elegível: <strong>{pending.altaReal}</strong></p>
              <p>Leitos elegíveis após as exclusões: <strong className="text-[#ff8396]">{pending.eligible}</strong></p>
              <p className="text-xs text-white/50">
                Apenas leitos permitidos, sem dados de pacientes. Leitos que já entraram no fluxo do Listo360 são ocultados automaticamente.
              </p>
            </div>
            <label className="text-xs font-semibold flex flex-col gap-2">
              Código de importação
              <input
                type="password"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Código configurado no Cloudflare"
                className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              disabled={!pending.eligible || importing || !code.trim()}
              onClick={() => void importCsv()}
              className="rounded-md bg-[#b91e3d] hover:bg-[#d72b4d] disabled:opacity-50 px-4 py-2.5 font-bold text-sm"
            >
              {importing ? "Importando..." : `Substituir por ${pending.eligible} previsões`}
            </button>
            {!pending.eligible && (
              <p className="text-xs text-amber-200">
                {pending.belaVista === 0
                  ? "Nenhum registro da Bela Vista foi encontrado."
                  : "Nenhum leito com Alta Médica ou Alta Real passou pelas regras de exclusão e formato de leito."}
                {" "}Nenhum dado anterior será alterado.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
