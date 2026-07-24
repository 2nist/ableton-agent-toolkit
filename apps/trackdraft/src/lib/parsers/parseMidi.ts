/**
 * Manual MIDI binary parser — no external dependencies.
 * Extracts BPM, key signature, time signature, and notes from a Standard MIDI File.
 * Produces a BlueprintSong skeleton with chord detection for every detected section.
 */

import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";
import { detectMidiChords, parserNotesToTimed } from "./midiChordDetect";

interface MidiEvent {
  tick: number;
  type: "noteOn" | "noteOff" | "tempo" | "timeSig" | "keySig" | "trackName" | "endOfTrack" | "unknown";
  channel?: number;
  note?: number;       // MIDI note number 0-127
  velocity?: number;
  tempo?: number;       // microseconds per quarter note
  timeSigNum?: number;
  timeSigDen?: number;
  keySigSharps?: number; // negative = flats
  major?: boolean;
  name?: string;
}

interface MidiTrack {
  events: MidiEvent[];
  name?: string;
}

interface ParsedMidi {
  ticksPerQuarter: number;
  tracks: MidiTrack[];
  tempo: number;       // BPM
  key: NoteName;
  scale: string;
  timeSigNum: number;
  timeSigDen: number;
  notes: Array<{ note: number; velocity: number; startTick: number; endTick: number; track: number }>;
}

/** Maps a MIDI key signature to a note name. */
function midiKeyToNoteName(sharps: number, major: boolean): NoteName {
  // Circle of fifths
  const sharpKeys: NoteName[] = ["C", "G", "D", "A", "E", "B", "F#"];
  const flatKeys: NoteName[] = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb"];
  if (sharps >= 0) {
    return sharpKeys[Math.min(sharps, sharpKeys.length - 1)];
  }
  return flatKeys[Math.min(-sharps, flatKeys.length - 1)];
}

function midiMode(major: boolean): string {
  return major ? "ionian" : "aeolian";
}

/** Reads a variable-length quantity from MIDI bytes. */
function readVarLen(bytes: Uint8Array, offset: number): { value: number; length: number } {
  let value = 0;
  let length = 0;
  while (offset + length < bytes.length) {
    const b = bytes[offset + length];
    value = (value << 7) | (b & 0x7f);
    length++;
    if ((b & 0x80) === 0) break;
  }
  return { value, length };
}

/** Reads a big-endian 16-bit unsigned integer. */
function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/** Reads a big-endian 32-bit unsigned integer. */
function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

/** Read three bytes as big-endian. */
function readU24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

/** Parse a single track chunk. */
function parseTrack(data: Uint8Array, offset: number, end: number): MidiTrack {
  const events: MidiEvent[] = [];
  let tick = 0;
  let runningStatus = 0;

  while (offset < end) {
    // Delta time
    const dt = readVarLen(data, offset);
    offset += dt.length;
    tick += dt.value;

    // Status byte or running status
    let status = data[offset];
    if ((status & 0x80) === 0) {
      // Running status
      if (runningStatus === 0) break; // malformed
      status = runningStatus;
    } else {
      offset++;
      runningStatus = status;
    }

    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (command === 0x80) {
      // Note off
      if (offset + 1 >= end) break;
      const note = data[offset++];
      const velocity = data[offset++];
      events.push({ tick, type: "noteOff", channel, note, velocity });
    } else if (command === 0x90) {
      // Note on
      if (offset + 1 >= end) break;
      const note = data[offset++];
      const velocity = data[offset++];
      if (velocity > 0) {
        events.push({ tick, type: "noteOn", channel, note, velocity });
      } else {
        events.push({ tick, type: "noteOff", channel, note, velocity });
      }
    } else if (status === 0xff) {
      // Meta event
      if (offset >= end) break;
      const metaType = data[offset++];
      const metaLen = readVarLen(data, offset);
      offset += metaLen.length;
      const metaData = data.slice(offset, offset + metaLen.value);
      offset += metaLen.value;

      switch (metaType) {
        case 0x01: // Text
          events.push({ tick, type: "unknown" });
          break;
        case 0x03: // Track name
          events.push({ tick, type: "trackName", name: new TextDecoder().decode(metaData) });
          break;
        case 0x2f: // End of track
          events.push({ tick, type: "endOfTrack" });
          break;
        case 0x51: // Set tempo
          events.push({ tick, type: "tempo", tempo: readU24(metaData, 0) });
          break;
        case 0x58: // Time signature
          events.push({
            tick,
            type: "timeSig",
            timeSigNum: metaData[0],
            timeSigDen: 2 ** metaData[1],
          });
          break;
        case 0x59: // Key signature
          events.push({
            tick,
            type: "keySig",
            keySigSharps: metaData[0] > 127 ? metaData[0] - 256 : metaData[0],
            major: metaData[1] === 0,
          });
          break;
        default:
          events.push({ tick, type: "unknown" });
      }
    } else {
      // Other channel events — skip parameter bytes
      const paramCount = command === 0xc0 || command === 0xd0 ? 1 : 2;
      offset = Math.min(offset + paramCount, end);
    }
  }

  return { events };
}

