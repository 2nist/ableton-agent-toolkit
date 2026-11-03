/**
 * MIDI Note → Chord Detection
 *
 * For each beat window in a section, collects simultaneously active MIDI
 * pitch classes (0-11) and asks the shared recognizer
 * (`lib/harmony/chordRecognition`) what chord that is. Produces `Chord[]`
 * arrays (the `BlueprintSection.chords` shape) that the Harmony view (hex
 * wheel, progression track, dock editor) already consumes. This is the piece
 * that turns an imported MIDI file into a progression.
 *
 * The recognizer is the same one the live chord pad uses. This module used to
 * carry its own copy with a 10-quality candidate list, which meant every maj7,
 * min7, 6, 9 or altered dominant in a corpus file was flattened to the nearest
 * triad — structurally, not by a close scoring call. Adding the bass note and
 * the previous chord here keeps the import path reading a progression the way
 * a player would: the lowest note names the inversion, and a reading that is
 * ambiguous on its own inherits the shape that was already sounding.
 */

import { diatonicChordQualities, midiToPitchClass, noteName } from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import {
  recognizeChord,
  type RecognizedChord,
} from "../harmony/chordRecognition";
import { deriveEvent } from "../harmony/analysis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimedNote {
  pitch: number;       // MIDI note number 0-127
  startBeat: number;
  endBeat: number;
}

interface BeatSnapshot {
  beat: number;
  activePcs: Set<number>;
  /** Lowest sounding pitch in the window — the bass, which names the inversion. */
  bassPitch: number;
}

export interface DetectMidiChordsOptions {
  /** The section's scale, so Roman numerals read against the right mode. */
  scale?: ScaleType;
}

/** How long a beat window is, in beats. */
const WINDOW_BEATS = 1;

/** Cap on a section's progression — 16 is the widest the Harmony grid shows
 *  cleanly; longer corpus sections are better read as a looped subset. */
const MAX_CHORDS = 16;

interface DetectedChord {
  rootPc: number;
  quality: ChordQuality;
  startBeat: number;
  inversion?: number;
}

// ---------------------------------------------------------------------------
// Chord detection
// ---------------------------------------------------------------------------

/**
 * Detects chords from timed MIDI notes within a section's beat range.
 *
 * @param notes - All timed MIDI notes belonging to this section
 * @param sectionStartBeat - Beat offset where this section begins (0 = start of song)
 * @param sectionDurationBeats - Total beats this section spans
 * @param beatsPerBar - Time signature numerator (e.g. 4 for 4/4)
 * @param songKey - The song's key (used to render root note names correctly)
 * @param options - `scale` for Roman numeral reading
 * @returns Array of Chord objects ready for a BlueprintSection's chords[]
 *
 * Algorithm:
 * 1. Step through the section one beat at a time (1/4 note granularity)
 * 2. Collect the notes active during that beat, their pitch classes and the
 *    lowest pitch
 * 3. Ask `recognizeChord` for the best root + quality (bass, the previous
 *    chord and the key's own vocabulary included as evidence)
 * 4. Skip windows with no chord — a single held note is not a chord, and a
 *    fabricated one costs more downstream than a gap
 * 5. Merge consecutive identical chords into longer durations
 * 6. Derive the Roman numerals once the whole progression exists, because an
 *    applied dominant ("V7/V") needs the chord that follows
 */
