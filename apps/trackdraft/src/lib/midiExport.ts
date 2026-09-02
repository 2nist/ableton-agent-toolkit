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
 * and the shared `@drum/library` chord cycle the bridge uses, so the
 * exported MIDI matches what the Ableton extension would generate — without
 * depending on the extension package (which lives in a separate workspace
 * the web app has no dependency on).
 */

import { chordToMidiNotes, pitchClass, type ChordQuality, applyPerformanceEffect } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { sectionSpans, type SectionSpan } from "./arrangement";
import { resolveSectionVariant, velocityNumber } from "./playback/drumPreview";
import { planSectionDrumNotes, planSectionBass, FILL_DATA, humanizeOutlineNotes, resolveChordOccurrences, applyStyleToVariant, resolveStyleProfile, styleHarmonize, styleSpacing, styleVelocityTarget, type SectionDrumInput } from "@drum/library";
import { planColorStem } from "./colorStem";
import { planMelodyStem } from "./melody/melodyStem";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";

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
const DRUM_HIT_DURATION = 0.25;

/** Octave 5 in @music-theory/core's numbering = MIDI 60 (middle C octave).
 *  Matches chordClips.ts DEFAULT_OCTAVE. */
const CHORD_OCTAVE = 5;

/** GM drum map — the full 13-voice canonical set the export can produce:
 *  `ABLETON_SAFE_NOTES` (what the presets and bridge use) plus the extra
 *  voices a per-voice override or a detour can author (pedalHat 44,
 *  tomLow 41, rideBell 53). Filtering by this keeps stray/unmapped pitches
 *  out of the .mid while letting every authored voice through. */
const GM_DRUM_PITCHES = new Set([36, 37, 38, 39, 41, 42, 44, 45, 46, 47, 49, 51, 53]);

// ---------------------------------------------------------------------------
// Chord cycle — @drum/library's chordCycle.ts is the single source of truth
// shared with the Ableton bridge, so .mid / live out and "Send to Ableton"
// can't drift. `resolveChordOccurrences` is imported above.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stem generators
// ---------------------------------------------------------------------------

/** Chord notes for one section — block chords with performance effects.
 *  Honors the Bend harmony axis (voicing extension) and density (spacing). */
export function planChordStem(spans: SectionSpan[], song?: BlueprintSong): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const profile = resolveStyleProfile(span.section, song);
    const occurrences = resolveChordOccurrences(span.section, span.durationBeats, styleSpacing(profile.density));
    for (const occ of occurrences) {
      const rootPc = pitchClass(occ.chord.root);
      const quality = styleHarmonize(occ.chord, profile.harmony);
      const chordPitches = chordToMidiNotes(rootPc, quality as ChordQuality, CHORD_OCTAVE);
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

/** Bass notes — one sustained root per chord by default; a per-section
 *  `bassProfile` (register/motion/rhythm/velocity) shapes the line. Uses
 *  the SAME generator the Ableton extension's `planBassLine` calls
 *  (`@drum/library`'s `planSectionBass`), so the exported .mid and live
 *  MIDI out match "Send to Ableton" note for note. */
export function planBassStem(spans: SectionSpan[], song?: BlueprintSong): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const profile = resolveStyleProfile(span.section, song);
    const occurrences = resolveChordOccurrences(span.section, span.durationBeats, styleSpacing(profile.density)).map((occ) => ({
      rootPc: pitchClass(occ.chord.root),
      startTime: span.startBeat + occ.startTime,
      duration: occ.duration,
    }));
    notes.push(...planSectionBass(occurrences, span.section.bassProfile));
  }
  return notes;
}

/** Drum notes — the SAME per-section pipeline the bridge's `planDrumClips`
 *  uses for the Ableton export, via `@drum/library`'s `planSectionDrumNotes`,
 *  so the exported .mid (and live MIDI out, which reuses this) matches
 *  "Send to Ableton" note for note: outline-vs-pattern base resolution
 *  (`resolveSectionVariant`), per-voice Euclidean overrides
 *  (`drumVoicePatterns`), velocity scaling, seeded per-occurrence tiling,
 *  automatic handoff fills, the ending detour (`drumVariationOutline`) and
 *  the named transition (`drumTransitionModel`). Outline-driven sections
 *  are humanized exactly like the bridge so even microtiming agrees.
 *  `song` feeds the heuristic pattern fallback with full signals (bpm /
 *  title / concept / notes), same as the bridge — see `inferPatternForSection`. */
