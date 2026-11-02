import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { CircleCheck } from "lucide-react";
import { TERMINAL_EASE, useReducedMotion } from "@/hooks/useTerminalMotion";

type Item = { id: string; content: ReactElement };
type Exit = Item & { index: number; until: number };

/** Presentation only. Counts, filters and hospital records always use current data. */
export function TerminalMotionGrid({
  items,
  completedIds,
}: {
  items: Item[];
  completedIds: Set<string>;
}) {
  const reduced = useReducedMotion();
  const grid = useRef<HTMLDivElement>(null);
  const snapshot = useRef(items);
  const signature = JSON.stringify(items.map((item) => item.id));
  const [presence, setPresence] = useState({ signature, exits: [] as Exit[] });
  if (signature !== presence.signature) {
    const currentIds = new Set(items.map((item) => item.id));
    const exits = reduced ? [] : presence.exits.filter((item) => !currentIds.has(item.id));
    snapshot.current.forEach((item, index) => {
      if (
        !reduced &&
        !currentIds.has(item.id) &&
        completedIds.has(item.id) &&
        !exits.some((exit) => exit.id === item.id)
      ) {
        exits.push({ ...item, index, until: Date.now() + 220 });
      }
    });
    setPresence({ signature, exits });
  }
  useLayoutEffect(() => {
    snapshot.current = items;
  });
  useLayoutEffect(() => {
    if (!presence.exits.length) return;
    if (reduced) {
      setPresence((value) => ({ ...value, exits: [] }));
      return;
    }
    const timer = window.setTimeout(
      () => {
        setPresence((value) => ({
          ...value,
          exits: value.exits.filter((item) => item.until > Date.now()),
        }));
      },
      Math.max(0, Math.min(...presence.exits.map((item) => item.until)) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [presence.exits, reduced]);

  const rendered: Array<Item & { exiting?: boolean }> = [...items];
  presence.exits.forEach((item) =>
    rendered.splice(Math.min(item.index, rendered.length), 0, { ...item, exiting: true }),
  );
  const layoutKey = JSON.stringify(rendered.map((item) => [item.id, !!item.exiting]));
  const previous = useRef(new Map<string, { x: number; y: number; width: number }>());
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(":scope > [data-motion-id]"));
    // Offset coordinates ignore page/AutoScroll movement. Read all positions before writes.
    const positions = nodes.map((node) => ({
      node,
      id: node.dataset.motionId!,
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
    }));
    const moves = positions.filter((p) => {
      const old = previous.current.get(p.id);
      return old && old.width === p.width && (old.x !== p.x || old.y !== p.y);
    });
    const quiet = nodes.length >= 30 || moves.length > 12;
    const viewport = root.parentElement?.getBoundingClientRect();
    if (!reduced) {
      moves.forEach(({ node, id, x, y }) => {
        const old = previous.current.get(id)!;
        const rect = node.getBoundingClientRect();
        if (viewport && (rect.bottom < viewport.top || rect.top > viewport.bottom)) return;
        const dx = old.x - x;
        const dy = old.y - y;
        // Large/bulk moves settle without long trajectories across other records.
        const frames =
          quiet || Math.hypot(dx, dy) > 500
            ? [{ opacity: 0.72 }, { opacity: 1 }]
            : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }];
        animations.current.push(
          node.animate(frames, { duration: quiet ? 180 : 340, easing: TERMINAL_EASE }),
        );
      });
    }
    previous.current = new Map(positions.map(({ id, x, y, width }) => [id, { x, y, width }]));
    return () => {
      animations.current.forEach((animation) => animation.cancel());
    };
  }, [layoutKey, reduced]);

  return (
    <div
      ref={grid}
      data-motion-density={rendered.length >= 30 ? "quiet" : "normal"}
      className="tv-motion-grid relative grid min-w-0 grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 sm:gap-2 sm:p-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {rendered.length === 0 && (
        <div className="col-span-full p-4 text-center text-sm text-white/40">
          Nenhum leito em higienização.
        </div>
      )}
      {rendered.map(({ id, content, exiting }) => (
        <div
          key={id}
          data-motion-id={id}
          className={`tv-motion-slot min-w-0 ${exiting ? "tv-card-completing" : "tv-card-enter"}`}
          inert={exiting || undefined}
          aria-hidden={exiting || undefined}
        >
          {content}
          {exiting && (
            <span className="tv-completion-confirmation" aria-hidden="true">
              <CircleCheck size={18} /> Finalizado
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Only identity text changes replay this effect; clocks remain untouched. */
export function MotionIdentity({ value }: { value: string }) {
  return (
    <span key={value} className="tv-identity-handoff">
      {value}
    </span>
  );
}
