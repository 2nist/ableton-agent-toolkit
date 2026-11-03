import {
  DRUM_LANE_PRIMARY,
  type DrumLaneId,
  type KitVoice,
} from "@drum/library";
import type { DrumBlock, DrumBlockNote } from "../../types/blueprint";

/**
 * Painting one step of a drum lane.
 *
 * The drums lane draws each voice's Euclidean necklace, so a "step" is the
 * necklace's step, not a sixteenth of the bar. Toggling one authors — or
 * clears — a `steps` block over **exactly that step's beat window**, which is
 * how the existing layer already works: `applyDrumBlocks` splices the lane's
 * notes inside a block's range and inserts the block's own, so a one-note block
 * adds one hit and an empty block silences that window. Everything outside it,
 * and every other lane, is untouched — no groove is baked, no dynamics lost.
 *
 * The full writer for this lives in the Drum Blocks surface
 * (`components/drums/blocks/selectionMath.ts`) and carries range-FX adoption,
 * interleave clusters and selection maths. A single painted step has none of
 * those, so this keeps its own id-keyed upsert rather than importing a
 * component into the lib — the block ID is the same convention, so a painted
 * step and a stepped cell over there address the same block.
 */

/** Neutral velocity, the same fallback `euclidPatternNotes` uses when a voice
 *  had nothing to inherit from. */
const PAINT_VELOCITY = 100;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface DrumStepWindow {
  startBeat: number;
  endBeat: number;
}

/** Which slice of the section a necklace step owns. */
export function drumStepWindow(
  durationBeats: number,
  columns: number,
  index: number,
): DrumStepWindow {
  const count = Math.max(1, Math.round(columns));
  const step = Math.max(0, durationBeats) / count;
  const clamped = Math.max(0, Math.min(count - 1, Math.round(index)));
  return {
    startBeat: round4(clamped * step),
    endBeat: round4((clamped + 1) * step),
  };
}

export function stepsBlockId(
  lane: DrumLaneId,
  startBeat: number,
  endBeat: number,
): string {
  return `blk-${lane}-${round4(startBeat)}-${round4(endBeat)}-steps`;
}

export interface DrumStepEdit extends DrumStepWindow {
  lane: DrumLaneId;
  /** Paint it in (`true`) or take it out (`false`). */
  on: boolean;
  /** Overrides the lane's primary voice — unused today, but the lane's family
   *  is more than one voice and every block note names one. */
  voice?: KitVoice;
  velocity?: number;
}

/**
 * The blocks array with this step painted or cleared.
 *
 * A painted step is one note at the window's start; a cleared one is the same
 * block with no notes, which `spliceLane` reads as "this lane is silent here".
 */
export function toggleDrumStep(
  blocks: DrumBlock[] | undefined,
  edit: DrumStepEdit,
): DrumBlock[] {
  const { lane, startBeat, endBeat, on } = edit;
  if (!(endBeat > startBeat)) return blocks ?? [];
  const notes: DrumBlockNote[] = on
    ? [
        {
          beat: 0,
          voice: edit.voice ?? DRUM_LANE_PRIMARY[lane],
          velocity: edit.velocity ?? PAINT_VELOCITY,
        },
      ]
    : [];
  const block: DrumBlock = {
    id: stepsBlockId(lane, startBeat, endBeat),
    lane,
    startBeat,
    endBeat,
    mode: "steps",
    notes,
  };
  const byId = new Map((blocks ?? []).map((entry) => [entry.id, entry]));
  byId.set(block.id, block);
  return [...byId.values()];
}

/** The shortest gate a hit can hold — about a 32nd at 120 BPM. Below this the
 *  block is unplayable and `stepsBlockNotes` would floor it anyway. */
export const MIN_DRUM_GATE = 0.05;

/** How many sub-hits a step's gate can be split into. Four is a drum roll at
 *  the finest a bar-wide cell can show without the marks merging. */
export const MAX_RATCHET = 4;

/** The ratchet ladder, coarsest first — the order a click walks it. */
export const RATCHET_LADDER = [1, 2, 3, 4] as const;

/** The next ratchet after `current`, wrapping 4 → 1. */
export function nextRatchet(current: number | undefined): number {
  const held = Math.max(1, Math.min(MAX_RATCHET, Math.round(current ?? 1)));
  const at = RATCHET_LADDER.indexOf(held as 1 | 2 | 3 | 4);
  return RATCHET_LADDER[(at + 1) % RATCHET_LADDER.length];
}

/** What the author said about one painted step. Absent fields are the defaults
 *  the planner already applies, so this is never a "missing step". */
export interface DrumStepAuthored {
  /** How long it holds, in beats. Absent → the block grid, one cell. */
  gate?: number;
  /** Sub-hits packed into the gate (1..4). */
  ratchet: number;
  /** Grace note a hair before the step. */
  flam: boolean;
  /** Keep probability 0..1. */
  prob: number;
}

/**
 * Which of a lane's cells carry an authored `steps` block.
 *
 * A painted step is the only cell whose gate the canvas is allowed to edit: the
 * rest of the row is the generated groove, and re-gating one hit of it would
 * mean baking a block that silently replaces the groove under that window. So
 * the handle appears where the author put a step and nowhere else.
 */
