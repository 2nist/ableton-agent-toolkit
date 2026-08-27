/**
 * Color stem — the bi-tonal "Color Chord" layer, generated per section
 * from the same `@platform/progression-engine` generator Progression
 * Studio's Color track uses (`renderBiTonalColorResult`), so the Color
 * voice that comes out of MIDI export / Send to Ableton / real-time MIDI
 * out is the same one the extension writes to Live.
 *
 * Pure + browser-safe: the engine only depends on `@music-theory/core`.
 * The blueprint `Chord` already carries absolute roots, so converting to
 * the engine's `BiTonalChord` shape is a straight field map — no
 * degree→root rebuild needed (unlike the modal path, which has to derive
 * roots from degrees).
 */

import { pitchClass } from "@music-theory/core";
import {
  generateBiTonal,
  BI_TONAL_MATRIX,
  DEFAULT_COLOR_FLAVOR,
  type BiTonalChord,
  type BiTonalOptions,
} from "@platform/progression-engine";
import type { SectionSpan } from "./arrangement";
import { resolveChordOccurrences, type MidiNote } from "./midiExport";
/** Octave of the bi-tonal anchor foundation (Instrument A). Matches the
 *  engine's own default of 4 and Progression Studio's `anchorOctave`. */
const COLOR_ANCHOR_OCTAVE = 4;
/** Color notes ride two octaves above the anchor by default (Instrument
 *  B's default register) — clearly above the Chords track's block chords.
 *  A section's `colorOctave` overrides this per section. */
export const DEFAULT_COLOR_OCTAVE = 6;

/** One blueprint `Chord` → the shape `generateBiTonal` wants. */
function chordToBiTonal(chord: { root: string; quality: string; beats: number }): BiTonalChord {
  return { rootPc: pitchClass(chord.root), quality: chord.quality, durationBeats: chord.beats };
}

/** The section's chords looped to fill its full duration — the same fill
 *  math the Chords/Bass stems use, so the Color layer spans the whole
 *  section rather than just one pass through its chord cycle. */
/** The section's chords resolved to fill its full duration — the same
 *  occurrence math as the Chords/Bass stems (including Euclidean harmony
 *  when the section carries a `harmonyMeterOutline`), so the Color layer
 *  spans the whole section rather than just one pass through its cycle. */
function sectionChordsFilled(span: SectionSpan): BiTonalChord[] {
  return resolveChordOccurrences(span.section, span.durationBeats).map((occ) => ({
    ...chordToBiTonal(occ.chord),
    durationBeats: occ.duration,
  }));
}

/** The Color Chord layer for the whole song — one continuous stem, each
 *  section's bi-tonal color notes offset to its real start beat.
 *  `colorFlavor` is read per section, falling back to the engine's
 *  `DEFAULT_COLOR_FLAVOR` when a section doesn't set one. */
export function planColorStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const chords = sectionChordsFilled(span);
    if (chords.length === 0) continue;
    const opts: BiTonalOptions = {
      anchorOctave: COLOR_ANCHOR_OCTAVE,
      colorOctave: span.section.colorOctave ?? DEFAULT_COLOR_OCTAVE,
    };
    const generated = generateBiTonal(BI_TONAL_MATRIX, span.section.colorFlavor ?? DEFAULT_COLOR_FLAVOR, chords, opts);
    for (const n of generated.color) {
      notes.push({
        pitch: n.pitch,
        startTime: span.startBeat + n.startTime,
        duration: n.duration,
        velocity: n.velocity ?? 80,
      });
    }
  }
  return notes;
}
