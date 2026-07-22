import { chordToMidiNotes, pitchClass, type ChordQuality } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import { loopChordsToFill } from "./chordCycle.js";

export interface ChordClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/**
 * Octave 5 in @music-theory/core's numbering (octave*12+pc) is MIDI 60 —
 * the "middle C" octave as Ableton itself displays it. Matches
 * chord-assistant's own default for the same reason.
 */
export const DEFAULT_OCTAVE = 5;
const DEFAULT_VELOCITY = 96;

/** Deterministic strum stagger: spreads chord tones outward from
 *  lowest to highest by `strumMs` (default 40ms).  The existing
 *  chordToMidiNotes returns [P1, P5, P8, P10+], which is already
 *  near-lowest-to-highest; we sort explicitly to be safe. */
function applyStrumToNotes(
  notes: NoteDescription[],
  strumMs: number,
): NoteDescription[] {
  if (notes.length < 2) return notes;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const interval = strumMs / 1000 / Math.max(1, sorted.length - 1);
  return sorted.map((n, i) => ({
    ...n,
    startTime: n.startTime + i * interval,
    duration: n.duration - i * interval,
  }));
}

/** Tremolo re-trigger: each note in the chord is split into
 *  `subdivision` equal-duration hits across the original note's span.
 *  subdivision=4 produces 4 hits per note (16th-note tremolo on a
 *  quarter-note chord).  Velocities follow a triangle wave (0→1→0)
 *  across the re-trigger cycle.  Kept in sync with the shared
 *  performanceEffects.ts applyPulse. */
function applyPulseToNotes(
  notes: NoteDescription[],
  subdivision: number,
): NoteDescription[] {
  if (notes.length === 0) return notes;
  const hitDuration = notes[0].duration / subdivision;

  return notes
    .flatMap((n) => {
      const hits: NoteDescription[] = [];
      for (let i = 0; i < subdivision; i++) {
        const position = i / Math.max(1, subdivision - 1);
        const factor = 1 - Math.abs(position - 0.5) * 2;
        hits.push({
          pitch: n.pitch,
          startTime: n.startTime + i * hitDuration,
          duration: hitDuration,
          velocity: Math.round((n.velocity ?? DEFAULT_VELOCITY) * (0.6 + factor * 0.4)),
        });
      }
      return hits;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/** Arpeggiator: cycles through chord notes one at a time at a
 *  `subdivision` rate across the chord's full duration, low-to-high.
 *  Kept in sync with the shared performanceEffects.ts applyArp. */
function applyArpToNotes(
  notes: NoteDescription[],
  subdivision: number,
): NoteDescription[] {
  if (notes.length === 0) return notes;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const stepDuration = notes[0].duration / subdivision;
  const hits: NoteDescription[] = [];

  for (let i = 0; i < subdivision; i++) {
    const note = sorted[i % sorted.length];
    hits.push({
      pitch: note.pitch,
      startTime: notes[0].startTime + i * stepDuration,
      duration: stepDuration,
      velocity: note.velocity ?? DEFAULT_VELOCITY,
    });
  }
  return hits;
}

/**
 * One clip per section, each holding sustained block chords.  When a
 * chord carries a `performance` effect (strum/pulse/arp), the
 * effect is applied to the generated notes before the clip is emitted.
 * See apps/trackdraft/src/lib/harmony/performanceEffects.ts for the
 * shared pure-function transforms; this file duplicates the core
 * effect logic inline to avoid a cross-package dependency on the
 * trackdraft app.  The two copies are kept in sync by the same
 * documented parameter defaults.
 */
export function planChordClips(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): ChordClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const notes: NoteDescription[] = [];
    for (const occurrence of loopChordsToFill(section.chords ?? [], durationBeats)) {
      const rootPc = pitchClass(occurrence.chord.root);
      let chordNotes: NoteDescription[] = [];
      for (const pitch of chordToMidiNotes(rootPc, occurrence.chord.quality as ChordQuality, octave)) {
        chordNotes.push({ pitch, startTime: occurrence.startTime, duration: occurrence.duration, velocity: DEFAULT_VELOCITY });
      }

      // Apply performance effect if present
      const perf = occurrence.chord.performance;
      if (perf) {
        switch (perf.style) {
          case "strum":
            chordNotes = applyStrumToNotes(chordNotes, perf.params?.strumMs ?? 150);
            break;
          case "pulse":
            chordNotes = applyPulseToNotes(chordNotes, perf.params?.subdivision ?? 4);
            break;
          case "arp":
            chordNotes = applyArpToNotes(chordNotes, perf.params?.subdivision ?? 4);
            break;
        }
      }

      notes.push(...chordNotes);
    }
    return { name: section.name, startBeat, durationBeats, notes };
  });
}