export function planDrumStem(spans: SectionSpan[], song?: BlueprintSong): MidiNote[] {
  const inputs: SectionDrumInput[] = spans.map((span) => {
    const section = span.section;
    const profile = resolveStyleProfile(section, song);
    let variant = resolveSectionVariant(section, song, span.occurrenceIndex);
    if (variant && section.drumMeterOutline) {
      variant = { ...variant, notes: humanizeOutlineNotes(variant.notes, section.drumMeterOutline.cellBeats) };
    }
    // The Bend note transforms (Feel + Backbeat) apply after any outline
    // humanization — the same relative point the bridge applies them, so
    // app == bridge. Neutral profile = no-op.
    if (variant) {
      variant = applyStyleToVariant(variant, profile);
    }
    return {
      sectionId: section.id,
      occurrenceIndex: span.occurrenceIndex,
      role: section.role ?? null,
      variant,
      outline: section.drumMeterOutline ?? null,
      voiceOverrides: section.drumVoicePatterns,
      variation: section.drumVariationOutline ?? null,
      variationBars: section.drumVariationBars,
      variationStartBeat: section.drumVariationStartBeat,
      transitionModel: section.drumTransitionModel ?? null,
      transitionBars: section.drumTransitionBars,
      gridBeats: section.drumMeterOutline ? section.drumMeterOutline.cellBeats : 0.25,
      durationBeats: span.durationBeats,
      velocityTarget: styleVelocityTarget(velocityNumber(section.velocity), profile),
    };
  });

  const plans = planSectionDrumNotes(inputs, FILL_DATA);

  const notes: MidiNote[] = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    for (const n of plans[i].notes) {
      notes.push({
        pitch: n.pitch,
        startTime: span.startBeat + n.beat,
        duration: DRUM_HIT_DURATION,
        velocity: n.velocity,
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
 *  Produces a Type-1 SMF with 6 tracks:
 *  - Track 0: Conductor (tempo, time signature, key signature)
 *  - Track 1: Chords
 *  - Track 2: Bass
 *  - Track 3: Drums
 *  - Track 4: Color (bi-tonal Color Chord layer)
 *  - Track 5: Melody (the captured hum-to-MIDI line, when any section has one)
 *
 *  The tempo is set from `song.bpm`, time signature from the song's
 *  numerator/denominator, and key signature from `song.key`/`song.scale`.
 *  Each stem's notes are generated using the same `sectionSpans` + shared
 *  `@drum/library` chord-cycle logic the Ableton bridge uses, so the
 *  exported MIDI matches what "Send to Ableton" would produce.
 */
export function songToMidi(song: BlueprintSong): Uint8Array {
  const spans = sectionSpans(song);

  // Generate stems
  const chordNotes = planChordStem(spans, song);
  const bassNotes = planBassStem(spans, song);
  const drumNotes = planDrumStem(spans, song);
  const colorNotes = planColorStem(spans, song);
  const melodyNotes = planMelodyStem(spans);

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
  const melodyTrack = buildTrackChunk(
    notesToEvents(melodyNotes, 4), // channel 5 (0-based 4) — the template's melody track
    "Melody",
  );

  // --- Assemble SMF ---
  const numTracks = 6;
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...writeU32(6),          // header length
    ...writeU16(1),          // format = 1 (multi-track)
    ...writeU16(numTracks),  // number of tracks
    ...writeU16(TICKS_PER_QUARTER),
  ];

  const allBytes = [
    ...header,
    ...conductorTrack,
    ...chordTrack,
    ...bassTrack,
    ...drumTrack,
    ...colorTrack,
    ...melodyTrack,
  ];
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