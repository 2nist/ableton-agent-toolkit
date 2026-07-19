import {
  MODE_DATA,
  FUNCTION_COLORS,
  CHORD_QUALITY_SUFFIX,
  PRESET_PROGRESSIONS,
  chordName,
  noteName,
  pitchClass,
} from "@music-theory/core";
import type { ScaleType, NoteName, ChordQuality } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

export interface DiatonicOption {
  degree: string;
  root: number;
  quality: ChordQuality;
  isBorrowed: boolean;
  func: string;
}

/** All diatonic (and, for Ionian, the classic hardcoded borrowed) chord
 *  options for a key/scale, using triads. Source of the Harmony view's
 *  "quick add" palette and the hex wheel's cell contents. */
export function getDiatonicOptions(scale: ScaleType): DiatonicOption[] {
  return Object.entries(MODE_DATA[scale].map).map(([degree, entry]) => ({
    degree,
    root: entry.pc,
    quality: entry.triad,
    isBorrowed: entry.isBorrowed ?? false,
    func: entry.func,
  }));
}

export function chordDisplayName(root: number, quality: ChordQuality, key: NoteName): string {
  return chordName(root, quality, key);
}

export function chordFromDegree(
  keyPc: number,
  keyName: NoteName,
  degree: string,
  quality: ChordQuality,
  rootPc: number,
  beats: number,
): Chord {
  return {
    id: crypto.randomUUID(),
    romanNumeral: degree,
    root: noteName((keyPc + rootPc) % 12, keyName),
    quality,
    beats,
  };
}

/** Every quality the app's chord editor can assign — driven off the
 *  music-theory suffix table so the two can't drift apart. */
export const CHORD_QUALITIES = Object.keys(CHORD_QUALITY_SUFFIX) as ChordQuality[];

/** `FUNCTION_COLORS` stores numbers (0x34d399), which Tailwind can't JIT
 *  into class names — convert to a CSS hex string for inline styles. */
export function functionColorHex(func: string | undefined | null): string | null {
  if (!func) return null;
  const value = FUNCTION_COLORS[func];
  if (value === undefined) return null;
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** A chord's harmonic function (T/PD/D/B) under the given scale, computed
 *  at render time from its roman numeral rather than stored on the chord —
 *  storing it would go stale the moment the song's scale changes. Returns
 *  null for numerals the scale doesn't know (e.g. after a chromatic
 *  substitution), which callers render with the accent treatment instead. */
export function chordFunction(chord: Chord, scale: ScaleType): string | null {
  return MODE_DATA[scale].map[chord.romanNumeral]?.func ?? null;
}

/** Resolve a preset progression into app chords in the given key, minting
 *  fresh ids. Uses the *preset's own mode* — an Andalusian cadence is an
 *  aeolian shape and should sound like one regardless of the song's scale. */
export function presetToChords(presetKey: string, keyName: NoteName, beatsPerChord: number): Chord[] {
  const preset = PRESET_PROGRESSIONS[presetKey];
  if (!preset) return [];
  const keyPc = pitchClass(keyName);
  const chords: Chord[] = [];
  for (const degree of preset.degrees) {
    const entry = MODE_DATA[preset.mode].map[degree];
    if (!entry) continue;
    chords.push(chordFromDegree(keyPc, keyName, degree, entry.triad, entry.pc, beatsPerChord));
  }
  return chords;
}
