/**
 * MIDI Note → Chord Detection
 *
 * For each beat window in a section, collects simultaneously active MIDI
 * pitch classes (0-11), then matches them against the chord-quality
 * interval templates from @music-theory/core to determine the most likely
 * root + quality. Produces `Chord[]` arrays (the `BlueprintSection.chords`
 * shape) that the Harmony view (hex wheel, progression track, dock editor)
 * already consumes — the one missing piece that's left 179 Beatles catalog
 * imports with empty progressions.
 */

import { getChordIntervals, noteName, midiToPitchClass } from "@music-theory/core";
import type { ChordQuality, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimedNote {
  pitch: number;       // MIDI note number 0-127
  startBeat: number;
  endBeat: number;
}

interface ChordCandidate {
  rootPc: number;
  quality: ChordQuality;
  matchedNotes: number;
  totalTemplate: number;
  score: number;       // 0-1, higher = better match
}

// ---------------------------------------------------------------------------
// All chord qualities to test against
// ---------------------------------------------------------------------------

const ALL_QUALITIES: ChordQuality[] = [
  "maj", "min", "7", "maj7", "min7", "m7b5", "sus2", "sus4", "dim", "aug",
];

// ---------------------------------------------------------------------------
// Match scoring
// ---------------------------------------------------------------------------

/**
 * Score how well a set of active pitch classes matches a chord template
 * (root + quality). Returns a ChordCandidate with 0-1 score.
 *
 * Scoring weights:
 *  - Every note in the template that's present in the active set = +1
 *  - Extra notes (not in template) = penalty (-0.3 each)
 *  - Missing template notes = subtle penalty (-0.1 each) — real MIDI
 *    performances rarely play every note of a chord on every beat,
 *    especially for 7th chords where the 5th is often omitted
 *  - Minimum score floor of 0.01 so even 1-note fragments get a result
 */
function scoreCandidate(
  activePcs: Set<number>,
  rootPc: number,
  quality: ChordQuality,
): ChordCandidate {
  const intervals = getChordIntervals(quality);
  const templatePcs = new Set(intervals.map((i) => (rootPc + i) % 12));

  let matchedNotes = 0;
  for (const pc of activePcs) {
    if (templatePcs.has(pc)) matchedNotes++;
  }

  const extraNotes = activePcs.size - matchedNotes;
  const missingNotes = templatePcs.size - matchedNotes;

  // Base score: fraction of template found
  let score = matchedNotes / Math.max(1, templatePcs.size);

  // Penalize extra notes (non-chord tones) more than missing ones
  score -= extraNotes * 0.3;
  // Minor penalty for missing template notes
  score -= missingNotes * 0.1;

  // Floor at very small positive value — even one note should give a chord.
  score = Math.max(0.01, Math.min(1, score));

  return {
    rootPc,
    quality,
    matchedNotes,
    totalTemplate: templatePcs.size,
    score,
  };
}

// ---------------------------------------------------------------------------
// Chord detection
// ---------------------------------------------------------------------------

/**
 * Given a set of active pitch classes, find the best-matching chord
 * (root + quality). Tries all 12 roots × all 10 qualities, returns the
 * candidate with the highest score.
 *
 * Prefers major/minor over extended qualities when scores are close
 * (a tie between "maj" and "maj7" at the same root goes to "maj").
 * This produces cleaner, more readable chord progressions from real
 * MIDI data that often over-voices extended tones.
 */
function detectChord(activePcs: Set<number>): { rootPc: number; quality: ChordQuality } {
  let best: ChordCandidate | null = null;

  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const quality of ALL_QUALITIES) {
      const candidate = scoreCandidate(activePcs, rootPc, quality);
      if (!best) {
        best = candidate;
        continue;
      }

      // Prefer higher score, with a small bias toward simpler qualities
      // when scores are very close (within 0.05). This avoids labeling
      // a plain C-E-G triad as "Cmaj7" because of a passing tone.
      const candidateScore = candidate.score;
      const bestScore = best.score;

      if (candidateScore > bestScore + 0.05) {
        best = candidate;
      } else if (Math.abs(candidateScore - bestScore) < 0.05) {
        // Tiebreaker: simpler quality wins
        const candidateComplexity = getChordIntervals(candidate.quality).length;
        const bestComplexity = getChordIntervals(best.quality).length;
        if (candidateComplexity < bestComplexity) {
          best = candidate;
        }
      }
    }
  }

  // Fallback — should never reach here (score floor of 0.01 guarantees a
  // winner), but defensive code is cheap.
  if (!best) {
    // Pick a single best note as major chord root
    const firstPc = activePcs.values().next().value;
    return { rootPc: firstPc ?? 0, quality: "maj" };
  }

  return { rootPc: best.rootPc, quality: best.quality };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects chords from timed MIDI notes within a section's beat range.
 *
 * @param notes - All timed MIDI notes belonging to this section
 * @param sectionStartBeat - Beat offset where this section begins (0 = start of song)
 * @param sectionDurationBeats - Total beats this section spans
 * @param beatsPerBar - Time signature numerator (e.g. 4 for 4/4)
 * @param songKey - The song's key (used to render root note names correctly)
 * @returns Array of Chord objects ready for a BlueprintSection's chords[]
 *
 * Algorithm:
 * 1. Step through the section one beat at a time (1/4 note granularity)
 * 2. Collect all notes active during that beat
 * 3. Extract pitch classes (0-11)
 * 4. Call detectChord() on the active pitch-class set
 * 5. Merge consecutive identical chords into longer durations
 * 6. Cap at 16 chords max to keep progression builder manageable
 */
