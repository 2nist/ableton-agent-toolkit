/**
 * Melody layer — the Bend "Contour" axis applied to a captured line.
 *
 * Same DAW-agnostic, numeric style as bass.ts: no schema imports, pure
 * pitch transforms over any note shape with a `pitch` field. Shared by
 * the app's export/live-out paths (and future bridge support), so a bend
 * resolves identically everywhere.
 */

export interface MelodyNoteLike {
  pitch: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Apply the Bend melody-contour axis to a note list (pitch edits only;
 *  every other field rides through untouched via spread — the input
 *  objects are never mutated when nothing changes).
 *
 *  Toward CONJUNCT (<0.5): leaps are folded toward steps — each interval
 *  is limited to 5 semitones just below neutral, tightening to 2 at the
 *  extreme, direction preserved (a leap up stays a step up).
 *
 *  Toward DISJUNCT (>0.5): intervals are stretched (up to ~2× at the
 *  extreme) with a 14-semitone cap, so the line grows angular without
 *  becoming unsingable. The generator applies this once and marks the track
 *  `contourApplied`, so the stem never shapes it twice.
 *
 *  Exactly 0.5 (or absent): untouched — same array reference. */
export function styleMelodyLine<T extends MelodyNoteLike>(
  notes: T[],
  contour: number | undefined,
): T[] {
  const c = clamp01(contour ?? 0.5);
  if (notes.length === 0 || Math.abs(c - 0.5) < 1e-9) return notes;

  let prev = notes[0]!.pitch;

  if (c > 0.5) {
    const factor = 1 + (c - 0.5) * 2; // 1..2
    return notes.map((n, i) => {
      if (i === 0) return n;
      const interval = n.pitch - prev;
      const stretched =
        Math.sign(interval) * Math.min(14, Math.round(Math.abs(interval) * factor));
      const pitch = Math.max(0, Math.min(127, prev + stretched));
      prev = pitch;
      return pitch === n.pitch ? n : { ...n, pitch };
    });
  }

  const strength = (0.5 - c) * 2; // 0..1 as the slider reaches "conjunct"
  const limit = 5 - 3 * strength; // 5 st → 2 st

  return notes.map((n, i) => {
    let pitch = n.pitch;
    if (i > 0) {
      const iv = pitch - prev;
      if (Math.abs(iv) > limit) {
        pitch = prev + Math.sign(iv) * Math.round(limit);
      }
    }
    prev = pitch;
    return pitch === n.pitch ? n : { ...n, pitch };
  });
}
