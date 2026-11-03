/**
 * What the section menu can offer, and why it cannot offer the rest.
 *
 * The menu is the only reachable home for split/merge/park/delete on a touch
 * screen, so every disabled row has to carry the reason on its own face — a
 * greyed-out "Split" with no hint is a dead end. Keeping the rules here (rather
 * than inline in the view) means the "playhead has to be inside the section"
 * case is a test, not a judgement call made while rendering.
 */

export interface SectionMenuInput {
  /** Where the section starts, in beats from the top of the song. */
  startBeat: number;
  /** The section's length in bars. */
  bars: number;
  /** Mean beats per bar — sections with a meter map still answer one number. */
  beatsPerBar: number;
  playheadBeat: number;
  /** False on the last section, where there is nothing to merge into. */
  hasNext: boolean;
  parked: boolean;
}

export interface SectionMenuState {
  /** The bar the cut would land on, clamped into the section. 0 = no cut. */
  splitBar: number;
  canSplit: boolean;
  /** Why split is unavailable, in the cue column. Empty when it is available. */
  splitHint: string;
  canMerge: boolean;
  parked: boolean;
  /** The one row that reads differently depending on where the section is. */
  parkLabel: string;
}

export function sectionMenuState({
  startBeat,
  bars,
  beatsPerBar,
  playheadBeat,
  hasNext,
  parked,
}: SectionMenuInput): SectionMenuState {
  // A section may be an odd number of beats long, and the meter map is not
  // consulted: the menu asks "which bar is the playhead in", and a bar is the
  // unit a cut can land on.
  const raw =
    beatsPerBar > 0
      ? Math.floor((playheadBeat - startBeat) / beatsPerBar)
      : Number.NEGATIVE_INFINITY;
  // Splitting at bar 0 or at the very end is not a split: it would leave one
  // half empty. Both are reported as "no cut", with the reason in the hint.
  const canSplit = raw >= 1 && raw < Math.max(1, bars);
  const splitBar = canSplit ? raw : 0;
  const splitHint = canSplit
    ? `bar ${raw}`
    : raw < 1
      ? "playhead first"
      : "past the end";

  return {
    splitBar,
    canSplit,
    splitHint,
    canMerge: hasNext,
    parked,
    parkLabel: parked ? "Take off the shelf" : "Park on shelf",
  };
}
