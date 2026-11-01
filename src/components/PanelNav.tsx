import { Link } from "@tanstack/react-router";
import { BedDouble, Tv } from "lucide-react";

const ITEMS = [
  { to: "/tv", label: "Terminal", icon: Tv },
  { to: "/diaria", label: "Diária", icon: BedDouble },
] as const;

export function PanelNav({ compact = false }: { compact?: boolean }) {
  return (
    <nav
      aria-label="Navegação do painel"
      className="panel-nav scrollbar-hidden flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeProps={{ className: "panel-nav-item-active" }}
          inactiveProps={{ className: "panel-nav-item-inactive" }}
          className="panel-nav-item inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors sm:min-h-10 sm:gap-1.5 sm:px-2.5 sm:text-xs"
        >
          <Icon className="h-3.5 w-3.5" />
          {!compact && <span>{label}</span>}
        </Link>
      ))}
    </nav>
  );
}
