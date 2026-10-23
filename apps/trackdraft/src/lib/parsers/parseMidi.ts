/**
 * Manual MIDI binary parser — no external dependencies.
 * Extracts BPM, key signature, time signature, and notes from a Standard MIDI File.
 * Produces a BlueprintSong skeleton with chord detection for every detected section.
 */

import type { BlueprintSong, BlueprintSection, SectionRole } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";
import { detectMidiChords, parserNotesToTimed } from "./midiChordDetect";
import {
  classifyTracks,
  drumsToBlocks,
  melodyFromTrack,
  type TrackRole,
} from "./midiTracks";
import {
  inferChordProgression,
  inferSectionsFromChords,
  inferredChordsToBlueprint,
} from "./melodyHarmony";

interface MidiEvent {
  tick: number;
  type:
    | "noteOn"
    | "noteOff"
    | "programChange"
    | "tempo"
    | "timeSig"
    | "keySig"
    | "trackName"
    | "instrumentName"
    | "endOfTrack"
    | "unknown";
  /** 0-based MIDI channel, as the status nibble carries it. */
  channel?: number;
  note?: number;       // MIDI note number 0-127
  velocity?: number;
  tempo?: number;       // microseconds per quarter note
  timeSigNum?: number;
  timeSigDen?: number;
  keySigSharps?: number; // negative = flats
  major?: boolean;
  name?: string;
  /** GM program number as written in the file (0-based on the wire). */
  program?: number;
}

interface MidiTrack {
  events: MidiEvent[];
  name?: string;
}

/** A meter change as written in the file, in absolute ticks. */
export interface MidiTimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
}

/** A tempo change as written in the file, in absolute ticks. */
export interface MidiTempoChange {
  tick: number;
  bpm: number;
}

