/**
 * Timing helpers for loop-recording a melody section — when the section
 * loops while the user records, the wall-clock capture keeps growing past
 * the section length, so the notes need to be folded back into the section
 * window and merged across passes.
 */

import type { MelodyNote } from "../../types/blueprint";

/**
 * Fold song-position notes (already made section-relative by the caller)
 * into the section window [0, spanBeats) — for loop recording, notes from
 * later passes land on the same section-relative beats as the first pass.
 * Negative times (a note captured before the anchor) are dropped.
 */
export function foldNotesToSection(notes: MelodyNote[], spanBeats: number): MelodyNote[] {
  if (spanBeats <= 0) return [];
  // Notes captured before the anchor are unreliable — drop them rather
  // than folding a negative time onto the section's tail.
  return notes
    .filter((n) => n.startTime >= 0)
    .map((n) => ({ ...n, startTime: ((n.startTime % spanBeats) + spanBeats) % spanBeats }));
}

/**
 * First-wins de-duplication: drop a note if an earlier one starts within
 * `tolerance` beats — merges repeated passes of the same phrase into a
 * single line instead of stacking duplicate notes at the same spot.
 * Returns notes sorted by start time.
 */
export function dedupeNotes(notes: MelodyNote[], tolerance = 0.25): MelodyNote[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);
  const kept: MelodyNote[] = [];
  for (const n of sorted) {
    if (kept.some((k) => Math.abs(k.startTime - n.startTime) <= tolerance)) continue;
    kept.push(n);
  }
  return kept;
}
