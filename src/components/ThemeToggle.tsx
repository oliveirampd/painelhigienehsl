import { Moon, Sun } from "lucide-react";

export function ThemeToggle({
  isDark,
  onToggle,
  compact = false,
}: {
  isDark: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
      className="panel-theme-toggle inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.035] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/65 transition-colors hover:bg-white/[0.08]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {!compact && <span>{isDark ? "Claro" : "Escuro"}</span>}
    </button>
  );
}
