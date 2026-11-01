import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadDischargePredictions } from "@/lib/predictionUpload.functions";
import { parsePriorityXls, type PredictionRecord, type PriorityXlsSourceRow } from "@/lib/predictions";
import { isExcludedUnit } from "@/lib/operationalScope";
import { AutoScroll } from "@/components/AutoScroll";
import { formatClockTime, type Discharge } from "@/lib/hospital";

type PendingXls = {
  name: string;
  total: number;
  signed: number;
  confirmed: number;
  unconfirmed: number;
  eligible: number;
  sources: PriorityXlsSourceRow[];
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
  const [pending, setPending] = useState<PendingXls | null>(null);
  const [code, setCode] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("discharge_predictions")
      .select("id, bed_number, unit, source_sector, probability_text, probability_value, predicted_time, predicted_at, expires_at")
      .order("predicted_at", { ascending: true, nullsFirst: false })
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
      return !isExcludedUnit(p.unit) &&
        key !== null &&
        !inDischargeFlow.has(key);
    });
  }, [predictions, discharges, nowMs]);

  async function selectXls(file: File | undefined) {
    if (!file) return;
    if (!/\.xls$/i.test(file.name)) {
      toast.error("Selecione o arquivo .xls do aplicativo de prioridades.");
      return;
    }
    if (file.size > 1_000_000) {
      toast.error("O XLS deve ter no máximo 1 MB.");
      return;
    }
    try {
      const data = await file.arrayBuffer();
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        content = new TextDecoder("windows-1252").decode(data);
      }
      const parsed = parsePriorityXls(content);
      setPending({
        name: file.name,
        total: parsed.total,
        signed: parsed.predictions.filter((p) => p.probability_text === "Alta médica assinada").length,
        confirmed: parsed.predictions.filter((p) => p.probability_text === "Alta prevista confirmada").length,
        unconfirmed: parsed.predictions.filter((p) => p.probability_text === "Alta prevista não confirmada").length,
        eligible: parsed.predictions.length,
        sources: parsed.sources,
      });
      setCode("");
      setImportError(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "XLS inválido.");
    }
  }

  async function importXls() {
    if (!pending || importing) return;
    if (!code.trim()) {
      toast.error("Informe o codigo de importacao.");
      return;
    }
    if (!pending.eligible) {
      toast.error("O XLS não contém leitos elegíveis com horário. Nenhum dado foi alterado.");
      return;
    }
    setImportError(null);
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
      const message = error instanceof Error ? error.message : "Erro ao importar previsões.";
      setImportError(message);
      toast.error(message);
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
            accept=".xls,application/vnd.ms-excel"
            className="hidden"
            aria-label="Arquivo XLS do aplicativo de prioridades"
            onChange={(event) => {
              void selectXls(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-[#ff687b]/45 bg-[#ef354f]/15 px-2 py-1 text-[11px] font-semibold text-[#ff8e9d] transition-colors hover:bg-[#ef354f]/25 sm:text-xs"
            title="Importar XLS do aplicativo de prioridades"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span className="sm:hidden">XLS</span>
            <span className="hidden sm:inline">Importar XLS</span>
          </button>
        </div>
      </div>

      <div className="terminal-panel-content flex-1 min-h-0 overflow-hidden">
        {loadError && visible.length === 0 ? (
          <div className="text-xs text-center text-white/45 p-4">
            Previsões indisponíveis. Confira a configuração da tabela.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-[70px] items-center justify-center text-center text-xs lg:text-sm text-white/50 p-3">
            Aguardando novas previsões
          </div>
        ) : (
          <AutoScroll>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 content-start">
              {visible.map((p) => {
                const scheduledAt = p.predicted_at ?? p.predicted_time;
                const predictedMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
                const hasSchedule = Number.isFinite(predictedMs);
                const overdue = hasSchedule && nowMs > predictedMs;
                const predictionDay = hasSchedule ? new Date(predictedMs).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
                }) : null;
                const todayBrt = new Date(nowMs).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
                });
                return (
                  <article
                    key={p.id}
                    className={`flex min-h-[112px] flex-col justify-between gap-2 rounded-xl border px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] ${
                      overdue
                        ? "border-amber-400/65 bg-gradient-to-br from-amber-700/30 via-rose-800/20 to-[#4c203d]/35"
                        : "border-[#ff7189]/50 bg-gradient-to-br from-[#e43b5f]/25 via-[#a82953]/20 to-[#4c203d]/35"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-base lg:text-lg font-extrabold leading-tight text-white">
                        {p.bed_number}
                      </span>
                      <span className={`text-xl lg:text-2xl font-black tabular-nums leading-none ${
                        overdue ? "text-amber-200" : "text-white"
                      }`}>
                        {hasSchedule ? formatClockTime(scheduledAt!) : "--:--"}
                      </span>
                    </div>
                    {predictionDay && predictionDay !== todayBrt && (
                      <span className="text-[11px] font-semibold text-white/65 sm:text-xs">
                        Previsão de {predictionDay}
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex rounded-md border border-[#ffaeae]/35 bg-[#71304d]/40 px-1.5 py-1 text-[11px] font-semibold leading-tight text-[#ffd6df] sm:px-2 sm:text-xs">
                        {p.probability_text}
                      </span>
                      {overdue && (
                        <span className="inline-flex rounded-md border border-amber-300/50 bg-amber-500/25 px-1.5 py-1 text-[11px] font-extrabold text-amber-100 sm:px-2 sm:text-xs">
                          Alta atrasada
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </AutoScroll>
        )}
      </div>

      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Importar previsões de alta do XLS"
            className="w-full max-w-md rounded-xl border border-[#ec5b71]/40 bg-[#151a29] text-white shadow-2xl p-5 flex flex-col gap-4"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Importar previsões</h3>
              <button type="button" onClick={() => setPending(null)} aria-label="Fechar" disabled={importing}
                className="p-1.5 rounded hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-sm text-white/75 space-y-2">
              <p className="truncate" title={pending.name}>Arquivo: <strong>{pending.name}</strong></p>
              <p>Registros no XLS: <strong>{pending.total}</strong></p>
              <p>Alta médica assinada: <strong>{pending.signed}</strong></p>
              <p>Previsão confirmada: <strong>{pending.confirmed}</strong></p>
              <p>Previsão não confirmada: <strong>{pending.unconfirmed}</strong></p>
              <p>Ignorados pelas regras: <strong>{pending.total - pending.eligible}</strong></p>
              <p>Leitos elegíveis após as exclusões: <strong className="text-[#ff8396]">{pending.eligible}</strong></p>
              <p className="text-xs text-white/50">
                Só leitos permitidos e horários do XLS, sem informações de pacientes. Horários vencidos aparecem como alta atrasada, até o leito entrar no Listo360 ou um novo XLS substituir a lista.
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
              onClick={() => void importXls()}
              className="rounded-md bg-[#b91e3d] hover:bg-[#d72b4d] disabled:opacity-50 px-4 py-2.5 font-bold text-sm"
            >
              {importing ? "Importando..." : `Substituir por ${pending.eligible} previsões`}
            </button>
            {importError && (
              <p role="alert" className="text-xs leading-relaxed text-red-100 rounded-md border border-red-400/40 bg-red-950/50 p-3">
                {importError}
              </p>
            )}
            {!pending.eligible && (
              <p className="text-xs text-amber-200">
                {pending.total === 0
                  ? "O XLS não contém registros."
                  : "Nenhum leito com horário válido passou pelas regras de exclusão e formato de leito."}
                {" "}Nenhum dado anterior será alterado.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
