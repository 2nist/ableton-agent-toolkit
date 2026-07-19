import { parseMidi } from "midi-file";
import { beatsPerBar, type CatalogEntry } from "./catalog.js";
import type { DrumNote, Take } from "./types.js";

/**
 * Read one E-GMD performance into beat-positioned notes.
 *
 * Positions come from `ticks / ticksPerBeat`, which is tempo-independent —
 * we never consult the tempo map. That matters because the previous attempt
 * at this library produced note positions in the wrong unit entirely (every
 * hit in a 16-beat pattern landed inside the first 0.3 beats), and the whole
 * corpus was silently unusable. `validateTake` exists to make that class of
 * error loud rather than latent.
 *
 * Note-on with velocity 0 is the standard "note off" idiom and is skipped.
 */
export function loadTake(data: Uint8Array, entry: CatalogEntry): Take {
  const midi = parseMidi(data);
  const ticksPerBeat = midi.header.ticksPerBeat;
  if (!ticksPerBeat || ticksPerBeat <= 0) {
    throw new Error(`${entry.midiFilename}: missing ticksPerBeat (SMPTE timing is not supported)`);
  }

  // Each track carries its own delta times, so accumulate per track and
  // merge afterwards rather than concatenating events across tracks.
  const notes: DrumNote[] = [];
  for (const track of midi.tracks) {
    let ticks = 0;
    for (const event of track) {
      ticks += event.deltaTime;
      if (event.type === "noteOn" && event.velocity > 0) {
        notes.push({
          beat: ticks / ticksPerBeat,
          pitch: event.noteNumber,
          velocity: event.velocity,
        });
      }
    }
  }
  notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);

  return {
    id: entry.midiFilename,
    drummer: entry.drummer,
    session: entry.session,
    style: entry.style,
    bpm: entry.bpm,
    beatType: entry.beatType,
    timeSignature: entry.timeSignature,
    kitName: entry.kitName,
    beatsPerBar: beatsPerBar(entry.timeSignature),
    notes,
  };
}

/** Length of a take in beats, measured from its notes rather than its metadata. */
export function takeLengthBeats(take: Take): number {
  if (take.notes.length === 0) return 0;
  return take.notes[take.notes.length - 1].beat;
}

export interface TakeProblem {
  takeId: string;
  problem: string;
}

/**
 * Timing sanity checks, run over every take during extraction.
 *
 * The library this replaces shipped a `quality_issues.json` of `{}` while
 * every one of its patterns was corrupt, so "the pipeline said it was fine"
 * is not evidence of anything. These assertions are deliberately about
 * *physical plausibility* — a real drummer cannot play 200 hits in a bar,
 * and a take whose notes all land in its first fraction of a beat is not a
 * performance — so they catch unit errors rather than merely unusual music.
 */
export function validateTake(take: Take): TakeProblem[] {
  const problems: TakeProblem[] = [];
  const report = (problem: string) => problems.push({ takeId: take.id, problem });

  if (take.notes.length === 0) {
    report("no note-on events");
    return problems;
  }

  const lengthBeats = takeLengthBeats(take);
  if (lengthBeats <= 0) {
    report("all notes share a single instant — timing unit is almost certainly wrong");
    return problems;
  }

  // Density, not span, is what separates corruption from music. A short span
  // is perfectly normal — fills run a median of 3.5 beats across the corpus,
  // so rejecting multi-note takes shorter than a bar throws out most of the
  // transition material. The broken library reached ~4000 hits/bar; a busy
  // real fill is ~26, and even a 32nd-note roll across every limb stays well
  // under this ceiling.
  const hitsPerBar = take.notes.length / (lengthBeats / take.beatsPerBar);
  if (hitsPerBar > 128) {
    report(`implausible density: ${hitsPerBar.toFixed(0)} hits/bar`);
  }

  for (const note of take.notes) {
    if (note.beat < 0) {
      report("negative note position");
      break;
    }
  }
  for (const note of take.notes) {
    if (note.velocity < 1 || note.velocity > 127) {
      report(`velocity out of range: ${note.velocity}`);
      break;
    }
  }

  return problems;
}