interface ParsedMidi {
  ticksPerQuarter: number;
  tracks: MidiTrack[];
  tempo: number;       // BPM
  key: NoteName;
  scale: string;
  timeSigNum: number;
  timeSigDen: number;
  /** Every distinct meter in the file, by tick — a single `timeSigNum` cannot
   *  describe a song that changes meter, and these are overwhelmingly the
   *  files where it matters. */
  timeSignatures: MidiTimeSignature[];
  tempoChanges: MidiTempoChange[];
  notes: Array<{ note: number; velocity: number; startTick: number; endTick: number; track: number; channel: number }>;
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
        case 0x04: // Instrument name
          events.push({ tick, type: "instrumentName", name: new TextDecoder().decode(metaData) });
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
    } else if (command === 0xc0) {
      // Program change — one data byte, kept so an imported file's instrument
      // intent can be read back (see `midiExport`'s program-change writing).
      if (offset >= end) break;
      events.push({ tick, type: "programChange", channel, program: data[offset++] });
    } else {
      // Other channel events — skip parameter bytes
      const paramCount = command === 0xd0 ? 1 : 2;
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
  // Every meter and tempo in the file, deduped by tick. Several tracks
  // typically repeat the same meter event; and "last one wins" — the old
  // behaviour — meant a stray 1/8 bar at the end decided the whole song's
  // meter (Nanook Rubs It imported as 653 bars instead of 109).
  const meterByTick = new Map<number, MidiTimeSignature>();
  const tempoByTick = new Map<number, MidiTempoChange>();

  for (const track of tracks) {
    for (const event of track.events) {
      if (event.type === "tempo" && event.tempo) {
        tempoByTick.set(event.tick, { tick: event.tick, bpm: Math.round(60000000 / event.tempo) });
      }
      if (event.type === "keySig") {
        keySigSharps = event.keySigSharps ?? 0;
        major = event.major ?? true;
      }
      if (event.type === "timeSig") {
        meterByTick.set(event.tick, {
          tick: event.tick,
          numerator: event.timeSigNum ?? 4,
          denominator: event.timeSigDen ?? 4,
        });
      }
    }
  }

  const timeSignatures = [...meterByTick.values()].sort((a, b) => a.tick - b.tick);
  const tempoChanges = [...tempoByTick.values()].sort((a, b) => a.tick - b.tick);

  // The song opens at its first tempo and first meter; both are what the
  // editor shows and what a new chord defaults to.
  if (tempoChanges.length > 0) tempo = tempoChanges[0].bpm;
  const opening = timeSignatures[0];
  const timeSigNum = opening?.numerator ?? 4;
  const timeSigDen = opening?.denominator ?? 4;

  // Collect all notes with on/off pairing. The same pitch can retrigger
  // before its noteOff (flams, ghost-note stacks — common in real drum
  // takes), so each key holds a FIFO queue: a noteOff closes the *oldest*
  // open noteOn. A single-slot map used to overwrite the older noteOn,
  // mispairing the ends and silently dropping notes.
  const noteOns: Map<string, Array<{ note: number; velocity: number; startTick: number; channel: number; track: number }>> = new Map();
  const notes: ParsedMidi["notes"] = [];

  for (let t = 0; t < tracks.length; t++) {
    for (const event of tracks[t].events) {
      if (event.type === "noteOn" && event.note != null) {
        const key = `${event.channel}-${event.note}`;
        const entry = {
          note: event.note,
          velocity: event.velocity ?? 64,
          startTick: event.tick,
          channel: event.channel ?? 0,
          track: t,
        };
        const queue = noteOns.get(key);
        if (queue) queue.push(entry);
        else noteOns.set(key, [entry]);
      }
      if (event.type === "noteOff" && event.note != null) {
        const key = `${event.channel}-${event.note}`;
        const queue = noteOns.get(key);
        const on = queue?.shift();
        if (on) {
          notes.push({
            note: on.note,
            velocity: on.velocity,
            startTick: on.startTick,
            endTick: event.tick,
            track: on.track,
            channel: on.channel,
          });
          if (queue!.length === 0) noteOns.delete(key);
        }
      }
    }
  }
  // Close any hanging notes at max tick
  const maxTick = notes.reduce((max, n) => Math.max(max, n.endTick), 0);
  for (const [, queue] of noteOns) {
    for (const on of queue) {
      notes.push({ ...on, endTick: maxTick + ticksPerQuarter * 4 });
    }
  }

  return {
    ticksPerQuarter,
    tracks,
    tempo,
    key: midiKeyToNoteName(keySigSharps, major),
    scale: midiMode(major),
    timeSigNum,
    timeSigDen,
    timeSignatures,
    tempoChanges,
    notes,
  };
}

/**
 * The file's meter as a bar map. A song with one meter returns no map at all,
 * so its import is byte-identical to before; a song that changes meter
 * returns one entry per *distinct* meter run, plus the average bar length,
 * which is what the bar-window algorithms (chord inference, section
 * inference, drum blocks) need when no single bar length exists.
 */
