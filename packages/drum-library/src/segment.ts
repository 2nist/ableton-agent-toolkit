import { measureFeel, rhythmKeyOf } from "./features.js";
import { limbOf } from "./limbs.js";
import { takeLengthBeats } from "./take.js";
import type { DrumNote, Limb, Segment, SegmentRef, Take } from "./types.js";

export interface SegmentOptions {
  /**
   * Loop lengths to index, in bars. Multiple lengths are cheap because
   * segments hold no notes, and they matter musically: a one-bar hat figure
   * and the four-bar phrase it sits inside are different creative units.
   */
  lengthsInBars?: number[];
  /** How far to advance between candidates, in bars. */
  hopInBars?: number;
  /**
   * Segments thinner than this are dropped as too sparse to have a feel worth
   * measuring. Two is deliberate rather than cautious: a bar of kick on 1 and
   * 3 is two notes and is one of the most common patterns in popular music, so
   * a higher floor would quietly delete most of the feet layer. One note is
   * excluded because looseness and motion need something to vary against.
   */
  minNotes?: number;
}

const DEFAULTS: Required<SegmentOptions> = {
  lengthsInBars: [1, 2, 4, 8],
  hopInBars: 1,
  minNotes: 2,
};

/** Notes belonging to one limb, in take-relative beats. */
export function notesForLimb(take: Take, limb: Limb): DrumNote[] {
  return take.notes.filter((note) => limbOf(note.pitch) === limb);
}

/**
 * Enumerate candidate loops for a take.
 *
 * Fills and beats are handled differently because they are, measurably, two
 * different kinds of object: sampled across the corpus, fills run a median
 * of 3.5 beats (198 of 231 are a bar or less) while beats run a median of 77
 * beats and up to 1294. Chopping a fill to a fixed four bars would pad a
 * transition figure with silence, and chopping a long groove at one fixed
 * length would throw away most of what it does. So a fill is taken whole —
 * the file already *is* the unit — and a beat is windowed.
 */
export function segmentTake(take: Take, options: SegmentOptions = {}): Segment[] {
  const { lengthsInBars, hopInBars, minNotes } = { ...DEFAULTS, ...options };
  const lengthBeats = takeLengthBeats(take);
  if (lengthBeats <= 0) return [];

  const totalBars = Math.floor(lengthBeats / take.beatsPerBar) + 1;
  const segments: Segment[] = [];

  for (const limb of ["feet", "snare", "cymbals", "toms"] as Limb[]) {
    const limbNotes = notesForLimb(take, limb);
    if (limbNotes.length < minNotes) continue;

    if (take.beatType === "fill") {
      const lengthBars = Math.max(1, Math.ceil(lengthBeats / take.beatsPerBar));
      segments.push(buildSegment(take, limb, limbNotes, 0, lengthBars));
      continue;
    }

    for (const lengthBars of lengthsInBars) {
      if (lengthBars > totalBars) continue;
      for (let startBar = 0; startBar + lengthBars <= totalBars; startBar += hopInBars) {
        const window = sliceNotes(limbNotes, startBar, lengthBars, take.beatsPerBar);
        if (window.length < minNotes) continue;
        segments.push(buildSegment(take, limb, window, startBar, lengthBars, true));
      }
    }
  }

  return segments;
}

function buildSegment(
  take: Take,
  limb: Limb,
  notes: DrumNote[],
  startBar: number,
  lengthBars: number,
  alreadyRebased = false,
): Segment {
  const rebased = alreadyRebased ? notes : rebase(notes, startBar, take.beatsPerBar);
  return {
    takeId: take.id,
    limb,
    startBar,
    lengthBars,
    noteCount: rebased.length,
    features: measureFeel(rebased, lengthBars, take.beatsPerBar),
    rhythmKey: rhythmKeyOf(rebased),
  };
}

function rebase(notes: DrumNote[], startBar: number, beatsPerBar: number): DrumNote[] {
  const offset = startBar * beatsPerBar;
  return notes.map((note) => ({ ...note, beat: note.beat - offset }));
}

/** Notes falling inside a bar window, rebased so the window starts at beat 0. */
function sliceNotes(notes: DrumNote[], startBar: number, lengthBars: number, beatsPerBar: number): DrumNote[] {
  const from = startBar * beatsPerBar;
  const to = from + lengthBars * beatsPerBar;
  const window: DrumNote[] = [];
  for (const note of notes) {
    // Half-open so a note exactly on the boundary belongs to the next window
    // and can't be double-counted across adjacent segments.
    if (note.beat >= from && note.beat < to) {
      window.push({ ...note, beat: note.beat - from });
    }
  }
  return window;
}

/**
 * Materialise a segment's notes from its take. This is the other half of
 * "segments are views": indexing every candidate would mean millions of note
 * arrays, so they're resolved only when something actually needs to hear or
 * export them.
 */
export function resolveSegment(take: Take, ref: SegmentRef, limb: Limb): DrumNote[] {
  const limbNotes = notesForLimb(take, limb);
  return sliceNotes(limbNotes, ref.startBar, ref.lengthBars, take.beatsPerBar);
}
