import type { DrumBlock, DrumBlockNote, DrumLaneId } from "../../types/blueprint";

/**
 * One lane's figure, as a block that covers the section.
 *
 * The feel lens can be scoped to a single drum — "show me every kick figure in
 * the library". Picking one there must mean *that kick*, not "load this
 * pattern's whole groove": the point is to assemble a beat lane by lane, kick
 * from one pattern, snare from another. `applyDrumBlocks` already gives us the
 * mechanism (`spliceLane` replaces one lane family inside a block's range and
 * leaves every other lane alone), so a lane pick is a single section-wide
 * `steps` block holding the figure tiled across the section.
 *
 * `startBeat: 0` matters: block notes are relative to the block's start, and
 * a full-section block makes them section-relative, which is what the step grid
 * draws.
 */
export function laneFigureBlock(args: {
  lane: DrumLaneId;
  /** The figure, as beats inside one loop of `lengthBeats`. */
  notes: readonly DrumBlockNote[];
  /** Length of one repeat of the figure, in beats. */
  lengthBeats: number;
  /** The section's length, in beats. */
  durationBeats: number;
}): DrumBlock | null {
  const { lane, notes, lengthBeats, durationBeats } = args;
  if (notes.length === 0 || lengthBeats <= 0 || durationBeats <= 0) return null;

  const tiled: DrumBlockNote[] = [];
  for (let base = 0; base < durationBeats - 1e-9; base += lengthBeats) {
    for (const note of notes) {
      const beat = Math.round((base + note.beat) * 10000) / 10000;
      if (beat >= durationBeats - 1e-9) continue;
      tiled.push({ ...note, beat });
    }
  }
  if (tiled.length === 0) return null;

  return {
    id: `blk-${lane}-0-${Math.round(durationBeats * 10000) / 10000}-steps`,
    lane,
    startBeat: 0,
    endBeat: Math.round(durationBeats * 10000) / 10000,
    mode: "steps",
    notes: tiled,
  };
}
