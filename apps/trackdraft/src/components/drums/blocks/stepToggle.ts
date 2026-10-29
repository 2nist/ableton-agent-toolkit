import type { BlueprintSection, DrumBlock, DrumBlockNote, DrumVoiceName } from "../../../types/blueprint";
import type { BlueprintSong } from "../../../types/blueprint";
import { DRUM_LANE_PRIMARY } from "@drum/library";
import { resolveSectionLaneHits } from "../../../lib/timeline/drumLaneHits";
import { upsertModeBlocks } from "./selectionMath";
import type { DrumLaneId } from "../../../types/blueprint";
import { stepIndexOf } from "./meterGrid";

const round4 = (n: number) => Math.round(n * 10000) / 10000;
/**
 * One note per step for the hits a block covers, excluding `skipStep`.
 *
 * Corpus hits sit a few thousandths off the grid (`1.0146` for beat 1) and a
 * coarse view can hold several of them in one step. Copying those beats
 * verbatim wrote notes at 0.0146 and 0.9958 — notes in the wrong cell, which
 * is the "I clicked one cell and it changed another" report. Collapsing each
 * step to its own beat, keeping the loudest hit's voice and velocity, is what
 * the grid is actually showing.
 */
export function notesFromHits(
  hits: readonly { beat: number; voice: string; velocity: number }[],
  start: number,
  stepSize: number,
  skipStep?: number,
): DrumBlockNote[] {
  const byStep = new Map<number, { voice: string; velocity: number }>();
  for (const h of hits) {
    const step = stepIndexOf(h.beat, stepSize);
    if (skipStep !== undefined && step === skipStep) continue;
    const prev = byStep.get(step);
    if (!prev || h.velocity > prev.velocity) byStep.set(step, { voice: h.voice, velocity: h.velocity });
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, best]) => ({
      beat: round4(step * stepSize - start),
      voice: best.voice as DrumVoiceName,
      velocity: best.velocity,
    }));
}


/**
 * Flip one step on a lane — the write both sequencer views share.
 *
 * Lifted out of the Blocks view when the Steps view was added: two views
 * writing hits two different ways is how a pattern ends up looking different
 * from how it sounds. "Toggle" means *this step*, everywhere:
 *
 *  - no hit there → add one with the lane's primary voice at the average
 *    velocity already in the block (so a row of clicks stays even);
 *  - a hit there → drop every voice on that step (the delete gesture).
 *
 * The block is widened to an existing `steps` block covering the beat when
 * there is one, so repeated clicks grow a range rather than scattering
 * single-step blocks with different ids.
 */
export function stepToggleBlock({
  section,
  song,
  occurrenceIndex,
  laneKey,
  beat,
  stepSize,
}: {
  section: BlueprintSection;
  song?: BlueprintSong;
  occurrenceIndex: number;
  laneKey: DrumLaneId;
  beat: number;
  stepSize: number;
}): { block: DrumBlock; startBeat: number; endBeat: number } {
  const hits = resolveSectionLaneHits(section, song, occurrenceIndex);
  const laneHits = hits.get(laneKey) ?? [];
  const existing = (section.drumBlocks ?? []).find(
    (b) => b.mode === "steps" && b.lane === laneKey && beat >= b.startBeat - 1e-9 && beat < b.endBeat - 1e-9,
  );
  const start = existing ? existing.startBeat : beat;
  const end = existing ? existing.endBeat : round4(beat + stepSize);
  const inRange = laneHits.filter((h) => h.beat >= start - 1e-9 && h.beat < end - 1e-9);
  // "This cell" means the cell the view DRAWS — same index function, so a
  // click always acts on what is visible under the pointer. Off-grid hits
  // (drawn as diamonds) are not this cell's to remove.
  const stepIdx = stepIndexOf(beat, stepSize);
  const ownsHit = (h: { beat: number }) => stepIndexOf(h.beat, stepSize) === stepIdx;
  const hasHit = laneHits.some(ownsHit);

  const newHit = (): DrumBlockNote => {
    const avg = inRange.length > 0
      ? Math.round(inRange.reduce((sum, h) => sum + h.velocity, 0) / inRange.length)
      : 100;
    return { beat: round4(beat - start), voice: DRUM_LANE_PRIMARY[laneKey] as DrumVoiceName, velocity: avg };
  };

  // An authored block is edited NOTE-WISE, not rebuilt from the compiled
  // hits. Rebuilding used to bake every step parameter into plain notes the
  // first time you toggled anything in the block — a ratchet became two
  // hits, a flam became a grace note at a fixed offset, a probability was
  // resolved for good — so "toggle one cell" silently flattened the rest.
  let notes: DrumBlockNote[];
  if (existing && existing.notes && existing.notes.length > 0) {
    const authored = existing.notes;
    const rest = authored.filter((n) => !ownsHit({ beat: start + n.beat })).map((n) => ({ ...n }));
    notes = hasHit ? rest : [...rest, newHit()];
  } else {
    // Materialise the block's other steps so later edits stay note-wise.
    notes = notesFromHits(inRange, start, stepSize, stepIdx);
    if (!hasHit) notes.push(newHit());
  }

  return {
    startBeat: start,
    endBeat: end,
    block: {
      id: existing?.id ?? `blk-${laneKey}-${round4(start)}-${round4(end)}-steps`,
      lane: laneKey,
      startBeat: start,
      endBeat: end,
      mode: "steps",
      notes,
    },
  };
}

/** The whole write: the flipped block merged back into the section. */
export function withToggledStep(
  section: BlueprintSection,
  args: Parameters<typeof stepToggleBlock>[0],
): BlueprintSection {
  const { block, startBeat, endBeat } = stepToggleBlock(args);
  return { ...section, drumBlocks: upsertModeBlocks(section.drumBlocks, startBeat, endBeat, [block]) };
}
