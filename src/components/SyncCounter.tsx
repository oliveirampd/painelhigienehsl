import { useEffect, useState } from "react";

export function SyncCounter({
  lastAt,
  cadenceLabel,
  cadenceSeconds,
}: {
  lastAt: number;
  cadenceLabel: string;
  cadenceSeconds: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastAt]);

  const elapsedSeconds = Math.max(0, Math.floor((now - lastAt) / 1000));
  const cycleProgress = Math.min(100, (elapsedSeconds / cadenceSeconds) * 100);

  return (
    <span className="relative inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 font-mono text-[9px] text-white/45 sm:text-[10px]">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-sky-400/[0.06] transition-[width] duration-300"
        style={{ width: `${cycleProgress}%` }}
      />
      <span aria-hidden="true" className="relative h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300/80" />
      <span className="relative shrink-0">há</span>
      <strong className="relative min-w-[2.6ch] shrink-0 text-right font-semibold tabular-nums text-white/75">
        {elapsedSeconds}s
      </strong>
      <span className="relative shrink-0 text-white/20">·</span>
      <span className="relative truncate">{cadenceLabel}</span>
    </span>
  );
}
