import { pitchClass } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  generateBiTonal,
  BI_TONAL_MATRIX,
  DEFAULT_COLOR_FLAVOR,
  type BiTonalChord,
  type BiTonalOptions,
} from "@platform/progression-engine";
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

/** The section's chords looped to fill its full duration — the same fill
 *  math `chordClips.ts` uses, so the Color layer spans the whole section
 *  rather than just one pass through its chord cycle. */
function sectionChordsFilled(section: BlueprintSong["sections"][number], durationBeats: number): BiTonalChord[] {
  const cycleBeats = (section.chords ?? []).reduce((sum, c) => sum + c.beats, 0);
  if (cycleBeats <= 0) return [];
  const out: BiTonalChord[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const c of section.chords ?? []) {
      if (cursor >= durationBeats) break;
      const duration = Math.min(c.beats, durationBeats - cursor);
      out.push({ ...chordToBiTonal(c), durationBeats: duration });
      cursor += c.beats;
    }
  }
  return out;
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
