import { useEffect, useState } from "react";

export function SyncCounter({
  lastAt,
  cadenceLabel,
  cadenceSeconds,
  alignToClock = false,
}: {
  lastAt?: number;
  cadenceLabel: string;
  cadenceSeconds: number;
  alignToClock?: boolean;
}) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastAt]);

  const rawSeconds = alignToClock
    ? Math.floor(now / 1000) % cadenceSeconds
    : Math.max(0, Math.floor((now - (lastAt ?? now)) / 1000));
  const elapsedSeconds = alignToClock ? rawSeconds : rawSeconds;
  const cycleProgress = Math.min(100, (elapsedSeconds / cadenceSeconds) * 100);

  return (
    <span className="relative inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full border border-white/10 bg-white/[0.035] px-1.5 py-1 font-mono text-[10px] text-white/45 sm:gap-1.5 sm:px-2 sm:text-xs">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-sky-400/[0.06] transition-[width] duration-300"
        style={{ width: `${cycleProgress}%` }}
      />
      <span aria-hidden="true" className="relative h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300/80" />
      <span className="relative shrink-0">Sincronização</span>
      <strong className="relative min-w-[2.6ch] shrink-0 text-right font-semibold tabular-nums text-white/75">
        {elapsedSeconds}s
      </strong>
      <span className="relative hidden shrink-0 text-white/20 sm:inline">·</span>
      <span className="relative hidden truncate sm:inline">{cadenceLabel}</span>
    </span>
  );
}
