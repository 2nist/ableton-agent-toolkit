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
 *  0.5 and above: untouched. The disjunct side is deliberately reserved
 *  until a melody *generator* exists — captured lines already sit where
 *  the player put them, and stretching intervals would rewrite intent. */
export function styleMelodyLine<T extends MelodyNoteLike>(
  notes: T[],
  contour: number | undefined,
): T[] {
  const c = clamp01(contour ?? 0.5);
  if (c >= 0.5 || notes.length === 0) return notes;

  const strength = (0.5 - c) * 2; // 0..1 as the slider reaches "conjunct"
  const limit = 5 - 3 * strength; // 5 st → 2 st

  let prev = notes[0]!.pitch;
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
