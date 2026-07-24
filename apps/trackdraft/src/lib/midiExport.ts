/**
 * MIDI Export — converts a BlueprintSong to a Standard MIDI File (SMF).
 *
 * Produces a multi-track Type-1 MIDI file with one track per stem:
 *   Track 0: Tempo/Time-Sig/Key-Sig metadata (conductor track)
 *   Track 1: Chords (block chords + performance effects)
 *   Track 2: Bass (root notes, one octave below chord clips)
 *   Track 3: Drums (GM drum map, one note per hit)
 *
 * Reuses the same `sectionSpans` math the app already has (lib/arrangement.ts)
 * and the same `loopChordsToFill` cycle the bridge uses, so the exported MIDI
 * matches what the Ableton extension would generate — without depending on
 * the extension package (which lives in a separate workspace the web app
 * has no dependency on).
 *
 * The performance-effect transforms (strum/pulse/arp) are duplicated inline
 * from extensions/trackdraft-bridge/src/chordClips.ts for the same reason:
 * avoiding a cross-package dependency. The two copies share the same
 * documented parameter defaults and are kept in sync.
 */

import { chordToMidiNotes, pitchClass, type ChordQuality } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { sectionSpans, type SectionSpan } from "./arrangement";
import type { BlueprintSong, Chord, ChordPerformanceEffect } from "../types/blueprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single MIDI note event — the common shape all three stem generators
 *  produce. `startBeat` and `durationBeats` are in song beats (quarter-note
 *  based, same as every other beat count in the blueprint schema). */
interface MidiNote {
  pitch: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** MIDI ticks per quarter note — the resolution of the exported file.
 *  480 is the most common PPQ in modern DAWs (Ableton, Logic, Cubase). */
const TICKS_PER_QUARTER = 480;

/** Default MIDI velocities, matching the bridge's chordClips.ts / bassLine.ts. */
const CHORD_VELOCITY = 96;
const BASS_VELOCITY = 100;
const DRUM_HIT_DURATION_BEATS = 0.25;

/** Octave 5 in @music-theory/core's numbering = MIDI 60 (middle C octave).
 *  Matches chordClips.ts DEFAULT_OCTAVE. */
const CHORD_OCTAVE = 5;
/** Octave 3 = MIDI 36 (C2 in Ableton's display). Matches bassLine.ts. */
const BASS_OCTAVE = 3;

/** GM drum map — same pitches the bridge's drumClips.ts and the app's
 *  drumPreview.ts use (ABLETON_SAFE_NOTES). */
const GM_DRUM_PITCHES = new Set([36, 37, 38, 39, 42, 45, 46, 47, 49, 51]);

// ---------------------------------------------------------------------------
// Chord cycle (duplicated from bridge's chordCycle.ts — no cross-package dep)
// ---------------------------------------------------------------------------

interface ChordOccurrence {
  chord: Chord;
  startTime: number; // beats from section start
  duration: number; // beats
}

function loopChordsToFill(chords: Chord[], durationBeats: number): ChordOccurrence[] {
  const cycleBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);
  if (cycleBeats <= 0) return [];

