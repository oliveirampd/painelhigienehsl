import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TERMINAL_EASE, useReducedMotion } from "@/hooks/useTerminalMotion";

function visibleRect(element: HTMLElement | null) {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (
    !rect.width ||
    !rect.height ||
    rect.top < 0 ||
    rect.left < 0 ||
    rect.bottom > innerHeight ||
    rect.right > innerWidth
  )
    return null;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
      const bounds = parent.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) return null;
    }
  }
  return rect;
}

export function useBedDetailMotion(origin: HTMLElement | null, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const reduced = useReducedMotion();
  const active = useRef<Animation[]>([]);
  const ghosts = useRef<HTMLElement[]>([]);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const cancel = useCallback(() => {
    active.current.forEach((animation) => animation.cancel());
    active.current = [];
    ghosts.current.forEach((ghost) => ghost.remove());
    ghosts.current = [];
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;
    if (reduced) {
      if (closing) onCloseRef.current();
      return;
    }
    const source = visibleRect(origin);
    const target = dialog.getBoundingClientRect();
    const duration = closing ? 260 : 360;
    const animate = (
      node: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions = {},
    ) => {
      const animation = node.animate(frames, { duration, easing: TERMINAL_EASE, ...options });
      active.current.push(animation);
      return animation;
    };
    let finish: Animation;
    if (source) {
      // Only the empty surface scales. Identity text travels on its own layer.
      const surface = document.createElement("div");
      surface.className = "tv-detail-morph-surface";
      surface.setAttribute("aria-hidden", "true");
      const color = getComputedStyle(origin!).borderColor;
      Object.assign(surface.style, {
        left: `${target.left}px`,
        top: `${target.top}px`,
        width: `${target.width}px`,
        height: `${target.height}px`,
        borderColor: color,
      });
      document.body.append(surface);
      ghosts.current.push(surface);
      const from = `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`;
      const frames = [
        { transform: from, opacity: 0.85 },
        { transform: "none", opacity: 0 },
      ];
      finish = animate(surface, closing ? [...frames].reverse() : frames);
      const sourceLabel = origin!.querySelector<HTMLElement>("[data-bed-identity]");
      const targetLabel = dialog.querySelector<HTMLElement>("[data-bed-identity]");
      if (sourceLabel && targetLabel) {
        const a = sourceLabel.getBoundingClientRect();
        const b = targetLabel.getBoundingClientRect();
        const label = document.createElement("span");
        label.className = "tv-detail-morph-identity";
        label.textContent = targetLabel.textContent;
        label.setAttribute("aria-hidden", "true");
        Object.assign(label.style, {
          left: `${b.left}px`,
          top: `${b.top}px`,
          fontSize: getComputedStyle(targetLabel).fontSize,
        });
        document.body.append(label);
        ghosts.current.push(label);
        const labels = [
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, opacity: 0.85 },
          { transform: "none", opacity: 0 },
        ];
        animate(label, closing ? [...labels].reverse() : labels);
      }
      animate(
        dialog,
        closing ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
        { duration: closing ? 140 : 240, delay: closing ? 0 : 70, fill: "both" },
      );
    } else {
      const frames = [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "none" },
      ];
      finish = animate(dialog, closing ? [...frames].reverse() : frames, {
        duration: 180,
        fill: "both",
      });
    }
    finish.finished
      .then(() => {
        if (closing) onCloseRef.current();
        else cancel();
      })
      .catch(() => {});
    const resize = () => {
      cancel();
      if (closing) onCloseRef.current();
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancel();
    };
  }, [origin, closing, reduced, cancel]);

  const dismiss = useCallback(() => setClosing(true), []);
  useEffect(() => {
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== overlay &&
        !node.classList.contains("tv-detail-morph-surface") &&
        !node.classList.contains("tv-detail-morph-identity"),
    );
    const inert = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    document.body.style.overflow = "hidden";
    dialog.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], summary, [tabindex="0"]',
        ),
      ).filter((node) => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      background.forEach((node, index) => {
        node.inert = inert[index];
      });
      const restore = origin?.isConnected
        ? origin
        : previous?.isConnected
          ? previous
          : document.querySelector<HTMLElement>(".tv-terminal-page h1");
      if (restore) {
        const addedTabIndex = !restore.hasAttribute("tabindex") && restore.tagName === "H1";
        if (addedTabIndex) restore.tabIndex = -1;
        restore.focus({ preventScroll: true });
        if (addedTabIndex) restore.removeAttribute("tabindex");
      }
    };
  }, [origin, dismiss]);
  return { dialogRef, overlayRef, dismiss, closing };
}
