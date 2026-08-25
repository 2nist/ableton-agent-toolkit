/**
 * Pure transformation from a Progression Studio result (degrees + qualities
 * + durations in a key) into NoteDescription[] ready for MidiClip.notes.
 * No SDK dependency beyond the NoteDescription type, so it's unit-testable
 * without @platform/test-harness.
 */

import {
  buildChord,
  chordName,
  chordToMidiNotes,
  pitchClass,
  type ChordQuality,
  type Degree,
  type NoteName,
} from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  BI_TONAL_MATRIX,
  generateBiTonal,
  generateMelody,
  type BiTonalOptions,
  type MelodyChord,
  type MelodyModel,
  type MelodyOptions,
} from "@platform/progression-engine";

export interface StudioChord {
  degree: Degree;
  quality: ChordQuality;
  durationBeats: number;
}

export interface StudioResult {
  key: NoteName;
  octave: number;
  chords: StudioChord[];
  /** Set by the webview: "melody" when the Generate Melody flow was used. */
  mode?: "studio" | "melody";
  /** Whether the Melody checkbox is on (one modal drives chords+melody+color). */
  melody?: boolean;
  /** Melody density (max note length in beats) chosen in the modal. */
  maxNoteBeats?: number;
  /** Whether the key select was synced to Live's scale root. */
  useLiveKey?: boolean;
  /** Live's key + time signature echoed back (informational / for the log). */
  live?: { rootNote: number; scaleName: string; signatureNumerator: number; signatureDenominator: number } | null;
  /** Bi-tonal flavor id (e.g. "sci_fi_wonder") when a color layer is requested. */
  biTonalFlavor?: string;
}

export interface RenderedProgression {
  notes: NoteDescription[];
  totalBeats: number;
  /** Human-readable chord labels, e.g. "C - G - Am - F". */
  name: string;
}

const DEFAULT_VELOCITY = 96;

/**
 * Octave in @music-theory/core's numbering (octave*12+pc): octave 4 = MIDI 48
 * (one below "middle C" — a comfortable low-mid register for block chords),
 * octave 5 = MIDI 60 ("middle C" as Ableton displays it). The studio's octave
 * select spans 0-5 and defaults to 4.
 */
export const DEFAULT_OCTAVE = 4;

export function renderStudioResult(result: StudioResult): RenderedProgression {
  const notes: NoteDescription[] = [];
  const names: string[] = [];
  let cursor = 0;
  for (const chord of result.chords) {
    const rootPc = pitchClass(buildChord(result.key, chord.degree, "ionian").root);
    names.push(chordName(rootPc, chord.quality, result.key));
    for (const pitch of chordToMidiNotes(rootPc, chord.quality, result.octave)) {
      notes.push({ pitch, startTime: cursor, duration: chord.durationBeats, velocity: DEFAULT_VELOCITY });
    }
    cursor += chord.durationBeats;
  }
  return { notes, totalBeats: cursor, name: names.join(" - ") };
}

/** Map a studio result to the melody engine's chord shape (absolute roots). */
function toMelodyChords(result: StudioResult): MelodyChord[] {
  return result.chords.map((chord) => ({
    rootPc: pitchClass(buildChord(result.key, chord.degree, "ionian").root),
    quality: chord.quality,
    durationBeats: chord.durationBeats,
  }));
}

/**
 * Render a monophonic melody that rides the studio's progression, generated
 * from the general-MIDI corpus melody model. Melody notes are derived from
 * the chord roots (same key/degrees) and quantized to chord boundaries, so it
 * lands cleanly on top of the block-chord clip.
 */
export function renderMelodyResult(
  result: StudioResult,
  model: MelodyModel,
  opts: MelodyOptions = {},
): RenderedProgression {
  const generated = generateMelody(model, toMelodyChords(result), {
    ...opts,
    maxNoteBeats: result.maxNoteBeats ?? opts.maxNoteBeats ?? 4,
  });
  const names = result.chords.map((c) => {
    const rootPc = pitchClass(buildChord(result.key, c.degree, "ionian").root);
    return chordName(rootPc, c.quality, result.key);
  });
  return { notes: generated.notes, totalBeats: generated.totalBeats, name: `Melody · ${names.join(" - ")}` };
}

/**
 * Combine block chords + melody into a single note list for a SESSION clip
 * (a clip slot holds exactly one clip, so chords and melody must share it).
 * Melody notes are already one register above the chords, so they layer on top.
 */
export function mergeChordsAndMelody(
  chords: RenderedProgression,
  melody: RenderedProgression,
): RenderedProgression {
  return {
    notes: [...chords.notes, ...melody.notes],
    totalBeats: Math.max(chords.totalBeats, melody.totalBeats),
    name: `${chords.name} + melody`,
  };
}

/**
 * Render a BI-TONAL clip for the progression under a flavor: the anchor block
 * chords stay (Instrument A, low, sustained) and a color chord on the shifted
 * root is layered above (Instrument B, high, syncopated). Both voices are
 * merged into one NoteDescription list so the clip is self-contained — the two
 * registers keep them musically separated.
 */
export function renderBiTonalResult(
  result: StudioResult,
  flavorId: string,
  opts: BiTonalOptions = {},
): RenderedProgression {
  const chords = toMelodyChords(result); // rootPc + quality + durationBeats
  const generated = generateBiTonal(BI_TONAL_MATRIX, flavorId, chords, {
    ...opts,
    anchorOctave: result.octave,
  });
  const notes = [...generated.anchor, ...generated.color].sort(
    (a, b) => a.startTime - b.startTime || a.pitch - b.pitch,
  );
  const names = result.chords.map((c) => {
    const rootPc = pitchClass(buildChord(result.key, c.degree, "ionian").root);
    return chordName(rootPc, c.quality, result.key);
  });
  return {
    notes,
    totalBeats: generated.totalBeats,
    name: `${names.join(" - ")} · ${flavorId.replace(/_/g, " ")}`,
  };
}

/**
 * Render ONLY the bi-tonal COLOR layer (Instrument B — the high, syncopated
 * chord on the shifted root) as its own note list, for a dedicated MIDI track.
 * The anchor block chords stay on the original track; this is the separate
 * "color" instrument the bi-tonal design calls for.
 */
export function renderBiTonalColorResult(
  result: StudioResult,
  flavorId: string,
  opts: BiTonalOptions = {},
): RenderedProgression {
  const generated = generateBiTonal(BI_TONAL_MATRIX, flavorId, toMelodyChords(result), {
    ...opts,
    anchorOctave: result.octave,
  });
  const names = result.chords.map((c) => {
    const rootPc = pitchClass(buildChord(result.key, c.degree, "ionian").root);
    return chordName(rootPc, c.quality, result.key);
  });
  return {
    notes: generated.color,
    totalBeats: generated.totalBeats,
    name: `Color · ${names.join(" - ")} · ${flavorId.replace(/_/g, " ")}`,
  };
}
