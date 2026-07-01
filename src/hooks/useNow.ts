import { useEffect, useState } from "react";

/** Returns Date.now() that updates every `intervalMs` (default 30s). */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