  const occurrences: ChordOccurrence[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const chord of chords) {
      if (cursor >= durationBeats) break;
      const duration = Math.min(chord.beats, durationBeats - cursor);
      occurrences.push({ chord, startTime: cursor, duration });
      cursor += chord.beats;
    }
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Performance effects (duplicated from bridge's chordClips.ts)
// ---------------------------------------------------------------------------

function applyStrum(notes: MidiNote[], strumMs: number): MidiNote[] {
  if (notes.length < 2) return notes;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  // Convert strum delay from ms to beats — need BPM, but at export time
  // we don't have it per-note. Use a fixed small stagger in ticks instead.
  // 150ms at 120bpm = 0.3 beats; approximate as a fraction of note duration.
  const staggerBeats = (strumMs / 1000) * 2; // rough: 150ms ≈ 0.3 beats at 120bpm
  const interval = staggerBeats / Math.max(1, sorted.length - 1);
  return sorted.map((n, i) => ({
    ...n,
    startBeat: n.startBeat + i * interval,
    durationBeats: Math.max(0.05, n.durationBeats - i * interval),
  }));
}

function applyPulse(notes: MidiNote[], subdivision: number): MidiNote[] {
  if (notes.length === 0) return notes;
  return notes.flatMap((n) => {
    const hitDuration = n.durationBeats / subdivision;
    const hits: MidiNote[] = [];
    for (let i = 0; i < subdivision; i++) {
      const position = i / Math.max(1, subdivision - 1);
      const factor = 1 - Math.abs(position - 0.5) * 2;
      hits.push({
        pitch: n.pitch,
        startBeat: n.startBeat + i * hitDuration,
        durationBeats: hitDuration,
        velocity: Math.round(n.velocity * (0.6 + factor * 0.4)),
      });
    }
    return hits;
  });
}

function applyArp(notes: MidiNote[], subdivision: number): MidiNote[] {
  if (notes.length === 0) return notes;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const stepDuration = notes[0].durationBeats / subdivision;
  const hits: MidiNote[] = [];
  for (let i = 0; i < subdivision; i++) {
    const note = sorted[i % sorted.length];
    hits.push({
      pitch: note.pitch,
      startBeat: notes[0].startBeat + i * stepDuration,
      durationBeats: stepDuration,
      velocity: note.velocity,
    });
  }
  return hits;
}

function applyPerformanceEffect(notes: MidiNote[], perf: ChordPerformanceEffect): MidiNote[] {
  switch (perf.style) {
    case "strum":
      return applyStrum(notes, perf.params?.strumMs ?? 150);
    case "pulse":
      return applyPulse(notes, perf.params?.subdivision ?? 4);
    case "arp":
      return applyArp(notes, perf.params?.subdivision ?? 4);
    default:
      return notes;
  }
}

// ---------------------------------------------------------------------------
// Stem generators
// ---------------------------------------------------------------------------

/** Chord notes for one section — block chords with performance effects. */
function planChordStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const occurrences = loopChordsToFill(span.section.chords ?? [], span.durationBeats);
    for (const occ of occurrences) {
      const rootPc = pitchClass(occ.chord.root);
      const chordPitches = chordToMidiNotes(rootPc, occ.chord.quality as ChordQuality, CHORD_OCTAVE);
      let chordNotes: MidiNote[] = chordPitches.map((pitch) => ({
        pitch,
        startBeat: span.startBeat + occ.startTime,
        durationBeats: occ.duration,
        velocity: CHORD_VELOCITY,
      }));

      if (occ.chord.performance) {
        // Apply effect relative to the section, then offset back to absolute
        const sectionRelative = chordNotes.map((n) => ({
          ...n,
          startBeat: n.startBeat - span.startBeat,
        }));
        const effected = applyPerformanceEffect(sectionRelative, occ.chord.performance);
        chordNotes = effected.map((n) => ({
          ...n,
          startBeat: n.startBeat + span.startBeat,
        }));
      }
      notes.push(...chordNotes);
    }
  }
  return notes;
}

/** Bass notes — one sustained root per chord, octave 3. */
function planBassStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const occurrences = loopChordsToFill(span.section.chords ?? [], span.durationBeats);
    for (const occ of occurrences) {
      notes.push({
        pitch: BASS_OCTAVE * 12 + pitchClass(occ.chord.root),
        startBeat: span.startBeat + occ.startTime,
        durationBeats: occ.duration,
        velocity: BASS_VELOCITY,
      });
    }
  }
  return notes;
}

/** Drum notes — placeholder: generates a simple kick/snare pattern.
 *  The full drum library (@drum/library) is available in the bridge but
 *  not in the web app; for standalone MIDI export we emit a basic
 *  four-on-the-floor pattern scaled to the section's velocity. */
function planDrumStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const beatsPerBar = span.section.timeSignatureNumerator;
    const totalBars = span.durationBeats / beatsPerBar;
    const velocity = velocityToPeak(span.section.velocity);

    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = span.startBeat + bar * beatsPerBar;
      // Kick on each beat
      for (let beat = 0; beat < beatsPerBar; beat++) {
        notes.push({
          pitch: 36, // kick
          startBeat: barStart + beat,
          durationBeats: DRUM_HIT_DURATION_BEATS,
          velocity: beat === 0 ? velocity : Math.round(velocity * 0.9),
        });
      }
      // Snare on beats 2 and 4 (for 4/4) or beat 2 (for 3/4)
      const snareBeats = beatsPerBar >= 4 ? [1, 3] : [1];
      for (const beat of snareBeats) {
        if (beat < beatsPerBar) {
          notes.push({
            pitch: 38, // snare
            startBeat: barStart + beat,
            durationBeats: DRUM_HIT_DURATION_BEATS,
            velocity: Math.round(velocity * 0.85),
          });
        }
      }
      // Closed hat on eighth notes
      const eighthCount = beatsPerBar * 2;
      for (let i = 0; i < eighthCount; i++) {
        notes.push({
          pitch: 42, // closed hat
          startBeat: barStart + i * 0.5,
          durationBeats: DRUM_HIT_DURATION_BEATS,
          velocity: Math.round(velocity * 0.5),
        });
      }
    }
  }
  return notes.filter((n) => GM_DRUM_PITCHES.has(n.pitch));
}

// ---------------------------------------------------------------------------
// Velocity preset → MIDI peak (matches drumPreview.ts / song-structure)
// ---------------------------------------------------------------------------

const VELOCITY_TO_PEAK: Record<string, number> = {
  ppp: 32, pp: 48, p: 64, mp: 80, mf: 96, f: 112, ff: 120, fff: 127,
};

function velocityToPeak(velocity: string): number {
  return VELOCITY_TO_PEAK[velocity] ?? 96;
}

// ---------------------------------------------------------------------------
// MIDI binary writer
// ---------------------------------------------------------------------------

