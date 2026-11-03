import { useSongStore } from "../store/songStore";
import { KEY_PRIORITY, useGlobalKeys } from "./useGlobalKeys";
import { undoIntent } from "../lib/undoShortcut";

/**
 * `⌘Z` / `⌘⇧Z` for the whole app (§polish).
 *
 * Registered at SHELL priority, which is the lowest — a surface that wants to
 * own the chord (an editor with its own history, say) can still claim it, and
 * the poly canvas's key map reads modifiers before this ever runs.
 *
 * Two rules worth stating:
 * - **`typing` wins.** In a text field the browser's own undo is the one the
 *   user means; hijacking it would undo the whole song instead of the last
 *   keystroke.
 * - **It consumes even at the ends of the history.** Otherwise the chord falls
 *   through to the browser, which on some pages offers to undo a form.
 */
export function useUndoKeys(): void {
  useGlobalKeys(({ event, typing }) => {
    if (typing) return;
    const intent = undoIntent(event);
    if (!intent) return;
    const store = useSongStore.getState();
    if (intent === "undo") store.undo();
    else store.redo();
    return true;
  }, KEY_PRIORITY.shell);
}
