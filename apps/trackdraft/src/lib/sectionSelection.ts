/**
 * Multi-section selection.
 *
 * The spine, the Studio arrangement timeline and the harmony page all read the
 * same selection, so the click semantics live here once: a plain click picks
 * one section, ⇧ extends from the anchor, ⌘ toggles, and a drag sweep is just
 * a run of "extend from the anchor" as the pointer crosses blocks.
 *
 * Sections are identified by id, but *order* is what makes a range meaningful
 * — the caller passes the section ids in song order.
 */

export type SelectionMode = "replace" | "toggle" | "extend";

export interface SelectionState {
  /** Ordered by song order, without duplicates. */
  selected: string[];
  /** Where a ⇧-click or a sweep measures from. */
  anchor: string | null;
  /** The section the single-section views follow. */
  focus: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: [], anchor: null, focus: null };

/** Sections between `from` and `to` inclusive, in song order. */
export function rangeIds(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return order.includes(to) ? [to] : [];
  const [start, end] = a <= b ? [a, b] : [b, a];
  return order.slice(start, end + 1);
}

export function selectSections(
  state: SelectionState,
  id: string,
  mode: SelectionMode,
  order: readonly string[],
): SelectionState {
  if (!order.includes(id)) return state;

  if (mode === "toggle") {
    if (state.selected.includes(id)) {
      const selected = state.selected.filter((entry) => entry !== id);
      return {
        selected,
        anchor: state.anchor === id ? (selected[0] ?? null) : state.anchor,
        focus: state.focus === id ? (selected[selected.length - 1] ?? null) : state.focus,
      };
    }
    return {
      selected: order.filter((entry) => entry === id || state.selected.includes(entry)),
      anchor: state.anchor ?? id,
      focus: id,
    };
  }

  if (mode === "extend") {
    const from = state.anchor ?? state.focus ?? id;
    return { selected: rangeIds(order, from, id), anchor: from, focus: id };
  }

  return { selected: [id], anchor: id, focus: id };
}

/** Keep a selection valid after sections are added, split, reordered or
 *  deleted — stray ids would make the stack show sections that are gone. */
export function reconcileSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const selected = order.filter((id) => state.selected.includes(id));
  if (selected.length === state.selected.length && state.anchor && order.includes(state.anchor)) return state;
  const focus = state.focus && order.includes(state.focus) ? state.focus : (selected[selected.length - 1] ?? null);
  return {
    selected,
    anchor: state.anchor && order.includes(state.anchor) ? state.anchor : (focus ?? null),
    focus,
  };
}

/** Repeats shared by every section in the selection, or null when they differ. */
export function sharedRepeats(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.every((value) => value === values[0]) ? values[0] : null;
}
