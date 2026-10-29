/**
 * Web MIDI consumer for the ATOM SQ's User mode.
 *
 * When the ATOM SQ is in User mode (the User button on the controller),
 * the encoders and display buttons send MIDI on channels 10-17
 * (USER_MODE_START_CHANNEL = 10 in Ableton's control script). This
 * module listens for those messages via the Web MIDI API and dispatches
 * them to the song store and preview player — no relay server needed.
 *
 * Call `startAtomSqUserMidi()` once at app init to begin listening.
 */

import { useSongStore } from "../../store/songStore";
import { getSongTransport } from "./songTransport";
import { getAbletonClock } from "./abletonClock";
import type { BlueprintSong } from "../../types/blueprint";
import type { ChordQuality, ScaleType } from "@music-theory/core";

// ---------------------------------------------------------------------------
// MIDI channel constants (USER_MODE_START_CHANNEL = 10, channels 10-17)
// ---------------------------------------------------------------------------

const USER_CHANNEL_BASE = 10; // channel 9 (0-based)
const USER_CHANNEL_COUNT = 8;

// ---------------------------------------------------------------------------
// Ordered value lists for encoder-controlled parameters
// ---------------------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_TYPES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];
const CHORD_QUALITIES: ChordQuality[] = ["maj", "min", "dim", "aug", "7", "maj7", "min7", "m7b5", "sus2", "sus4"];
const VELOCITY_PRESETS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"] as const;

// ---------------------------------------------------------------------------
// Encoder resolution: CC 14 + channel offset → semantic target
// ---------------------------------------------------------------------------

type EncoderTarget =
  | "scale_root"
  | "scale_type"
  | "chord_degree"
  | "chord_quality"
  | "chord_inversion"
  | "chord_voicing"
  | "tempo"
  | "velocity_preset";

