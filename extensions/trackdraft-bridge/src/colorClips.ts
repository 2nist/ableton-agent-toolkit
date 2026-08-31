import { pitchClass } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  generateBiTonal,
  BI_TONAL_MATRIX,
  DEFAULT_COLOR_FLAVOR,
  type BiTonalChord,
  type BiTonalOptions,
} from "@platform/progression-engine";
import { resolveChordOccurrences } from "@drum/library";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import type { ChordClipPlan } from "./chordClips.js";

/** Octave of the bi-tonal anchor (Instrument A). The color layer rides
 *  two octaves above it by default. Same defaults as the app's
 *  `colorStem` and Progression Studio's `anchorOctave`, so the Live
 *  Color track, the app's MIDI export, and the real-time MIDI out all
 *  agree on where the Color voice sits. */
const COLOR_ANCHOR_OCTAVE = 4;
const COLOR_OCTAVE = 6;

function chordToBiTonal(chord: { root: string; quality: string; beats: number }): BiTonalChord {
  return { rootPc: pitchClass(chord.root), quality: chord.quality, durationBeats: chord.beats };
}

/** The section's chords resolved to fill its full duration — the SAME
 *  occurrence math as the Chords/Bass clips (`resolveChordOccurrences`, so
 *  Euclidean harmony and the syncopation push apply here too) instead of a
 *  plain fill loop, so the Color layer spans the whole section and matches
 *  the app's `colorStem` note for note. */
function sectionChordsFilled(section: BlueprintSong["sections"][number], durationBeats: number): BiTonalChord[] {
  return resolveChordOccurrences(section, durationBeats).map((occ) => ({
    ...chordToBiTonal(occ.chord),
    durationBeats: occ.duration,
  }));
}

/** One clip per section holding the bi-tonal "Color Chord" layer — the
 *  Color-track counterpart to `planChordClips`, generated from the same
 *  `@platform/progression-engine` generator Progression Studio's Color
 *  track uses. Reads `section.colorFlavor` (default
 *  `DEFAULT_COLOR_FLAVOR`), so the per-section flavor picker in the app
 *  controls exactly what lands on the Live Color track. */
export function planColorClips(song: BlueprintSong): ChordClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const chords = sectionChordsFilled(section, durationBeats);
    const notes: NoteDescription[] = [];
    if (chords.length > 0) {
      const opts: BiTonalOptions = { anchorOctave: COLOR_ANCHOR_OCTAVE, colorOctave: COLOR_OCTAVE };
      const generated = generateBiTonal(BI_TONAL_MATRIX, section.colorFlavor ?? DEFAULT_COLOR_FLAVOR, chords, opts);
      notes.push(...generated.color);
    }
    return { name: `${section.name} · Color`, startBeat, durationBeats, notes };
  });
}
