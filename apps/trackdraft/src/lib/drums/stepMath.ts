/**
 * The beat → cell mapping, for every drum surface (the block editor, the
 * read-only step grid, the console preview, the transition preview).
 *
 * It lives in `lib` rather than next to the editor because the *renderers* are
 * not the only consumers: anything that draws a cell, highlights a playhead or
 * writes a note has to agree on which cell owns which beat. It did not always:
 * the editor floored, `StepGrid` rounded, so the same section showed a note in
 * one cell in the editor and the next cell in the console — the same class of
 * "the cell I clicked isn't the one that changed" bug reported against the
 * sequencer.
 */

/**
 * How far ahead of a step boundary a hit may land and still belong to that
 * step. Real corpus performances sit a few milliseconds early or late
 * (`1.0437` for beat 1, `2.9958` for beat 3); without a snap those land one
 * cell to the left of where a drummer would read them.
 */
export const STEP_SNAP = 0.02;

/**
 * The ONE mapping from a beat to the cell that owns it.
 *
 * `floor`, not `round`: a step's cell starts at its beat, so the hit at 0.69
 * belongs to the cell that begins at 0 — which is also the range a toggle
 * writes its block over. Rounding instead put that hit in the *next* cell
 * while the write range still covered the previous one, so clicking the cell
 * you could see removed nothing and left the hit on screen: "the first cell
 * doesn't respond".
 */
export function stepIndexOf(beat: number, stepBeats: number): number {
  return Math.floor((beat + STEP_SNAP) / stepBeats);
}