export function detectMidiChords(
  notes: TimedNote[],
  sectionStartBeat: number,
  sectionDurationBeats: number,
  beatsPerBar: number,
  songKey: NoteName,
  options: DetectMidiChordsOptions = {},
): Chord[] {
  if (notes.length === 0 || sectionDurationBeats <= 0) return [];

  const sectionEndBeat = sectionStartBeat + sectionDurationBeats;
  const scale: ScaleType = options.scale ?? "ionian";
  // The qualities this key offers. Recognition tries them first, so an import
  // reads in the key the file declares instead of reaching for a richer
  // spelling that only half-explains the notes.
  const permitted = diatonicChordQualities(scale);

  const snapshots: BeatSnapshot[] = [];

  for (let beat = sectionStartBeat; beat < sectionEndBeat; beat += WINDOW_BEATS) {
    const windowEnd = beat + WINDOW_BEATS;
    const activePcs = new Set<number>();
    let bassPitch = Number.POSITIVE_INFINITY;

    for (const note of notes) {
      // Note is active if it overlaps this beat window
      if (note.startBeat < windowEnd && note.endBeat > beat) {
        activePcs.add(midiToPitchClass(note.pitch));
        if (note.pitch < bassPitch) bassPitch = note.pitch;
      }
    }

    // Only record snapshots that have notes — silent beats don't create
    // chords (they just extend the duration of whatever came before when we
    // merge below). `beatsPerBar` stays part of the signature for callers
    // that pass meter context; windowing is per beat.
    if (activePcs.size > 0) snapshots.push({ beat, activePcs, bassPitch });
  }

  if (snapshots.length === 0) return [];

  // Convert each snapshot to a chord, carrying the previous reading as a prior.
  const rawChords: DetectedChord[] = [];
  let previous: RecognizedChord | null = null;

  for (const snap of snapshots) {
    const recognized = recognizeChord([...snap.activePcs], {
      bassPc: midiToPitchClass(snap.bassPitch),
      keyName: songKey,
      scale,
      previous: previous ?? undefined,
      permitted,
    });

    // Too few notes to name anything (a lone held note): leave the previous
    // chord sounding rather than inventing a root from one pitch.
    if (!recognized) continue;

    if (previous && recognized.rootPc === previous.rootPc && recognized.quality === previous.quality) {
      // Same chord still sounding — the duration is computed from the gap to
      // the next change, so there is nothing to record here.
      previous = recognized;
      continue;
    }

    previous = recognized;
    rawChords.push({
      rootPc: recognized.rootPc,
      quality: recognized.quality,
      startBeat: snap.beat,
      inversion: recognized.inversion,
    });
  }

  if (rawChords.length === 0) return [];

  const capped = rawChords.slice(0, MAX_CHORDS);

  const chords: Chord[] = capped.map((raw, i) => {
    const nextBeat = i + 1 < capped.length ? capped[i + 1].startBeat : sectionEndBeat;
    const durationBeats = Math.max(1, nextBeat - raw.startBeat);
    const chord: Chord = {
      id: crypto.randomUUID(),
      romanNumeral: "",
      root: noteName(raw.rootPc, songKey),
      quality: raw.quality,
      beats: Math.round(durationBeats),
    };
    // The recognizer only reports an inversion for a bass that is a chord
    // tone, so this is absent for root position — the historical default.
    if (raw.inversion) chord.voicing = { inversion: raw.inversion };
    return chord;
  });

  // Numerals are derived from (root, quality, key) like every other surface
  // does, not stored from the notes: an applied dominant reads "V7/x" only
  // when the chord it resolves to is known.
  let startBeat = 0;
  return chords.map((chord, index) => {
    const derived = deriveEvent(chord, chords[index + 1] ?? null, {
      key: songKey,
      scale,
      startBeat,
    });
    startBeat += chord.beats;
    return { ...chord, romanNumeral: derived.roman };
  });
}

/**
 * Converts the parser's raw note format to the TimedNote shape the
 * chord detector expects — a narrow adapter so the parser's existing
 * note format doesn't need to change, and the detector can be tested
 * fully in isolation.
 */
export function parserNotesToTimed(
  midiNotes: Array<{ note: number; startTick: number; endTick: number }>,
  ticksPerQuarter: number,
  sectionStartTick: number,
): TimedNote[] {
  if (ticksPerQuarter <= 0) return [];

  return midiNotes.map((n) => ({
    pitch: n.note,
    startBeat: (n.startTick - sectionStartTick) / ticksPerQuarter,
    endBeat: (n.endTick - sectionStartTick) / ticksPerQuarter,
  }));
}
