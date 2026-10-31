import { useEffect, useRef } from "react";

/**
 * One keyboard registry for the whole app.
 *
 * Before this, twelve components each added their own `window.addEventListener
 * ("keydown")`. Two of them — the spine and the drums blocks editor — both
 * claimed `Escape`, so one press cleared two different selections because the
 * order depended on mount order. Nothing could answer "who owns Space?".
 *
 * This module installs exactly one listener and dispatches to a priority
 * stack. A handler returns `true` to consume the event; the first one that
 * does wins and the rest never see it. That is the whole arbitration model —
 * there is no modifier soup and no per-view enable flag.
 *
 * Priorities (higher runs first):
 *   OVERLAY — a modal or an exploded editor owns the screen
 *   SURFACE — the focused editing surface (a lane grid, a note editor)
 *   SHELL   — the transport and song-level navigation
 */
export const KEY_PRIORITY = {
  overlay: 100,
  surface: 50,
  shell: 0,
} as const;

export interface KeyContext {
  event: KeyboardEvent;
  /** True when focus is in a text field. Most handlers bail on this. */
  typing: boolean;
}

/** Return `true` to consume the event and stop the stack. */
export type KeyHandler = (context: KeyContext) => boolean | void;

interface Entry {
  handler: KeyHandler;
  priority: number;
  /** Registration order, so equal priorities pop last-in-first-out. */
  seq: number;
}

const entries: Entry[] = [];
let seq = 0;
let installed = false;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

function dispatch(event: KeyboardEvent): void {
  if (entries.length === 0) return;
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.seq - a.seq,
  );
  const context: KeyContext = { event, typing: isTypingTarget(event.target) };
  for (const entry of ordered) {
    if (entry.handler(context) === true) {
      event.preventDefault();
      return;
    }
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", dispatch);
}

/**
 * Register a handler for as long as the component is mounted.
 *
 * The handler is read through a ref, so a new closure each render does not
 * re-register (and cannot fall out of sync with the stack).
 */
export function useGlobalKeys(
  handler: KeyHandler,
  priority: number = KEY_PRIORITY.surface,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      registerKeyHandler(
        // Indirection, not the handler itself: the latest render's closure runs.
        (context) => handlerRef.current(context),
        priority,
      ),
    [priority],
  );
}

/**
 * The stack API behind `useGlobalKeys`, exported so the arbitration rules can
 * be tested without mounting React. Returns an unsubscribe function.
 */
export function registerKeyHandler(
  handler: KeyHandler,
  priority: number = KEY_PRIORITY.surface,
): () => void {
  install();
  const entry: Entry = { handler, priority, seq: seq++ };
  entries.push(entry);
  return () => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  };
}
