import { useState, type ReactNode } from "react";
import { useSeamlessScroll } from "@/hooks/useSeamlessScroll";

export function AutoScroll({
  children,
  suspended = false,
}: {
  children: ReactNode;
  suspended?: boolean;
}) {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  useSeamlessScroll(ref, "y", undefined, suspended);
  return (
    <div
      ref={setRef}
      className="scrollbar-hidden h-full min-w-0 overflow-y-auto overscroll-contain touch-pan-y"
    >
      {children}
    </div>
  );
}
