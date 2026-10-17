/**
 * Chord-list editing helpers for the merged progression editor: the effect
 * cycle that used to live inside `ProgressionTrack`, and the reorder math
 * (which slot a pointer is over, and how to move a chord there).
 *
 * Reorder is a plain array move rather than a drag-and-drop library: the
 * editor already owns a pointer-capture gesture system for resizing, and
 * running two systems over the same pixels is what made reorder and resize
 * fight each other.
 */

import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";

/** none → strum → pulse → arp → none, matching the old effects lane. */
export const EFFECT_CYCLE: (ChordPerformanceEffect | undefined)[] = [
  undefined,
  { style: "strum" },
  { style: "pulse" },
  { style: "arp" },
];

/** Cycle a chord's performance effect through none → strum → pulse → arp. */
export function nextPerformanceEffect(
  current: ChordPerformanceEffect | undefined,
): ChordPerformanceEffect | undefined {
  const index = EFFECT_CYCLE.findIndex(
    (effect) => effect?.style === current?.style && (effect === undefined) === (current === undefined),
  );
  return EFFECT_CYCLE[(index + 1) % EFFECT_CYCLE.length];
}

/** A chord's span inside one cycle, in beats from the cycle start. */
export interface CycleCell {
  start: number;
  end: number;
}

/**
 * Which slot a pointer beat falls into for a REORDER: the insertion index
 * runs 0..n and flips when the pointer passes a chord's midpoint, so the drop
 * lands where the caret is drawn.
 */
export function insertionIndexAt(cells: CycleCell[], beat: number): number {
  let index = 0;
  for (const cell of cells) {
    if (beat > cell.start + (cell.end - cell.start) / 2) index += 1;
  }
  return index;
}

/**
 * Move the chord at `from` into `insertionIndex` (the 0..n caret position
 * from `insertionIndexAt`). Returns the same array when nothing would change.
 */
export function moveChord(chords: Chord[], from: number, insertionIndex: number): Chord[] {
  if (chords.length < 2 || from < 0 || from >= chords.length) return chords;
  const target = Math.max(0, Math.min(chords.length, insertionIndex));
  // Removing the chord first shifts everything after it down one slot.
  const to = target > from ? target - 1 : target;
  if (to === from) return chords;
  const next = [...chords];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