function midiTiming(midi: ParsedMidi): {
  bars: number;
  sectionBeats: number;
  beatsPerBar: number;
  meterMap?: { bar: number; numerator: number; denominator: number }[];
} {
  const maxTick = midi.notes.reduce((max, n) => Math.max(max, n.endTick), 0);
  const declared = { numerator: midi.timeSigNum, denominator: midi.timeSigDen };
  const declaredBpb = (declared.numerator * 4) / declared.denominator;

  const written = midi.timeSignatures.length > 0 ? midi.timeSignatures : [{ tick: 0, ...declared }];
  // A file whose first meter event lands after the music starts still opens
  // in that meter — there is no other information to go on.
  const changes =
    written[0].tick > 0
      ? [{ tick: 0, numerator: written[0].numerator, denominator: written[0].denominator }, ...written]
      : written;

  const runs: { bar: number; numerator: number; denominator: number; beats: number }[] = [];
  let barCursor = 0;
  for (let i = 0; i < changes.length; i += 1) {
    const start = changes[i].tick;
    // Meter events can sit past the last note — a stray tail appended to the
    // file — and must not stretch the song. WildLove is exactly this: its
    // meters live at tick 1.96M while the music ends at 74k.
    if (start >= maxTick) break;
    const end = Math.min(maxTick, i + 1 < changes.length ? changes[i + 1].tick : maxTick);
    const bpb = (changes[i].numerator * 4) / changes[i].denominator;
    const beats = Math.max(0, end - start) / midi.ticksPerQuarter;
    const bar = Math.round(barCursor);
    const previous = runs[runs.length - 1];
    // The same meter restated at a later bar is not a change.
    if (!previous || previous.numerator !== changes[i].numerator || previous.denominator !== changes[i].denominator) {
      runs.push({ bar, numerator: changes[i].numerator, denominator: changes[i].denominator, beats });
    } else {
      previous.beats += beats;
    }
    barCursor += beats / bpb;
  }

  const totalBeats = runs.reduce((sum, run) => sum + run.beats, 0);
  const bars = Math.max(1, Math.round(barCursor));
  const distinct = new Set(runs.map((run) => `${run.numerator}/${run.denominator}`)).size;
  if (distinct <= 1) {
    return { bars, sectionBeats: bars * declaredBpb, beatsPerBar: declaredBpb };
  }

  // Trim: a run past the last whole bar would over-extend the section.
  const meterMap = runs
    .filter((run) => run.bar < bars)
    .map(({ bar, numerator, denominator }) => ({ bar, numerator, denominator }));
  const sectionBeats = bars > 0 ? (totalBeats / barCursor) * bars : totalBeats;
  return {
    bars,
    sectionBeats,
    beatsPerBar: bars > 0 ? sectionBeats / bars : declaredBpb,
    meterMap: meterMap.length > 1 ? meterMap : undefined,
  };
}

/** Below one chord per four bars, frame matching has clearly missed the
 *  harmony and the pitch-class fallback is the better read. */
const CHORD_DENSITY_FLOOR = 0.25;

/** Parser notes (absolute ticks) as beats-from-start — the shape the
 *  pitch-class inference walks. Overlaps are fine: it accumulates pitch
 *  classes, so a whole band at once is exactly what it wants. */
function beatsOf(
  notes: ParsedMidi["notes"],
  ticksPerQuarter: number,
): { pitch: number; startTime: number; duration: number }[] {
  if (ticksPerQuarter <= 0) return [];
  return notes.map((note) => ({
    pitch: note.note,
    startTime: note.startTick / ticksPerQuarter,
    duration: Math.max(1 / ticksPerQuarter, (note.endTick - note.startTick) / ticksPerQuarter),
  }));
}