export function authoredSteps(
  blocks: DrumBlock[] | undefined,
  lane: DrumLaneId,
  durationBeats: number,
  columns: number,
): (DrumStepAuthored | null)[] {
  const count = Math.max(1, Math.round(columns));
  const out = new Array<DrumStepAuthored | null>(count).fill(null);
  const step = Math.max(0, durationBeats) / count;
  if (!(step > 0)) return out;
  for (const block of blocks ?? []) {
    if (block.lane !== lane || block.mode !== "steps") continue;
    const note = block.notes?.[0];
    if (!note) continue;
    // Only the canvas's own one-step blocks: a range block from the Drum Blocks
    // surface also starts in some cell, but the writers here address blocks by
    // their step id, so offering controls there would be dead controls.
    if (stepsBlockId(lane, block.startBeat, block.endBeat) !== block.id)
      continue;
    const index = Math.floor(block.startBeat / step + 1e-6);
    if (index < 0 || index >= count) continue;
    out[index] = {
      ...(note.durBeats !== undefined ? { gate: note.durBeats } : {}),
      ratchet: Math.max(
        1,
        Math.min(MAX_RATCHET, Math.round(note.ratchet ?? 1)),
      ),
      flam: note.flam === true,
      prob: note.prob ?? 1,
    };
  }
  return out;
}

/** The painted note in this window, or `undefined` when the window holds no
 *  authored hit. */
export function paintedStep(
  blocks: DrumBlock[] | undefined,
  lane: DrumLaneId,
  window: DrumStepWindow,
): DrumBlockNote | undefined {
  const id = stepsBlockId(lane, window.startBeat, window.endBeat);
  return (blocks ?? []).find((block) => block.id === id)?.notes?.[0];
}

/** The gate the author gave the painted step, in beats — or `undefined` when
 *  the window holds no painted hit *or* the hit still holds its default.
 *
 *  Those are two different things: `paintedStep` says whether there is a hit to
 *  re-gate, this says whether anyone has said how long it is. A freshly painted
 *  step has no `durBeats` and plays for the block grid — that is a gate of one
 *  cell, not a missing step. */
export function drumStepGate(
  blocks: DrumBlock[] | undefined,
  lane: DrumLaneId,
  window: DrumStepWindow,
): number | undefined {
  return paintedStep(blocks, lane, window)?.durBeats;
}

/**
 * Change a painted step's feel — ratchet, flam, keep probability.
 *
 * A field set back to its default is REMOVED rather than stored, so a step you
 * cycled back to ×1 is byte-identical to a step you never touched. That keeps
 * the authored array small and keeps `patchPaintedStep` idempotent, which is
 * what makes a click cycle safe to undo.
 */
export function patchPaintedStep(
  blocks: DrumBlock[] | undefined,
  edit: DrumStepWindow & {
    lane: DrumLaneId;
    patch: { ratchet?: number; flam?: boolean; prob?: number };
  },
): DrumBlock[] | undefined {
  const id = stepsBlockId(edit.lane, edit.startBeat, edit.endBeat);
  const list = blocks ?? [];
  const index = list.findIndex((block) => block.id === id);
  if (index < 0) return blocks;
  const note = list[index].notes?.[0];
  if (!note) return blocks;
  const next: DrumBlockNote = { ...note };
  if (edit.patch.ratchet !== undefined) {
    const ratchet = Math.max(
      1,
      Math.min(MAX_RATCHET, Math.round(edit.patch.ratchet)),
    );
    if (ratchet > 1) next.ratchet = ratchet;
    else delete next.ratchet;
  }
  if (edit.patch.flam !== undefined) {
    if (edit.patch.flam) next.flam = true;
    else delete next.flam;
  }
  if (edit.patch.prob !== undefined) {
    const prob = Math.max(0, Math.min(1, edit.patch.prob));
    if (prob < 1) next.prob = Math.round(prob * 100) / 100;
    else delete next.prob;
  }
  if (
    next.ratchet === note.ratchet &&
    next.flam === note.flam &&
    next.prob === note.prob
  ) {
    return blocks;
  }
  const out = [...list];
  out[index] = { ...list[index], notes: [next] };
  return out;
}

/**
 * Re-gate a painted step: how long the hit holds.
 *
 * Only an existing note is changed — a gate is a length, so it needs a hit to
 * be the length of. Called with a window that holds no note this returns the
 * blocks untouched (same reference), which is what makes a drag over the
 * generated part of a row harmless.
 */
export function setDrumStepGate(
  blocks: DrumBlock[] | undefined,
  edit: DrumStepWindow & {
    lane: DrumLaneId;
    beats: number;
    /** Section end in beats — a hit cannot hold past the section it is in. */
    limitBeats?: number;
  },
): DrumBlock[] | undefined {
  const id = stepsBlockId(edit.lane, edit.startBeat, edit.endBeat);
  const list = blocks ?? [];
  const index = list.findIndex((block) => block.id === id);
  if (index < 0) return blocks;
  const note = list[index].notes?.[0];
  if (!note) return blocks;
  const ceiling = Math.max(
    MIN_DRUM_GATE,
    (edit.limitBeats ?? Number.POSITIVE_INFINITY) - edit.startBeat,
  );
  const beats = round4(Math.max(MIN_DRUM_GATE, Math.min(ceiling, edit.beats)));
  if (note.durBeats === beats) return blocks;
  const next = [...list];
  next[index] = { ...list[index], notes: [{ ...note, durBeats: beats }] };
  return next;
}
