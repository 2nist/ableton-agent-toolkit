import type { LibraryIndex } from "./library-index.js";
import { resolveSegment } from "./segment.js";
import type { DrumNote, GrooveSpec, GrooveTransform, Limb } from "./types.js";

const LIMB_ORDER: Limb[] = ["feet", "snare", "cymbals", "toms"];
const GRID = 0.25;

function applyTransform(notes: DrumNote[], transform: GrooveTransform | undefined): DrumNote[] {
  if (!transform) return notes;
  const { timingOffset = 0, velocityScale = 1, quantize = 0 } = transform;
  return notes.map((note) => {
    let beat = note.beat + timingOffset;
    if (quantize > 0) {
      const snapped = Math.round(beat / GRID) * GRID;
      beat = beat + (snapped - beat) * quantize;
    }
    return { beat, pitch: note.pitch, velocity: Math.round(note.velocity * velocityScale) };
  });
}

/**
 * Materialise every limb in a `GrooveSpec` into one merged, time-sorted note
 * list, in beats relative to the groove's own start.
 *
 * Each limb resolves against its *own* source take — that is the whole
 * point of storing a `GrooveSpec` as per-limb references rather than one
 * take id: a verse's kick and its snare can come from two different
 * performances entirely, per the recombination this library was built for.
 */
export function resolveGrooveNotes(index: LibraryIndex, spec: GrooveSpec): DrumNote[] {
  const notes: DrumNote[] = [];

  for (const limb of LIMB_ORDER) {
    const ref = spec[limb];
    if (!ref) continue;
    const take = index.takes.get(ref.takeId);
    if (!take) continue;

    const limbNotes = resolveSegment(take, ref, limb);
    notes.push(...applyTransform(limbNotes, spec.transform));
  }

  notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  return notes;
}

/** Bar length implied by a `GrooveSpec` — every limb was selected at the same `lengthBars`, so the first present ref is representative. */
export function grooveLengthBars(spec: GrooveSpec): number {
  for (const limb of LIMB_ORDER) {
    const ref = spec[limb];
    if (ref) return ref.lengthBars;
  }
  return 0;
}

/**
 * Total span of one loop of a `GrooveSpec`, in quarter-note beats — the unit
 * `DrumNote.beat` is always expressed in, and the unit `tileGroove` needs.
 *
 * This is deliberately not `grooveLengthBars(spec) * someUnrelatedNumerator`:
 * a groove's bars-per-beat comes from *the source take's own time
 * signature* (6/8 is 3 quarter-note beats per bar, not 6), which has nothing
 * to do with whatever meter a caller's song section happens to be in.
 * Conflating the two would tile a "68" groove using the wrong bar length
 * the moment a section's declared time signature didn't happen to match —
 * `selectGroove` now guarantees every limb of one spec shares a time
 * signature, so any present limb's take is representative for all of them.
 */
export function grooveLengthBeats(index: LibraryIndex, spec: GrooveSpec): number {
  for (const limb of LIMB_ORDER) {
    const ref = spec[limb];
    if (!ref) continue;
    const take = index.takes.get(ref.takeId);
    if (take) return ref.lengthBars * take.beatsPerBar;
  }
  return 0;
}

/**
 * Repeat a groove's notes to fill a longer span, in beats. Mirrors
 * `loopChordsToFill`'s contract in the bridge extension: the final repeat is
 * truncated rather than overshooting, so a groove never bleeds into the
 * next section.
 */
export function tileGroove(notes: DrumNote[], grooveLengthBeats: number, totalBeats: number): DrumNote[] {
  if (grooveLengthBeats <= 0 || totalBeats <= 0) return [];
  const tiled: DrumNote[] = [];
  for (let offset = 0; offset < totalBeats; offset += grooveLengthBeats) {
    for (const note of notes) {
      const beat = offset + note.beat;
      if (beat < totalBeats) tiled.push({ ...note, beat });
    }
  }
  return tiled;
}