/** Convert a parsed MIDI file into a BlueprintSong. */
export function midiToBlueprintSong(midi: ParsedMidi, title: string): BlueprintSong {
  const now = new Date().toISOString();
  const timing = midiTiming(midi);
  const bars = timing.bars;
  const sectionBeats = timing.sectionBeats;
  const beatsPerBar = timing.beatsPerBar;

  // Which track is which. This is the difference between importing a song and
  // inventing one: a melody-only file has no harmony to detect, and stacking
  // its line with other tracks used to manufacture chords that were never
  // written. See midiTracks.ts.
  const trackNames = Object.fromEntries(midi.tracks.map((track, index) => [index, track.name]));
  const profiles = classifyTracks(midi.notes, trackNames);
  const rolesOf = (role: TrackRole) => profiles.filter((p) => p.role === role);
  const harmonyTracks = new Set(rolesOf("harmony").map((p) => p.track));
  const melodyTrack = rolesOf("melody")[0] ?? null;
  const drumTrack = rolesOf("drums")[0] ?? null;
  const bassTrack = rolesOf("bass")[0] ?? null;

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

  const warnings: string[] = [];

  // One honest section covering the real length of the file. Section
  // structure is not recoverable from a monophonic line, and the previous
  // "every 12 bars is a section" carving named invented sections A, B, C…
  // A single full-song section says what we actually know.
  const section: BlueprintSection = {
    id: crypto.randomUUID(),
    name: "Full Song",
    role: "verse",
    bars,
    chords: [],
    beatsPerChord: midi.timeSigNum,
    velocity: "mf",
    timeSignatureNumerator: midi.timeSigNum,
    timeSignatureDenPower: Math.log2(midi.timeSigDen),
    ...(timing.meterMap ? { meterMap: timing.meterMap } : {}),
  };

  if (timing.meterMap) {
    const changes = timing.meterMap.map((change, i) => {
      const next = timing.meterMap?.[i + 1]?.bar;
      const span = (next ?? bars) - change.bar;
      return `${change.numerator}/${change.denominator}×${span}`;
    });
    warnings.push(
      `meter CHANGES ${changes.length} time(s) inside the song (${changes.join(" ")}); the section carries a per-bar meter map rather than one meter`,
    );
    warnings.push(
      "generated drum grooves follow the section's opening meter — imported drum blocks keep their exact timing, but a groove the engine generates will drift on the odd bars",
    );
  }
  if (midi.tempoChanges.length > 1) {
    warnings.push(
      `tempo changes ${midi.tempoChanges.length} times (${midi.tempoChanges.map((c) => c.bpm).join(" → ")}); the song uses the opening tempo, and the map is not applied to playback`,
    );
  }

  // Harmony: only from polyphonic tracks. A melody-only file keeps an empty
  // progression rather than a fabricated one.
  if (harmonyTracks.size > 0) {
    const harmonyNotes = midi.notes.filter((n) => harmonyTracks.has(n.track));
    section.chords = detectMidiChords(
      parserNotesToTimed(harmonyNotes, midi.ticksPerQuarter, 0),
      0,
      sectionBeats,
      midi.timeSigNum,
      midi.key,
    );

    // Frame matching needs chord tones to sound *together*. A full-score
    // arrangement spreads them across instruments and time, so it under-reads
    // badly — DirtyLove has 75 bars and detected one chord. When the frame
    // pass is that sparse, fall back to a bar-window pitch-class histogram
    // over every harmonic track plus the bass (which is what actually states
    // the roots), using the same Viterbi the melody-only path uses.
    const density = section.chords.length / Math.max(1, bars);
    if (density < CHORD_DENSITY_FLOOR) {
      const content = midi.notes.filter(
        (n) => harmonyTracks.has(n.track) || (bassTrack !== null && n.track === bassTrack.track),
      );
      const window = beatsPerBar > 0 ? beatsPerBar : midi.timeSigNum;
      const inferred = inferChordProgression(beatsOf(content, midi.ticksPerQuarter), {
        keyName: midi.key,
        scale: midi.scale as BlueprintSong["scale"],
        beatsPerBar: window,
        totalBeats: sectionBeats,
      });
      if (inferred.length > 0) {
        section.chords = inferredChordsToBlueprint(inferred, midi.key, midi.scale as BlueprintSong["scale"]);
        warnings.push(
          `chords INFERRED from the harmonic tracks (${section.chords.length} chords over ${bars} bars): frame matching found only ${Math.round(
            density * 100,
          ) / 100} chord(s) per bar, so chord tones are spread across instruments rather than struck together — review the progression`,
        );
        warnings.push("inferred chords are diatonic to the key plus V7; a chromatic chart will be approximated");
      } else {
        warnings.push(`harmony track(s) ${[...harmonyTracks].join(", ")} produced no chords`);
      }
    }
  } else if (!melodyTrack) {
    warnings.push("no polyphonic track and no melody — chords left empty");
  }

  if (melodyTrack) {
    const melodyNotes = midi.notes.filter((n) => n.track === melodyTrack.track);
    const notes = melodyFromTrack(melodyNotes, midi.ticksPerQuarter, 0);
    if (notes.length > 0) {
      section.melody = { notes, source: "recorded" };
    }
  } else {
    warnings.push("no monophonic track — no melody imported");
  }

  // No harmony track (the melody-only corpora): infer the harmony the line
  // implies. This is a guess and is always labelled as one — the file has no
  // chords in it, so anything here comes from the melody plus the key.
  if (harmonyTracks.size === 0 && section.melody?.notes.length) {
    const inferred = inferChordProgression(section.melody.notes, {
      keyName: midi.key,
      scale: midi.scale as BlueprintSong["scale"],
      beatsPerBar,
      totalBeats: sectionBeats,
    });
    if (inferred.length > 0) {
      section.chords = inferredChordsToBlueprint(inferred, midi.key, midi.scale as BlueprintSong["scale"]);
      warnings.push(
        `chords INFERRED from the melody against ${midi.key} ${midi.scale} — the file contains no harmony track, so review these`,
      );
    }
    // Structure, from repeated harmonic material — the only repeat signal a
    // melody-only file has. Empty when nothing repeats convincingly.
    const inferredStructure = inferSectionsFromChords(inferred, { beatsPerBar, bars });
    if (inferredStructure.length > 1) {
      /** A slice of the song as its own section: only the bars it owns, with
       *  the melody rebased and the harmony re-inferred for that stretch.
       *  Cloning the full section would repeat the whole line in every part. */
      const sliceSection = (part: { startBar: number; bars: number; label: string; role: SectionRole }) => {
        const fromBeat = part.startBar * beatsPerBar;
        const toBeat = Math.min(sectionBeats, fromBeat + part.bars * beatsPerBar);
        const sliceBeats = toBeat - fromBeat;

        const notes = (section.melody?.notes ?? [])
          .filter((note) => note.startTime < toBeat - 1e-6 && note.startTime + note.duration > fromBeat + 1e-6)
          .map((note) => {
            const start = Math.max(0, note.startTime - fromBeat);
            const end = Math.min(sliceBeats, note.startTime + note.duration - fromBeat);
            return {
              pitch: note.pitch,
              startTime: Math.round(start * 1000) / 1000,
              duration: Math.max(1 / midi.ticksPerQuarter, Math.round((end - start) * 1000) / 1000),
              velocity: note.velocity,
            };
          });

        const sliceChords = inferChordProgression(notes, {
          keyName: midi.key,
          scale: midi.scale as BlueprintSong["scale"],
          beatsPerBar,
          totalBeats: sliceBeats,
        });

        return {
          ...section,
          id: crypto.randomUUID(),
          name: part.label,
          role: part.role,
          bars: Math.max(1, Math.round(sliceBeats / beatsPerBar)),
          chords: inferredChordsToBlueprint(sliceChords, midi.key, midi.scale as BlueprintSong["scale"]),
          melody: notes.length > 0 ? { notes, source: "recorded" as const } : undefined,
          drumBlocks: section.drumBlocks,
        };
      };

      const structureSections = inferredStructure.map(sliceSection);
      song.sections = structureSections;
      song.arrangement = structureSections.map((part) => ({ sectionId: part.id, repeats: 1 }));
      song.provenance = {
        ...song.provenance,
        source: "midi-import",
        extractedAt: now,
        warnings: [
          ...warnings,
          `sections INFERRED from repeated harmonic material (${inferredStructure
            .map((part) => `${part.label}:${part.bars}b`)
            .join(" ")}) — rename them in Structure`,
        ],
      };
      return song;
    }
  }

  if (drumTrack) {
    const { blocks, unmapped } = drumsToBlocks(
      midi.notes.filter((n) => n.track === drumTrack.track),
      midi.ticksPerQuarter,
      0,
      sectionBeats,
    );
    if (blocks.length > 0) section.drumBlocks = blocks;
    if (unmapped > 0) warnings.push(`${unmapped} percussion hit(s) had no GM voice mapping`);
  }

  const skipped = rolesOf("ignored");
  if (skipped.length > 0) {
    warnings.push(
      `track(s) ${skipped.map((p) => p.track).join(", ")} ignored (${skipped[0].reason})`,
    );
  }

  song.sections = [section];
  song.arrangement = [{ sectionId: section.id, repeats: 1 }];
  song.provenance = {
    ...song.provenance,
    source: "midi-import",
    extractedAt: now,
    warnings: [
      ...warnings,
      `tracks: ${profiles.map((p) => `${p.track}=${p.role}`).join(", ") || "none"}`,
    ],
  };

  return song;
}
