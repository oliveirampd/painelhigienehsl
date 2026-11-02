import { useEffect } from "react";

/** Preserve 60 Hz reference speeds and the existing 15 second interaction pause. */
export function useSeamlessScroll(
  element: HTMLDivElement | null,
  axis: "x" | "y",
  resetKey?: string,
  suspended = false,
) {
  useEffect(() => {
    if (!element || suspended) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => (axis === "y" ? element.scrollTop : element.scrollLeft);
    const write = (value: number) => {
      if (axis === "y") element.scrollTop = value;
      else element.scrollLeft = value;
    };
    let max = 0;
    let pos = read();
    let direction = 1;
    let pausedUntil = 0;
    let edgeUntil = axis === "x" ? performance.now() + 1833 : 0;
    let previousTime = 0;
    let velocity = 0;
    let raf = 0;
    let measuring = 0;
    const measure = () => {
      measuring = 0;
      max = Math.max(
        0,
        axis === "y"
          ? element.scrollHeight - element.clientHeight
          : element.scrollWidth - element.clientWidth,
      );
      pos = Math.min(read(), max);
    };
    const scheduleMeasure = () => {
      if (!measuring) measuring = requestAnimationFrame(measure);
    };
    const pause = () => {
      pos = read();
      velocity = 0;
      pausedUntil = performance.now() + 15000;
    };
    const events = ["wheel", "touchstart", "touchmove", "pointerdown", "focusin", "keydown"];
    events.forEach((event) => element.addEventListener(event, pause, { passive: true }));
    const resize = new ResizeObserver(scheduleMeasure);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    const mutation = new MutationObserver(scheduleMeasure);
    mutation.observe(element, { childList: true, subtree: true });
    const step = (time: number) => {
      const dt = Math.min(32, previousTime ? time - previousTime : 0);
      previousTime = time;
      if (media.matches || document.hidden || time < pausedUntil || time < edgeUntil || max <= 4) {
        pos = read();
        velocity = 0;
      } else {
        const edge = Math.max(0.25, Math.min(1, Math.min(pos, max - pos) / 60));
        const desired = (axis === "y" ? 21 : 27.6) * edge;
        velocity += (desired - velocity) * Math.min(1, dt / 180);
        pos += (direction * velocity * dt) / 1000;
        if (pos >= max || pos <= 0) {
          pos = Math.max(0, Math.min(max, pos));
          direction = pos >= max ? -1 : 1;
          edgeUntil = time + (axis === "y" ? 2000 : 1833);
          velocity = 0;
        }
        write(pos);
      }
      raf = requestAnimationFrame(step);
    };
    measure();
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(measuring);
      resize.disconnect();
      mutation.disconnect();
      events.forEach((event) => element.removeEventListener(event, pause));
    };
  }, [element, axis, resetKey, suspended]);
}
