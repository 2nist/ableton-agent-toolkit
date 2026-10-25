import { useEffect, useRef } from "react";

/**
 * Keyboard for the section selection: ⌘A selects every section, Escape drops a
 * multi-selection back to the focused one, ←/→ (or ↑/↓) walk the song and
 * ⇧ with either extends the range.
 *
 * Scoped to the page that owns the selection rather than bound globally: the
 * arrow keys belong to whatever editor has focus everywhere else, and ⌘A has
 * to stay "select all the text" inside a field.
 */
export interface SectionShortcuts {
  /** Section ids in song order. */
  order: readonly string[];
  focusedId: string | null;
  onFocus: (sectionId: string) => void;
  onExtendTo: (sectionId: string) => void;
  onSelectAll: () => void;
  onCollapse: () => void;
}

/** One thing a key press means for the section selection. */
export type SectionShortcut =
  | { kind: "all" }
  | { kind: "collapse" }
  | { kind: "focus"; sectionId: string }
  | { kind: "extend"; sectionId: string };

/**
 * The key map on its own, so it can be read and tested without a DOM: which
 * arrow lands where, and what ⌘A/Escape mean. Shift is the only modifier that
 * changes the *verb* (focus vs extend); ⌘/⌃ are reserved for the select-all.
 */
export function sectionShortcutFor(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  context: { order: readonly string[]; focusedId: string | null },
): SectionShortcut | null {
  const { order, focusedId } = context;
  if (order.length === 0) return null;

  if (event.metaKey || event.ctrlKey) {
    return event.key.toLowerCase() === "a" && !event.altKey && !event.shiftKey ? { kind: "all" } : null;
  }
  if (event.altKey) return null;
  if (event.key === "Escape") return { kind: "collapse" };

  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return null;
  const index = focusedId ? order.indexOf(focusedId) : -1;
  const next = order[Math.max(0, Math.min(order.length - 1, index + step))];
  if (!next || next === focusedId) return null;
  return event.shiftKey ? { kind: "extend", sectionId: next } : { kind: "focus", sectionId: next };
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

export function useSectionShortcuts(shortcuts: SectionShortcuts): void {
  // Latest handlers in a ref: the listener stays mounted across renders
  // instead of being torn down on every song edit.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTyping(event.target)) return;
      const { order, focusedId, onFocus, onExtendTo, onSelectAll, onCollapse } = latest.current;
      const shortcut = sectionShortcutFor(event, { order, focusedId });
      if (!shortcut) return;
      // Escape is not swallowed: it is the app's "get me out" key everywhere.
      if (shortcut.kind !== "collapse") event.preventDefault();
      if (shortcut.kind === "all") onSelectAll();
      else if (shortcut.kind === "collapse") onCollapse();
      else if (shortcut.kind === "focus") onFocus(shortcut.sectionId);
      else onExtendTo(shortcut.sectionId);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
