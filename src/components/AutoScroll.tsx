import { useEffect, useState, type ReactNode } from "react";

// Auto-scroll vertical: se o conteúdo não couber, rola devagar em loop.
// Ao perceber interação humana, entrega o controle por 15s e depois retoma
// exatamente de onde a pessoa deixou a lista.
export function AutoScroll({ children }: { children: ReactNode }) {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      ref.scrollTop = 0;
      return;
    }

    const USER_PAUSE_MS = 15_000;
    let raf = 0;
    let dir = 1;
    let edgePause = 0;
    let pausedUntil = 0;
    let pos = ref.scrollTop;
    let needs = ref.scrollHeight > ref.clientHeight + 4;

    const pauseForUser = () => {
      pos = ref.scrollTop;
      pausedUntil = Date.now() + USER_PAUSE_MS;
    };

    const recheck = () => {
      needs = ref.scrollHeight > ref.clientHeight + 4;
      if (!needs) {
        pos = 0;
        ref.scrollTop = 0;
      } else {
        pos = Math.min(ref.scrollTop, ref.scrollHeight - ref.clientHeight);
      }
    };

    ref.addEventListener("wheel", pauseForUser, { passive: true });
    ref.addEventListener("touchstart", pauseForUser, { passive: true });
    ref.addEventListener("touchmove", pauseForUser, { passive: true });
    ref.addEventListener("pointerdown", pauseForUser, { passive: true });

    const ro = new ResizeObserver(recheck);
    ro.observe(ref);
    const mo = new MutationObserver(recheck);
    mo.observe(ref, { childList: true, subtree: true, characterData: true });

    const step = () => {
      if (needs) {
        if (Date.now() < pausedUntil) {
          // Enquanto a pessoa navega, acompanha a posição real em vez de tentar
          // impor a posição antiga do carrossel.
          pos = ref.scrollTop;
        } else if (edgePause > 0) {
          edgePause -= 1;
        } else {
          pos += dir * 0.35;
          const max = ref.scrollHeight - ref.clientHeight;
          if (pos >= max) {
            pos = max;
            dir = -1;
            edgePause = 120;
          } else if (pos <= 0) {
            pos = 0;
            dir = 1;
            edgePause = 120;
          }
          ref.scrollTop = Math.floor(pos);
        }
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      ref.removeEventListener("wheel", pauseForUser);
      ref.removeEventListener("touchstart", pauseForUser);
      ref.removeEventListener("touchmove", pauseForUser);
      ref.removeEventListener("pointerdown", pauseForUser);
    };
  }, [ref]);

  return (
    <div
      ref={setRef}
      className="scrollbar-hidden h-full overflow-y-auto overscroll-contain touch-pan-y"
    >
      {children}
    </div>
  );
}
