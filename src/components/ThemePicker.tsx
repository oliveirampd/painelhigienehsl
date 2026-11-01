import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";
import type { TerminalTheme } from "@/hooks/useTerminalTheme";

const THEMES: Array<{
  id: TerminalTheme;
  name: string;
  detail: string;
  canvas: string;
  surface: string;
  trim: string;
}> = [
  {
    id: "original",
    name: "Padrão (Original)",
    detail: "Visual escuro clássico da TV",
    canvas: "#182031",
    surface: "#293344",
    trim: "#8CA0B8",
  },
  {
    id: "abyss",
    name: "Azul Abissal",
    detail: "Azul royal profundo e intenso",
    canvas: "#071A51",
    surface: "#10378A",
    trim: "#3986EC",
  },
  {
    id: "forest",
    name: "Verde Floresta",
    detail: "Verde-pinho forte e encorpado",
    canvas: "#06291C",
    surface: "#10583A",
    trim: "#36A16C",
  },
  {
    id: "imperial",
    name: "Vermelho Imperial",
    detail: "Vinho rústico e vermelho sofisticado",
    canvas: "#381218",
    surface: "#792A32",
    trim: "#BB8650",
  },
  {
    id: "amethyst",
    name: "Roxo Imperial",
    detail: "Ametista profunda e vibrante",
    canvas: "#240D46",
    surface: "#58248E",
    trim: "#A26CEB",
  },
];

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: TerminalTheme;
  onChange: (theme: TerminalTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!parent.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={parent} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Selecionar tema do Terminal"
        aria-expanded={open}
        aria-haspopup="true"
        title="Selecionar tema do Terminal"
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/20 bg-white/[0.06] px-2 py-1.5 text-[11px] font-semibold text-white/85 transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:gap-1.5 sm:px-2.5 sm:text-xs"
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Temas</span>
        <ChevronDown className={"h-3 w-3 transition-transform " + (open ? "rotate-180" : "")} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="scrollbar-hidden absolute right-0 top-[calc(100%+8px)] z-[90] max-h-[min(440px,75vh)] w-[min(290px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-white/20 bg-[oklch(0.21_0.025_258)] p-2 text-white shadow-2xl"
          role="group"
          aria-label="Temas do Terminal"
        >
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-white/55">
            Aparência da TV
          </p>
          {THEMES.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={theme === item.id}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
              className={"flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-white " +
                (theme === item.id
                  ? "border-white/40 bg-white/[0.13]"
                  : "border-transparent hover:border-white/15 hover:bg-white/[0.08]")}
            >
              <span
                className="relative h-10 w-14 shrink-0 overflow-hidden rounded-md border border-white/20"
                style={{ backgroundColor: item.canvas }}
                aria-hidden="true"
              >
                <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: item.trim }} />
                <span
                  className="absolute bottom-1 left-1.5 right-1.5 h-5 rounded-sm border border-white/15"
                  style={{ backgroundColor: item.surface }}
                >
                  <span className="absolute left-1 top-1 h-1.5 w-3 rounded-sm bg-white/65" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-white">{item.name}</span>
                <span className="block text-xs leading-normal text-white/65">{item.detail}</span>
              </span>
              {theme === item.id && <Check className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />}
            </button>
          ))}
          <p className="px-2 pt-2 text-xs text-white/45">
            Apenas no Terminal · salvo neste dispositivo
          </p>
        </div>
      )}
    </div>
  );
}
