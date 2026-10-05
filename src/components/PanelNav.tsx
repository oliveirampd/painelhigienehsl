import { Link } from "@tanstack/react-router";
import { BarChart3, BedDouble, Building2, Tv } from "lucide-react";

const ITEMS = [
  { to: "/tv", label: "Terminal", icon: Tv },
  { to: "/diaria", label: "Diária", icon: BedDouble },
  { to: "/terminal-geral", label: "Geral", icon: Building2 },
  { to: "/gestao", label: "Gestão", icon: BarChart3 },
] as const;

export function PanelNav({ compact = false }: { compact?: boolean }) {
  return (
    <nav
      aria-label="Navegação do painel"
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.035] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeProps={{
            className:
              "bg-white/12 text-white border-white/20 shadow-sm",
          }}
          inactiveProps={{
            className:
              "text-white/50 border-transparent hover:bg-white/[0.07] hover:text-white/80",
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors lg:text-xs"
        >
          <Icon className="h-3.5 w-3.5" />
          {!compact && <span>{label}</span>}
        </Link>
      ))}
    </nav>
  );
}