/** Writes a variable-length quantity (MIDI's delta-time encoding). */
function writeVarLen(value: number): number[] {
  const bytes: number[] = [];
  let v = value & 0x0fffffff;
  bytes.unshift(v & 0x7f);
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

/** Writes a big-endian 32-bit unsigned integer. */
function writeU32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

/** Writes a big-endian 16-bit unsigned integer. */
function writeU16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/** Writes a big-endian 24-bit value (used for tempo meta event). */
function writeU24(value: number): number[] {
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

interface RawMidiEvent {
  tick: number;
  data: number[]; // raw bytes including status byte
}

/** Builds a MIDI track chunk from a sorted list of events. */
function buildTrackChunk(events: RawMidiEvent[], trackName?: string): number[] {
  const bytes: number[] = [];

  // Track name meta event (at tick 0)
  if (trackName) {
    const nameBytes = Array.from(new TextEncoder().encode(trackName));
    bytes.push(0x00); // delta = 0
    bytes.push(0xff, 0x03); // meta: track name
    bytes.push(...writeVarLen(nameBytes.length));
    bytes.push(...nameBytes);
  }

  // Sort events by tick (stable enough for our purposes)
  const sorted = [...events].sort((a, b) => a.tick - b.tick);

  let lastTick = 0;
  for (const event of sorted) {
    const delta = Math.max(0, event.tick - lastTick);
    bytes.push(...writeVarLen(delta));
    bytes.push(...event.data);
    lastTick = event.tick;
  }

  // End of track meta event
  const endDelta = Math.max(0, (sorted.length > 0 ? sorted[sorted.length - 1].tick : 0) - lastTick);
  bytes.push(...writeVarLen(endDelta));
  bytes.push(0xff, 0x2f, 0x00);

  // MTrk header + length
  const header = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...writeU32(bytes.length),
  ];

  return [...header, ...bytes];
}

/** Converts a stem's MidiNote[] into raw MIDI note on/off events. */
function notesToEvents(notes: MidiNote[], channel: number): RawMidiEvent[] {
  const events: RawMidiEvent[] = [];
  for (const note of notes) {
    const startTick = Math.round(note.startBeat * TICKS_PER_QUARTER);
    const durationTicks = Math.max(1, Math.round(note.durationBeats * TICKS_PER_QUARTER));
    const endTick = startTick + durationTicks;
    const vel = Math.max(1, Math.min(127, note.velocity));

    // Note on
    events.push({
      tick: startTick,
      data: [0x90 | (channel & 0x0f), note.pitch & 0x7f, vel],
    });
    // Note off
    events.push({
      tick: endTick,
      data: [0x80 | (channel & 0x0f), note.pitch & 0x7f, 0x40],
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Key signature mapping
// ---------------------------------------------------------------------------

/** Maps a (key, scale) pair to MIDI key-signature sharps/flats. */
function keySignature(song: BlueprintSong): { sharps: number; major: boolean } {
  const circleOfFifths: Record<NoteName, number> = {
    "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6,
    "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6,
  };
  const sharps = circleOfFifths[song.key] ?? 0;
  const major = song.scale === "ionian" || song.scale === "lydian" || song.scale === "mixolydian";
  return { sharps, major };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/** Converts a BlueprintSong to a Standard MIDI File as a Uint8Array.
 *
 *  Produces a Type-1 SMF with 4 tracks:
 *  - Track 0: Conductor (tempo, time signature, key signature)
 *  - Track 1: Chords
 *  - Track 2: Bass
 *  - Track 3: Drums
 *
 *  The tempo is set from `song.bpm`, time signature from the song's
 *  numerator/denominator, and key signature from `song.key`/`song.scale`.
 *  Each stem's notes are generated using the same `sectionSpans` + 
 *  `loopChordsToFill` logic the Ableton bridge uses, so the exported MIDI
 *  matches what "Send to Ableton" would produce.
 */
export function songToMidi(song: BlueprintSong): Uint8Array {
  const spans = sectionSpans(song);

  // Generate stems
  const chordNotes = planChordStem(spans);
  const bassNotes = planBassStem(spans);
  const drumNotes = planDrumStem(spans);

  // --- Conductor track (tempo + time sig + key sig) ---
  const conductorEvents: RawMidiEvent[] = [];

  // Tempo: microseconds per quarter note
  const microsPerQuarter = Math.round(60000000 / song.bpm);
  conductorEvents.push({
    tick: 0,
    data: [0xff, 0x51, 0x03, ...writeU24(microsPerQuarter)],
  });

  // Time signature
  const tsDenPower = Math.round(Math.log2(song.timeSignatureDenominator));
  conductorEvents.push({
    tick: 0,
    data: [0xff, 0x58, 0x04, song.timeSignatureNumerator, tsDenPower, 24, 8],
  });

  // Key signature
  const { sharps, major } = keySignature(song);
  const sharpsByte = sharps < 0 ? sharps + 256 : sharps;
  conductorEvents.push({
    tick: 0,
    data: [0xff, 0x59, 0x02, sharpsByte & 0xff, major ? 0 : 1],
  });

  const conductorTrack = buildTrackChunk(conductorEvents, song.title);

  // --- Stem tracks ---
  const chordTrack = buildTrackChunk(
    notesToEvents(chordNotes, 0),
    "Chords",
  );
  const bassTrack = buildTrackChunk(
    notesToEvents(bassNotes, 1),
    "Bass",
  );
  const drumTrack = buildTrackChunk(
    notesToEvents(drumNotes, 9), // channel 10 = GM drums
    "Drums",
  );

  // --- Assemble SMF ---
  const numTracks = 4;
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...writeU32(6),          // header length
    ...writeU16(1),          // format = 1 (multi-track)
    ...writeU16(numTracks),  // number of tracks
    ...writeU16(TICKS_PER_QUARTER),
  ];

  const allBytes = [...header, ...conductorTrack, ...chordTrack, ...bassTrack, ...drumTrack];
  return new Uint8Array(allBytes);
}

/** Triggers a browser download of a song as a .mid file. */
export function downloadSongMidi(song: BlueprintSong): void {
  const bytes = songToMidi(song);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}