function encoderTarget(channelOffset: number): EncoderTarget | null {
  switch (channelOffset) {
    case 0: return "scale_root";
    case 1: return "scale_type";
    case 2: return "chord_degree";
    case 3: return "chord_quality";
    case 4: return "chord_inversion";
    case 5: return "chord_voicing";
    case 6: return "tempo";
    case 7: return "velocity_preset";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: rotate through a list based on relative encoder direction
// ---------------------------------------------------------------------------

function rotateIndex(current: number, length: number, direction: number): number {
  if (length <= 0) return 0;
  return ((current + direction) % length + length) % length;
}

function encoderDirection(raw: number): number {
  // Most relative encoders send ±1, but some firmware uses signed 8-bit
  // (1-63 = positive, 65-127 = negative per MIDI conventions).
  return raw > 63 ? raw - 128 : raw;
}

// ---------------------------------------------------------------------------
// Dispatch an encoder turn to the appropriate store action
// ---------------------------------------------------------------------------

function handleEncoder(target: EncoderTarget, rawValue: number, song: BlueprintSong) {
  const dir = encoderDirection(rawValue);
  const delta = Math.sign(dir);
  if (delta === 0) return;

  const store = useSongStore.getState();

  switch (target) {
    case "scale_root": {
      const idx = NOTE_NAMES.indexOf(song.key);
      const next = NOTE_NAMES[rotateIndex(idx >= 0 ? idx : 0, NOTE_NAMES.length, delta)]!;
      store.updateCurrentSong((s) => ({ ...s, key: next }));
      // Push to Ableton when the bridge is connected.
      getAbletonClock().sendCommand("/live/song/set/root_note", [next]);
      break;
    }
    case "scale_type": {
      const idx = SCALE_TYPES.indexOf(song.scale);
      const next = SCALE_TYPES[rotateIndex(idx >= 0 ? idx : 0, SCALE_TYPES.length, delta)]!;
      store.updateCurrentSong((s) => ({ ...s, scale: next }));
      getAbletonClock().sendCommand("/live/song/set/scale_name", [next]);
      break;
    }
    case "chord_degree": {
      // Placeholder — no local audio to preview against anymore (TrackDraft
      // is MIDI-only; sound comes from Ableton). Nothing to advance here
      // until this drives real selection state instead.
      break;
    }
    case "chord_quality": {
      const section = song.sections.find((s) => s.chords.length > 0);
      if (!section) return;
      const chord = section.chords[0];
      if (!chord) return;
      const qIdx = CHORD_QUALITIES.indexOf(chord.quality);
      const nextQuality = CHORD_QUALITIES[rotateIndex(qIdx >= 0 ? qIdx : 0, CHORD_QUALITIES.length, delta)]!;
      store.updateCurrentSong((s) => ({
        ...s,
        sections: s.sections.map((sec) =>
          sec.id === section.id
            ? {
                ...sec,
                chords: sec.chords.map((c, i) =>
                  i === 0 ? { ...c, quality: nextQuality } : c,
                ),
              }
            : sec,
        ),
      }));
      break;
    }
    case "chord_inversion": {
      // Placeholder for future voicing inversion.
      break;
    }
    case "chord_voicing": {
      // Placeholder for future extended voicing control.
      break;
    }
    case "tempo": {
      const bpm = Math.min(300, Math.max(20, song.bpm + delta));
      store.updateCurrentSong((s) => ({ ...s, bpm }));
      getAbletonClock().sendCommand("/live/song/set/tempo", [bpm]);
      break;
    }
    case "velocity_preset": {
      const curVelocity = song.sections[0]?.velocity ?? "mf";
      const vIdx = VELOCITY_PRESETS.indexOf(curVelocity);
      const next = VELOCITY_PRESETS[rotateIndex(vIdx >= 0 ? vIdx : 4, VELOCITY_PRESETS.length, delta)]!;
      store.updateCurrentSong((s) => ({
        ...s,
        sections: s.sections.map((sec) => ({ ...sec, velocity: next })),
      }));
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch a display button press
// ---------------------------------------------------------------------------

function handleDisplayButton(index: number, song: BlueprintSong) {
  const transport = getSongTransport();

  switch (index) {
    case 2: {
      // Toggle transport playback.
      if (transport.getIsPlaying()) {
        transport.stop();
      } else {
        transport.play(song);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Web MIDI setup
// ---------------------------------------------------------------------------

let midiAccess: MIDIAccess | null = null;
let registered = false;

/**
 * Begin listening for ATOM SQ User-mode MIDI messages. Safe to call
 * multiple times — subsequent calls are no-ops once registered.
 * The browser will prompt the user to grant MIDI access on first call.
 */
export async function startAtomSqUserMidi(): Promise<void> {
  if (registered) return;

  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    console.warn("[userMidi] Web MIDI API not available in this browser");
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    console.warn("[userMidi] MIDI access denied or unavailable", err);
    return;
  }

  for (const input of midiAccess.inputs.values()) {
    if (isAtomSq(input)) {
      input.onmidimessage = handleMidiMessage;
    }
  }

  // Listen for newly connected devices.
  midiAccess.onstatechange = () => {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
      if (isAtomSq(input) && !input.onmidimessage) {
        input.onmidimessage = handleMidiMessage;
      }
    }
  };

  registered = true;
}

function isAtomSq(input: MIDIInput): boolean {
  const name = (input.name ?? "").toLowerCase();
  return name.includes("atom sq") || name.includes("atm sq");
}

// ---------------------------------------------------------------------------
// MIDI message handler
// ---------------------------------------------------------------------------

function handleMidiMessage(event: MIDIMessageEvent) {
  const bytes = event.data;
  if (!bytes || bytes.length < 2) return;
  const status = bytes[0]!;
  const data2 = bytes.length > 2 ? bytes[2]! : 0;

  const channel = status & 0x0f; // 0-based
  const isUserChannel = channel >= USER_CHANNEL_BASE - 1 && channel < USER_CHANNEL_BASE - 1 + USER_CHANNEL_COUNT;
  if (!isUserChannel) return;

  const channelOffset = channel - (USER_CHANNEL_BASE - 1);

  const isCC = (status & 0xf0) === 0xb0;
  const isNote = (status & 0xf0) === 0x90;

  if (isCC) {
    const target = encoderTarget(channelOffset);
    if (target) {
      const song = useSongStore.getState().currentSong();
      if (song) handleEncoder(target, data2, song);
    }
  } else if (isNote && data2 > 0) {
    // Only fire on note-on (velocity > 0) to avoid double-triggering.
    const song = useSongStore.getState().currentSong();
    if (song && channelOffset >= 0 && channelOffset <= 5) {
      handleDisplayButton(channelOffset, song);
    }
  }
}

/** Stop listening and release MIDI access. */
export function stopAtomSqUserMidi(): void {
  if (midiAccess) {
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = null;
    }
    midiAccess = null;
  }
  registered = false;
}