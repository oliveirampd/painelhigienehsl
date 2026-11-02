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
    let edgePauseUntil = 0;
    let pausedUntil = 0;
    let lastFrameAt = 0;
    let pos = ref.scrollTop;
    let needs = ref.scrollHeight > ref.clientHeight + 4;
    // Antigo ritmo: ~0,35px/frame a 60Hz. Agora o passo independe do Hz da TV.
    const PIXELS_PER_SECOND = 21;

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
    ref.addEventListener("focusin", pauseForUser);
    ref.addEventListener("keydown", pauseForUser);

    const ro = new ResizeObserver(recheck);
    ro.observe(ref);
    const mo = new MutationObserver(recheck);
    mo.observe(ref, { childList: true, subtree: true, characterData: true });

    const step = (frameAt: number) => {
      const deltaSeconds = lastFrameAt === 0 ? 0 : Math.min((frameAt - lastFrameAt) / 1000, 0.05);
      lastFrameAt = frameAt;
      // TVs e celulares em segundo plano não precisam acumular rolagem.
      if (document.hidden) {
        raf = requestAnimationFrame(step);
        return;
      }
      if (needs) {
        if (Date.now() < pausedUntil) {
          // A interação humana tem prioridade absoluta por 15s.
          pos = ref.scrollTop;
        } else if (frameAt >= edgePauseUntil) {
          const max = Math.max(0, ref.scrollHeight - ref.clientHeight);
          const distanceToEdge = Math.max(0, Math.min(pos, max - pos));
          const easing = Math.max(0.45, Math.min(1, distanceToEdge / 80));
          pos += dir * PIXELS_PER_SECOND * deltaSeconds * easing;
          if (pos >= max) {
            pos = max;
            dir = -1;
            edgePauseUntil = frameAt + 2000;
          } else if (pos <= 0) {
            pos = 0;
            dir = 1;
            edgePauseUntil = frameAt + 2000;
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
      ref.removeEventListener("focusin", pauseForUser);
      ref.removeEventListener("keydown", pauseForUser);
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
