import { useEffect, useRef, type RefObject } from "react";

export interface PinchZoomInfo {
  /** Incremental factor since the previous move event (1 = no change). */
  scale: number;
  /** Focal point in element-local pixels. */
  focalX: number;
}

/**
 * Two-finger pinch-to-zoom for a horizontal timeline, with the same
 * cursor-anchored behavior as the wheel. Touch-only on purpose: pointer
 * events on the editing canvases stay reserved for single-finger editing,
 * so a pinch can't be mistaken for a marquee.
 *
 * The element gets `touch-action: pan-x`, which keeps native horizontal
 * panning (and momentum) while letting us own the pinch gesture instead of
 * the browser zooming the page.
 */
export function usePinchToZoom(
  targetRef: RefObject<HTMLElement | null>,
  onPinch: (info: PinchZoomInfo) => void,
  options: { onPinchStart?: () => void } = {},
): void {
  const onPinchRef = useRef(onPinch);
  onPinchRef.current = onPinch;
  const onStartRef = useRef(options.onPinchStart);
  onStartRef.current = options.onPinchStart;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const previousTouchAction = el.style.touchAction;
    el.style.touchAction = "pan-x";

    let pinching = false;
    let previousDistance = 0;

    const distance = (touches: TouchList): number =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const focalX = (touches: TouchList): number => {
      const rect = el.getBoundingClientRect();
      return (touches[0].clientX + touches[1].clientX) / 2 - rect.left;
    };

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) return;
      pinching = true;
      previousDistance = distance(event.touches);
      onStartRef.current?.();
    }

    function onTouchMove(event: TouchEvent) {
      if (!pinching || event.touches.length !== 2) return;
      event.preventDefault();
      const next = distance(event.touches);
      if (previousDistance <= 0 || next <= 0) {
        previousDistance = next;
        return;
      }
      const scale = next / previousDistance;
      previousDistance = next;
      if (Math.abs(scale - 1) < 0.001) return;
      onPinchRef.current({ scale, focalX: focalX(event.touches) });
    }

    function endPinch(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinching = false;
        previousDistance = 0;
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", endPinch, { passive: true });
    el.addEventListener("touchcancel", endPinch, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", endPinch);
      el.removeEventListener("touchcancel", endPinch);
      el.style.touchAction = previousTouchAction;
    };
  }, [targetRef]);
}
