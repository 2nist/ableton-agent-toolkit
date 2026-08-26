/** Harmony preview — audition chords and progressions through the same
 *  selected MIDI port + chords channel the app's live MIDI out uses, so
 *  what you hear in the Harmony tab is what the template's `chord` track
 *  will sound. Pure Web MIDI (desktop Chrome only); on a browser without
 *  MIDI (iPad/Safari) these quietly no-op.
 *
 *  The preview is deliberately light: no lookahead scheduler, just
 *  note-on/note-off blocks via `MIDIOutput.send(data, timestamp)`. For a
 *  short audition that's plenty, and it keeps the Harmony tab free of
 *  transport machinery it doesn't own.
 */

import { chordToMidiNotes, pitchClass, type ChordQuality } from "@music-theory/core";
import { generateBiTonal, BI_TONAL_MATRIX, DEFAULT_COLOR_FLAVOR, type BiTonalChord } from "@platform/progression-engine";
import { getMidiOutput } from "./liveMidiOut";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";

/** Chord voicing register — matches the app's MIDI export / chord clips. */
const CHORD_OCTAVE = 5;
/** Bass register — one root per chord, matches the bass stem. */
const BASS_OCTAVE = 3;
/** Color layer registers — matches the Color stem / engine defaults. */
const COLOR_ANCHOR_OCTAVE = 4;
const COLOR_OCTAVE = 6;
const PREVIEW_VELOCITY = 96;
/** Cap how long each previewed note sustains so a slow progression doesn't
 *  hold one chord while the next is already due. */
const MAX_SUSTAIN_MS = 1600;

let activeTimers: ReturnType<typeof setTimeout>[] = [];

/** Stop any progression preview still running. */
export function cancelPreview(): void {
  for (const t of activeTimers) clearTimeout(t);
  activeTimers = [];
}

/** Resolve the currently-selected MIDI output + the channel to preview on
 *  (defaults to the chords channel). Null when no port is selected — the
 *  preview just stays silent rather than erroring. */
async function previewOutput(channel?: number): Promise<{ output: MIDIOutput; ch: number } | null> {
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return null;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return null;
  return { output, ch: Math.max(0, Math.min(15, (channel ?? channels.chords) - 1)) };
}

function chordPitches(chord: { root: string; quality: string }): number[] {
  return chordToMidiNotes(pitchClass(chord.root), chord.quality as ChordQuality, CHORD_OCTAVE);
}

/** Audition a single chord on the chords channel. */
export async function previewChord(chord: { root: string; quality: string }, durationMs = 1200): Promise<void> {
  const ctx = await previewOutput();
  if (!ctx) return;
  const pitches = chordPitches(chord);
  if (pitches.length === 0) return;
  const now = performance.now() + 20;
  for (const p of pitches) ctx.output.send([0x90 | ctx.ch, p & 0x7f, PREVIEW_VELOCITY], now);
  const off = now + durationMs;
  for (const p of pitches) ctx.output.send([0x80 | ctx.ch, p & 0x7f, 0], off);
}

/** Which extra layers a progression preview should send. Each layer goes to
 *  its own channel from the MIDI setup map (bass ch.2, color ch.4). */
export interface ProgressionPreviewLayers {
  bass?: boolean;
  color?: boolean;
}

/** Schedule a block of notes to start `startMs` from now, sustaining for
 *  `durMs`. Pushed onto the shared timer list so `cancelPreview()` stops it. */
function scheduleBlock(
  ctx: { output: MIDIOutput; ch: number },
  pitches: number[],
  startMs: number,
  durMs: number,
  velocity = PREVIEW_VELOCITY,
): void {
  if (pitches.length === 0) return;
  activeTimers.push(
    setTimeout(() => {
      const now = performance.now() + 20;
      for (const p of pitches) ctx.output.send([0x90 | ctx.ch, p & 0x7f, velocity], now);
      const off = now + Math.min(durMs, MAX_SUSTAIN_MS);
      for (const p of pitches) ctx.output.send([0x80 | ctx.ch, p & 0x7f, 0], off);
    }, Math.max(0, startMs)),
  );
}

/** The bi-tonal color layer for a one-pass chord cycle — the same
 *  `generateBiTonal` call the Color export uses, so the preview's color
 *  line matches what lands on the template's `color` track. */
function colorNotesFor(
  chords: { root: string; quality: string; beats?: number }[],
  flavor?: string,
): { pitch: number; startTime: number; duration: number }[] {
  const biTonal: BiTonalChord[] = chords.map((c) => ({
    rootPc: pitchClass(c.root),
    quality: c.quality,
    durationBeats: c.beats ?? 4,
  }));
  const generated = generateBiTonal(BI_TONAL_MATRIX, flavor ?? DEFAULT_COLOR_FLAVOR, biTonal, {
    anchorOctave: COLOR_ANCHOR_OCTAVE,
    colorOctave: COLOR_OCTAVE,
  });
  return generated.color.map((n) => ({ pitch: n.pitch, startTime: n.startTime, duration: n.duration }));
}

/** Audition a whole progression, one chord block per its beat count, at the
 *  given bpm. `layers.bass` sends roots on the bass channel and
 *  `layers.color` streams the bi-tonal color layer on the color channel.
 *  Restarting cancels any preview already in flight. */
export async function previewProgression(
  chords: { root: string; quality: string; beats?: number }[],
  bpm: number,
  beatsPerChord = 4,
  layers: ProgressionPreviewLayers = {},
  colorFlavor?: string,
): Promise<void> {
  cancelPreview();
  if (chords.length === 0) return;
  const { channels } = useMidiSettingsStore.getState();
  const chordsCtx = await previewOutput(channels.chords);
  if (!chordsCtx) return; // no port selected — nothing to preview
  const bassCtx = layers.bass ? await previewOutput(channels.bass) : null;
  const colorCtx = layers.color ? await previewOutput(channels.color) : null;

  const beatMs = 60000 / Math.max(1, bpm);
  const colorNotes = colorCtx ? colorNotesFor(chords, colorFlavor) : [];
  let cursorMs = 0;

  for (const chord of chords) {
    const beats = chord.beats ?? beatsPerChord;
    const durMs = Math.max(250, beats * beatMs);

    scheduleBlock(chordsCtx, chordPitches(chord), cursorMs, durMs);
    if (bassCtx) {
      const bassPitch = BASS_OCTAVE * 12 + pitchClass(chord.root);
      scheduleBlock(bassCtx, [bassPitch], cursorMs, durMs, 100);
    }
    cursorMs += durMs;
  }

  // Color notes are beat-relative to the chord cycle, so they map onto the
  // same timeline the chord blocks just walked.
  if (colorCtx) {
    for (const n of colorNotes) {
      scheduleBlock(colorCtx, [n.pitch], n.startTime * beatMs, Math.max(150, n.duration * beatMs), 80);
    }
  }
}