/** Parse a Standard MIDI File from bytes. */
export function parseMidiBytes(bytes: Uint8Array): ParsedMidi {
  // Header
  if (bytes[0] !== 0x4d || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
    throw new Error("Not a valid MIDI file (missing MThd header)");
  }
  const headerLen = readU32(bytes, 4);
  const format = readU16(bytes, 8);
  const numTracks = readU16(bytes, 10);
  const ticksPerQuarter = readU16(bytes, 12);

  const tracks: MidiTrack[] = [];
  let offset = 14; // after header

  for (let t = 0; t < numTracks; t++) {
    if (offset + 8 > bytes.length) break;
    if (bytes[offset] !== 0x4d || bytes[offset + 1] !== 0x54 || bytes[offset + 2] !== 0x72 || bytes[offset + 3] !== 0x6b) {
      throw new Error(`Expected MTrk chunk at offset ${offset}`);
    }
    const trackLen = readU32(bytes, offset + 4);
    offset += 8;
    const trackData = bytes.slice(offset, offset + trackLen);
    const track = parseTrack(trackData, 0, trackLen);
    track.name = track.events.find((e) => e.type === "trackName")?.name;
    tracks.push(track);
    offset += trackLen;
  }

  // Extract global settings from first track's meta events
  let tempo = 120;   // default BPM
  let keySigSharps = 0;
  let major = true;
  let timeSigNum = 4;
  let timeSigDen = 4;

  for (const track of tracks) {
    for (const event of track.events) {
      if (event.type === "tempo" && event.tempo) {
        tempo = Math.round(60000000 / event.tempo);
      }
      if (event.type === "keySig") {
        keySigSharps = event.keySigSharps ?? 0;
        major = event.major ?? true;
      }
      if (event.type === "timeSig") {
        timeSigNum = event.timeSigNum ?? 4;
        timeSigDen = event.timeSigDen ?? 4;
      }
    }
  }

  // Collect all notes with on/off pairing
  const noteOns: Map<string, { note: number; velocity: number; startTick: number; channel: number; track: number }> = new Map();
  const notes: ParsedMidi["notes"] = [];

  for (let t = 0; t < tracks.length; t++) {
    for (const event of tracks[t].events) {
      if (event.type === "noteOn" && event.note != null) {
        const key = `${event.channel}-${event.note}`;
        noteOns.set(key, {
          note: event.note,
          velocity: event.velocity ?? 64,
          startTick: event.tick,
          channel: event.channel ?? 0,
          track: t,
        });
      }
      if (event.type === "noteOff" && event.note != null) {
        const key = `${event.channel}-${event.note}`;
        const on = noteOns.get(key);
        if (on) {
          notes.push({
            note: on.note,
            velocity: on.velocity,
            startTick: on.startTick,
            endTick: event.tick,
            track: on.track,
          });
          noteOns.delete(key);
        }
      }
    }
  }
  // Close any hanging notes at max tick
  const maxTick = notes.reduce((max, n) => Math.max(max, n.endTick), 0);
  for (const [, on] of noteOns) {
    notes.push({ ...on, endTick: maxTick + ticksPerQuarter * 4 });
  }

  return {
    ticksPerQuarter,
    tracks,
    tempo,
    key: midiKeyToNoteName(keySigSharps, major),
    scale: midiMode(major),
    timeSigNum,
    timeSigDen,
    notes,
  };
}

