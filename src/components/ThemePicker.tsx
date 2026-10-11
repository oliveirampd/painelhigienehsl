import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";
import type { PanelTheme } from "@/hooks/usePanelTheme";

type ThemeOption = {
  id: PanelTheme;
  name: string;
  description: string;
  preview: { background: string; surface: string; accent: string; ink: string };
};

const THEMES: ThemeOption[] = [
  {
    id: "hospital",
    name: "Hospital Clean",
    description: "Branco e azul clínico",
    preview: { background: "#f4f8fb", surface: "#ffffff", accent: "#2676aa", ink: "#294456" },
  },
  {
    id: "midnight",
    name: "Midnight Blue",
    description: "Azul-marinho elegante",
    preview: { background: "#13253e", surface: "#1c3552", accent: "#83bedd", ink: "#eef6ff" },
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Verde suave e natural",
    preview: { background: "#eff8f2", surface: "#fcfefd", accent: "#288264", ink: "#20463b" },
  },
  {
    id: "burgundy",
    name: "Burgundy Gold",
    description: "Vinho, marfim e dourado",
    preview: { background: "#faf3ee", surface: "#fffdf9", accent: "#8b4053", ink: "#4d3138" },
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cinza azulado contemporâneo",
    preview: { background: "#f0f3f7", surface: "#ffffff", accent: "#57718f", ink: "#32465a" },
  },
];

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: PanelTheme;
  onChange: (value: PanelTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTheme = THEMES.find((item) => item.id === theme);

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onOutsideClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutsideClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="panel-theme-picker relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="Selecionar tema visual"
        aria-haspopup="true"
        aria-expanded={open}
        title={activeTheme ? "Tema: " + activeTheme.name : "Selecionar tema"}
        className="panel-theme-trigger inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
      >
        <Palette className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Temas</span>
        <ChevronDown className={"h-3 w-3 shrink-0 transition-transform " + (open ? "rotate-180" : "")} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="panel-theme-menu scrollbar-hidden absolute right-0 top-[calc(100%+8px)] z-50 w-[min(280px,calc(100vw-24px))] max-h-[min(440px,75vh)] overflow-y-auto rounded-xl border p-2"
          role="group"
          aria-label="Selecionar um dos cinco temas"
        >
          <p className="panel-theme-menu-heading px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-widest">
            Aparência do painel
          </p>
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={theme === item.id}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
              className="panel-theme-option flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left transition-colors"
            >
              <span
                className="panel-theme-swatch relative flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                style={{ backgroundColor: item.preview.background, borderColor: item.preview.accent }}
                aria-hidden="true"
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: item.preview.accent }}
                />
                <span
                  className="flex h-[22px] w-[35px] items-center gap-[3px] rounded border px-1"
                  style={{ backgroundColor: item.preview.surface, borderColor: item.preview.accent + "55" }}
                >
                  <span className="h-2 w-[5px] rounded-sm" style={{ backgroundColor: item.preview.accent }} />
                  <span className="h-[3px] w-3 rounded-sm" style={{ backgroundColor: item.preview.ink, opacity: 0.55 }} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="panel-theme-option-name block text-xs font-semibold">{item.name}</span>
                <span className="panel-theme-option-detail block text-[10px] leading-relaxed">{item.description}</span>
              </span>
              {theme === item.id && <Check className="panel-theme-selected h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
          <p className="panel-theme-menu-footer px-2 pt-2 text-[10px] leading-normal">
            A preferência fica salva neste dispositivo.
          </p>
        </div>
      )}
    </div>
  );
}
