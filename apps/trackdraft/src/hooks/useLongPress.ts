import { useCallback, useEffect, useRef } from "react";

/**
 * Press-and-hold, for the actions that only a modifier used to reach.
 *
 * `⌥`-click and right-click are the classic "there is more here" gestures and
 * they are both mouse-only: a finger has no option key and a trackpad user has
 * to be told. A hold is the one secondary gesture every pointer type has, so the
 * canvas offers it everywhere a modifier would otherwise be required (§0.14).
 *
 * The timer is cancelled by movement, by release, and on unmount, so a hold can
 * never fire after a drag has started or after the pointer has left.
 */
export const LONG_PRESS_MS = 450;
/** Movement beyond this many pixels means the gesture was a drag, not a hold. */
export const LONG_PRESS_SLOP = 6;

/** Just the DOM-facing half — spread this, not the whole object. */
export interface LongPressDomHandlers {
  onPointerDown: (event: { clientX: number; clientY: number }) => void;
  onPointerMove: (event: { clientX: number; clientY: number }) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
}

export interface LongPressHandlers extends LongPressDomHandlers {
  /**
   * True once, if a hold just fired — so the `click` that follows the release
   * can be ignored. Without it, "hold to solo" would solo and then also mute,
   * because a release is a click.
   */
  suppressClick: () => boolean;
  /** The same handlers, packaged for a JSX spread that must not leak props. */
  handlers: LongPressDomHandlers;
}

/**
 * @param onLongPress called once, with the point the press started at.
 * @param options `enabled: false` leaves the handlers inert — used when the
 *   element is not the one the gesture should apply to (an unarmed lane, a
 *   column that is being dragged).
 */
export function useLongPress(
  onLongPress: (at: { x: number; y: number }) => void,
  options: { enabled?: boolean; delay?: number } = {},
): LongPressHandlers {
  const { enabled = true, delay = LONG_PRESS_MS } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const handlers: LongPressDomHandlers = {
    onPointerDown: (event) => {
      if (!enabled) return;
      clear();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        const at = origin.current;
        timer.current = null;
        origin.current = null;
        if (!at) return;
        fired.current = true;
        callback.current({ x: at.x, y: at.y });
      }, delay);
    },
    onPointerMove: (event) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > LONG_PRESS_SLOP ||
        Math.abs(event.clientY - start.y) > LONG_PRESS_SLOP
      )
        clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
  };

  return {
    ...handlers,
    handlers,
    suppressClick: () => {
      if (!fired.current) return false;
      fired.current = false;
      return true;
    },
  };
}