/** Convert a parsed MIDI file into a BlueprintSong. */
export function midiToBlueprintSong(midi: ParsedMidi, title: string): BlueprintSong {
  const now = new Date().toISOString();
  const song: BlueprintSong = {
    id: crypto.randomUUID(),
    title,
    key: midi.key,
    scale: midi.scale as BlueprintSong["scale"],
    bpm: midi.tempo,
    timeSignatureNumerator: midi.timeSigNum,
    timeSignatureDenominator: midi.timeSigDen,
    sections: [],
    arrangement: [],
    concept: `MIDI import: ${midi.tracks.length} track(s), ${midi.notes.length} notes`,
    provenance: {
      source: "midi-import",
      extractedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  // Simple section detection: divide by note density changes
  if (midi.notes.length > 0 && midi.ticksPerQuarter > 0) {
    // Group notes into bars
    const beatsPerBar = midi.timeSigNum;
    const ticksPerBar = midi.ticksPerQuarter * beatsPerBar;
    const maxTick = midi.notes.reduce((max, n) => Math.max(max, n.endTick), 0);
    const numBars = Math.ceil(maxTick / ticksPerBar);

    // Count notes per bar for density-based sectioning
    const bars: number[][] = new Array(numBars).fill(null).map(() => []);
    for (const n of midi.notes) {
      const bar = Math.floor(n.startTick / ticksPerBar);
      if (bar < numBars) bars[bar].push(n.note);
    }

    // Rough section detection: group consecutive bars
    let sectionIdx = 0;
    let currentSection: BlueprintSection | null = null;
    const MIN_BARS_PER_SECTION = 4;

    // Track the start bar of each detected section so we can slice notes for chord detection
    const sectionBarRanges: Array<{ startBar: number; endBar: number }> = [];

    for (let b = 0; b < bars.length; b++) {
      if (bars[b].length === 0 && currentSection && currentSection.bars >= MIN_BARS_PER_SECTION) {
        // End section on empty bar
        sectionBarRanges[sectionIdx] = { startBar: b - currentSection.bars, endBar: b };
        song.sections.push({ ...currentSection, name: `Section ${String.fromCharCode(65 + sectionIdx)}` });
        currentSection = null;
        sectionIdx++;
        continue;
      }
      if (bars[b].length === 0) continue;

      if (!currentSection) {
        currentSection = {
          id: crypto.randomUUID(),
          name: `Section ${String.fromCharCode(65 + sectionIdx)}`,
          role: sectionIdx === 0 ? "verse" : sectionIdx === 1 ? "chorus" : "bridge",
          bars: MIN_BARS_PER_SECTION,
          chords: [],
          beatsPerChord: 4,
          velocity: "mf",
          timeSignatureNumerator: midi.timeSigNum,
          timeSignatureDenPower: Math.log2(midi.timeSigDen),
        };
      } else {
        currentSection.bars += 1;
      }

      if (currentSection.bars >= MIN_BARS_PER_SECTION * 3) {
        sectionBarRanges[sectionIdx] = { startBar: b - currentSection.bars + 1, endBar: b + 1 };
        song.sections.push({ ...currentSection, name: `Section ${String.fromCharCode(65 + sectionIdx)}` });
        currentSection = null;
        sectionIdx++;
      }
    }
    if (currentSection) {
      sectionBarRanges[sectionIdx] = { startBar: numBars - currentSection.bars, endBar: numBars };
      song.sections.push({ ...currentSection, name: `Section ${String.fromCharCode(65 + sectionIdx)}` });
    }

    // Now detect chords for each section by slicing the notes that fall
    // within that section's bar range and running the chord detector.
    for (let i = 0; i < song.sections.length && i < sectionBarRanges.length; i++) {
      const { startBar, endBar } = sectionBarRanges[i];
      const sectionStartTick = startBar * ticksPerBar;
      const sectionEndTick = endBar * ticksPerBar;
      const sectionDurationBeats = (sectionEndTick - sectionStartTick) / midi.ticksPerQuarter;

      // Collect notes that fall within this section's tick range
      const sectionNotes: ParsedMidi["notes"] = [];
      for (const n of midi.notes) {
        if (n.endTick > sectionStartTick && n.startTick < sectionEndTick) {
          sectionNotes.push(n);
        }
      }

      if (sectionNotes.length > 0 && sectionDurationBeats > 0) {
        const timedNotes = parserNotesToTimed(sectionNotes, midi.ticksPerQuarter, sectionStartTick);
        const chords = detectMidiChords(timedNotes, 0, sectionDurationBeats, midi.timeSigNum, midi.key);
        song.sections[i] = { ...song.sections[i], chords };
      }
    }

    // Add arrangement entries
    song.arrangement = song.sections.map((s) => ({ sectionId: s.id, repeats: 1 }));
  }

  return song;
}