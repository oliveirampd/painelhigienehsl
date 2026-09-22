import { useEffect, useRef } from "react";

/**
 * Rola a página automaticamente pra baixo, devagar, até o fim, espera um
 * pouco, volta pro topo, e repete em loop — só em telas grandes (desktop/TV,
 * mesmo ponto de corte "lg" usado no resto do painel, 1024px). Se a pessoa
 * rolar com o mouse (roda do scroll), o carrossel pausa por PAUSE_AFTER_WHEEL_MS
 * pra ela conseguir ver com calma, e retoma sozinho depois desse tempo, de onde
 * ela parou.
 */
const DESKTOP_BREAKPOINT = 1024;
const PAUSE_AFTER_WHEEL_MS = 15000;
const SPEED_PX_PER_TICK = 0.6;
const EDGE_PAUSE_TICKS = 90; // ~1.5s parado em cada ponta antes de inverter

export function useCarouselScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    let raf = 0;
    let dir = 1;
    let edgePause = 0;
    let pausedUntil = 0;

    const onWheel = () => {
      pausedUntil = Date.now() + PAUSE_AFTER_WHEEL_MS;
    };
    el.addEventListener("wheel", onWheel, { passive: true });

    const step = () => {
      const needs = el.scrollHeight > el.clientHeight + 4;
      if (mql.matches && needs && Date.now() >= pausedUntil) {
        if (edgePause > 0) {
          edgePause -= 1;
        } else {
          const max = el.scrollHeight - el.clientHeight;
          const next = el.scrollTop + dir * SPEED_PX_PER_TICK;
          if (next >= max) {
            el.scrollTop = max;
            dir = -1;
            edgePause = EDGE_PAUSE_TICKS;
          } else if (next <= 0) {
            el.scrollTop = 0;
            dir = 1;
            edgePause = EDGE_PAUSE_TICKS;
          } else {
            el.scrollTop = next;
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return ref;
}