export function detectMidiChords(
  notes: TimedNote[],
  sectionStartBeat: number,
  sectionDurationBeats: number,
  beatsPerBar: number,
  songKey: NoteName,
): Chord[] {
  if (notes.length === 0 || sectionDurationBeats <= 0) return [];

  const sectionEndBeat = sectionStartBeat + sectionDurationBeats;
  const WINDOW_BEATS = 1; // one beat granularity

  // Collect chord snapshots at each beat boundary
  interface BeatSnapshot {
    beat: number;
    activePcs: Set<number>;
  }

  const snapshots: BeatSnapshot[] = [];

  for (let beat = sectionStartBeat; beat < sectionEndBeat; beat += WINDOW_BEATS) {
    const windowEnd = beat + WINDOW_BEATS;
    const activePcs = new Set<number>();

    for (const note of notes) {
      // Note is active if it overlaps this beat window
      if (note.startBeat < windowEnd && note.endBeat > beat) {
        activePcs.add(midiToPitchClass(note.pitch));
      }
    }

    // Only record snapshots that have notes — silent beats don't
    // create chords (they just extend the duration of whatever came
    // before when we merge below)
    if (activePcs.size > 0) {
      snapshots.push({ beat, activePcs });
    }
  }

  if (snapshots.length === 0) return [];

  // Convert each snapshot to a chord
  const rawChords: Array<{ rootPc: number; quality: ChordQuality; startBeat: number }> = [];
  let prevRootPc = -1;
  let prevQuality: ChordQuality | null = null;

  for (const snap of snapshots) {
    const { rootPc, quality } = detectChord(snap.activePcs);

    // Merge with previous if it's the same chord — avoids a stutter
    // of 1-beat identical chords for every beat window
    if (rootPc === prevRootPc && quality === prevQuality) continue;

    prevRootPc = rootPc;
    prevQuality = quality;
    rawChords.push({ rootPc, quality, startBeat: snap.beat });
  }

  // Compute beat durations from start-beat gaps + a final implied beat.
  // Cap total chords at 16 to keep the progression builder usable —
  // real songs may have more chord changes, but a progression this
  // long is better viewed as a looped subset, and 16 is the de-facto
  // maximum the Harmony tab's UI grid can display cleanly.
  const MAX_CHORDS = 16;
  const chords = rawChords.slice(0, MAX_CHORDS);

  return chords.map((raw, i) => {
    const nextBeat = i + 1 < chords.length ? chords[i + 1].startBeat : sectionEndBeat;
    const durationBeats = Math.max(1, nextBeat - raw.startBeat);

    return {
      id: crypto.randomUUID(),
      romanNumeral: noteName(raw.rootPc, songKey),
      root: noteName(raw.rootPc, songKey),
      quality: raw.quality,
      beats: Math.round(durationBeats),
    };
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