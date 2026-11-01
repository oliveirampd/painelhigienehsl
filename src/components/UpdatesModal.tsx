import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { UPDATES_VERSION, UPDATES_ITEMS } from "@/lib/updates";
import { useModalFocus } from "@/hooks/useModalFocus";

const STORAGE_KEY = "updates:lastSeenVersion";
const AUTO_DISMISS_MS = 12000;

/**
 * Popup "o que mudou", resumido, mostrado uma vez por atualização (não em
 * toda visita — só quando UPDATES_VERSION muda). Fecha sozinho depois de um
 * tempo, pra não ficar preso na tela de uma TV sem ninguém pra fechar.
 */
export function UpdatesModal() {
  const [open, setOpen] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const dialogRef = useModalFocus<HTMLDivElement>(open);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen !== UPDATES_VERSION) setOpen(true);
    } catch {
      // localStorage indisponível (modo privado etc.) — só não mostra o popup
    }
  }, []);

  useEffect(() => {
    if (!open || interacting) return;
    const id = setTimeout(close, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [open, interacting]);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, UPDATES_VERSION);
    } catch {
      // sem problema, só reaparece na próxima vez nesse caso
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 lg:items-center"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onFocusCapture={(event) => { if (event.target !== event.currentTarget) setInteracting(true); }}
        onPointerDownCapture={() => setInteracting(true)}
        onKeyDown={(event) => { if (event.key === "Escape") close(); }}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Novidades do painel"
        className="w-full max-w-sm rounded-xl border border-white/15 bg-[oklch(0.19_0.02_265)] p-4 text-[oklch(0.98_0.005_260)] shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
            <Sparkles className="h-4 w-4" style={{ color: "oklch(0.8 0.16 85)" }} />
            Novidades do painel
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar novidades do painel"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-1.5 text-sm text-white/80">
          {UPDATES_ITEMS.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
