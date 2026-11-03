/**
 * What a modifier-Z means, if anything (§polish).
 *
 * The app had no undo shortcut at all: `Spine` renders an Undo button and that
 * was the only way back, on a surface where every edit is one history step
 * precisely so that undo is cheap. Worse, the poly canvas's key map
 * early-returns on any modifier, so `⌘Z` did nothing *and* did not fall through
 * to anything else.
 *
 * Kept as a pure decision so the mapping is a test rather than a handler with
 * four `if`s in it — and so the same answer is available to any surface that
 * wants to advertise the shortcut.
 */

export type UndoIntent = "undo" | "redo" | null;

type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

/**
 * `⌘Z` / `Ctrl+Z` undo; `⌘⇧Z` and `Ctrl+Y` redo.
 *
 * Both redo spellings, because the app runs on both platforms and a keyboard
 * that does the wrong thing is worse than one that does nothing. A bare `z`
 * (the canvas's "jump to the focused node") is not an undo intent.
 */
export function undoIntent(event: ShortcutEvent): UndoIntent {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === "y") return "redo";
  if (key !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
}

/** How to say the shortcut on this platform. */
export function undoShortcutLabel(
  platform: string = typeof navigator === "undefined" ? "" : navigator.platform,
): { undo: string; redo: string } {
  const mac = /mac|iphone|ipad/i.test(platform);
  return mac
    ? { undo: "⌘Z", redo: "⇧⌘Z" }
    : { undo: "Ctrl+Z", redo: "Ctrl+Y" };
}
