/**
 * MIDI Export — converts a BlueprintSong to a Standard MIDI File (SMF).
 *
 * Produces a multi-track Type-1 MIDI file with one track per stem:
 *   Track 0: Tempo/Time-Sig/Key-Sig metadata (conductor track)
 *   Track 1: Chords (block chords + performance effects)
 *   Track 2: Bass (root notes, one octave below chord clips)
 *   Track 3: Drums (GM drum map, one note per hit)
 *   Track 4: Color (the bi-tonal "Color Chord" layer, per-section flavor)
 *
 * Reuses the same `sectionSpans` math the app already has (lib/arrangement.ts)
 * and the same `loopChordsToFill` cycle the bridge uses, so the exported MIDI
 * matches what the Ableton extension would generate — without depending on
 * the extension package (which lives in a separate workspace the web app
 * has no dependency on).
 */

import { chordToMidiNotes, pitchClass, type ChordQuality, applyPerformanceEffect } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { sectionSpans, type SectionSpan } from "./arrangement";
import { resolveDrumHits, inferPatternForSection } from "./playback/drumPreview";
import { planColorStem } from "./colorStem";
import type { BlueprintSong, Chord } from "../types/blueprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single MIDI note event — the common shape all three stem generators
 *  produce. `startTime` and `duration` are in song beats (quarter-note
 *  based, same as every other beat count in the blueprint schema). */
export interface MidiNote {
  pitch: number;
  startTime: number;
  duration: number;
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
const DRUM_HIT_DURATION = 0.25;

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
// Stem generators
// ---------------------------------------------------------------------------

/** Chord notes for one section — block chords with performance effects. */
export function planChordStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const occurrences = loopChordsToFill(span.section.chords ?? [], span.durationBeats);
    for (const occ of occurrences) {
      const rootPc = pitchClass(occ.chord.root);
      const chordPitches = chordToMidiNotes(rootPc, occ.chord.quality as ChordQuality, CHORD_OCTAVE);
      let chordNotes: MidiNote[] = chordPitches.map((pitch) => ({
        pitch,
        startTime: span.startBeat + occ.startTime,
        duration: occ.duration,
        velocity: CHORD_VELOCITY,
      }));

      if (occ.chord.performance) {
        // Apply effect relative to the section, then offset back to absolute
        const sectionRelative = chordNotes.map((n) => ({
          ...n,
          startTime: n.startTime - span.startBeat,
        }));
        const effected = applyPerformanceEffect(sectionRelative, occ.chord.performance);
        chordNotes = effected.map((n) => ({
          ...n,
          startTime: n.startTime + span.startBeat,
        }));
      }
      notes.push(...chordNotes);
    }
  }
  return notes;
}

/** Bass notes — one sustained root per chord, octave 3. */
export function planBassStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const occurrences = loopChordsToFill(span.section.chords ?? [], span.durationBeats);
    for (const occ of occurrences) {
      notes.push({
        pitch: BASS_OCTAVE * 12 + pitchClass(occ.chord.root),
        startTime: span.startBeat + occ.startTime,
        duration: occ.duration,
        velocity: BASS_VELOCITY,
      });
    }
  }
  return notes;
}

/** Drum notes — the same explicit-override-else-heuristic pattern
 *  resolution `drumClips.ts` uses for the bridge's export path, via
 *  `playback/drumPreview.ts`'s `resolveDrumHits`/`inferPatternForSection`
 *  (real @drum/library pattern/groove data, tiled to fill each section).
 *  `resolveDrumHits` normally converts beat positions to seconds via
 *  `secPerBeat`; passing `1` here gets beat positions straight back
 *  unchanged, which is what a beat-based MIDI file needs. */
export function planDrumStem(spans: SectionSpan[], concept?: string): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const pattern = span.section.drumPattern ?? inferPatternForSection(span.section, concept);
    const hits = resolveDrumHits(pattern, span.section.drumVariantIndex, span.section, 1, span.durationBeats);
    if (!hits) continue;
    for (const hit of hits) {
      notes.push({
        pitch: hit.midi,
        startTime: span.startBeat + hit.offsetSec,
        duration: DRUM_HIT_DURATION,
        velocity: hit.velocity,
      });
    }
  }
  return notes.filter((n) => GM_DRUM_PITCHES.has(n.pitch));
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
    const startTick = Math.round(note.startTime * TICKS_PER_QUARTER);
    const durationTicks = Math.max(1, Math.round(note.duration * TICKS_PER_QUARTER));
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
 *  Produces a Type-1 SMF with 5 tracks:
 *  - Track 0: Conductor (tempo, time signature, key signature)
 *  - Track 1: Chords
 *  - Track 2: Bass
 *  - Track 3: Drums
 *  - Track 4: Color (bi-tonal Color Chord layer)
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
  const drumNotes = planDrumStem(spans, song.concept);
  const colorNotes = planColorStem(spans);

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
  const colorTrack = buildTrackChunk(
    notesToEvents(colorNotes, 2),
    "Color",
  );

  // --- Assemble SMF ---
  const numTracks = 5;
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...writeU32(6),          // header length
    ...writeU16(1),          // format = 1 (multi-track)
    ...writeU16(numTracks),  // number of tracks
    ...writeU16(TICKS_PER_QUARTER),
  ];

  const allBytes = [...header, ...conductorTrack, ...chordTrack, ...bassTrack, ...drumTrack, ...colorTrack];
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