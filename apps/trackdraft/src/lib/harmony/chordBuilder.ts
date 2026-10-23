import {
  MODE_DATA,
  FUNCTION_COLORS,
  CHORD_QUALITY_SUFFIX,
  CHORD_QUALITY_GROUPS,
  PRESET_PROGRESSIONS,
  parseChordQuality,
  chordName,
  noteName,
  pitchClass,
} from "@music-theory/core";
import type { ScaleType, NoteName, ChordQuality } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import {
  emitToken,
  parseToken,
  SCALE_INTERVALS,
  MODE_TO_SCALE_KEY,
  type HoneycombStep,
} from "./honeycombWalk";

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
  const mode = MODE_DATA[scale];
  if (!mode) return [];
  return Object.entries(mode.map).map(([degree, entry]) => ({
    degree,
    root: entry.pc,
    quality: entry.triad,
    isBorrowed: entry.isBorrowed ?? false,
    func: entry.func,
  }));
}

const ROMAN_DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * How a chord reads as a secondary function — `V6/V`, `vii°/ii` — or `null`
 * when it is simply a degree of the section's key.
 *
 * A `romanNumeral` alone cannot say "this is V of V": the app stores the
 * absolute root so every planner works, and this puts the functional reading
 * back for display. The Roman is shown as the source wrote it (lowercase for
 * minor, accidental kept), with the local tonic after the slash.
 */
export function chordFunctionLabel(chord: {
  secondaryFunction?: { numeral: string; targetDegree: number; targetAccidental: number };
}): string | null {
  const fn = chord.secondaryFunction;
  if (!fn) return null;
  const base = ROMAN_DEGREES[fn.targetDegree];
  if (!base) return null;
  const target = `${fn.targetAccidental === -1 ? "♭" : fn.targetAccidental === 1 ? "♯" : ""}${base}`;
  return `${fn.numeral}/${target}`;
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

/** Chip/option label for a quality: the symbol a player writes (`m7`,
 *  `maj9`), not the internal key (`min7`). `maj` keeps its name because its
 *  own suffix is the empty string. */
export function qualityLabel(quality: ChordQuality): string {
  return quality === "maj" ? "maj" : CHORD_QUALITY_SUFFIX[quality] || quality;
}

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
  return MODE_DATA[scale]?.map?.[chord.romanNumeral]?.func ?? null;
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

/* ============================================================
   HONEYCOMB BRIDGE — Chord[] ↔ honeycomb text
   ============================================================ */

/** Quality → the honeycomb token's { minor, suffix } pair.
 *
 *  Two things need saying here. First, the map is total — a `Record` over
 *  `ChordQuality`, so adding a quality to the vocabulary is a compile error
 *  until it can be written as a token. Second, the suffix is often shorter
 *  than the quality's name: `min9` is "minor third + 9", so it emits
 *  `minor: true, suffix: "9"` and round-trips back through
 *  `parseChordQuality`. */
const QUALITY_STEP: Record<ChordQuality, { minor: boolean; suffix: string }> = {
  maj: { minor: false, suffix: "" },
  min: { minor: true, suffix: "" },
  dim: { minor: true, suffix: "°" },
  aug: { minor: false, suffix: "+" },
  "7": { minor: false, suffix: "7" },
  maj7: { minor: false, suffix: "maj7" },
  min7: { minor: true, suffix: "7" },
  m7b5: { minor: true, suffix: "7b5" },
  sus2: { minor: false, suffix: "sus2" },
  sus4: { minor: false, suffix: "sus4" },
  "5": { minor: false, suffix: "5" },
  "6": { minor: false, suffix: "6" },
  min6: { minor: true, suffix: "6" },
  "69": { minor: false, suffix: "69" },
  add9: { minor: false, suffix: "add9" },
  dim7: { minor: true, suffix: "°7" },
  mMaj7: { minor: true, suffix: "maj7" },
  "maj7#5": { minor: false, suffix: "maj7#5" },
  "7sus4": { minor: false, suffix: "7sus4" },
  "7b5": { minor: false, suffix: "7b5" },
  "7#5": { minor: false, suffix: "7#5" },
  "9": { minor: false, suffix: "9" },
  maj9: { minor: false, suffix: "maj9" },
  min9: { minor: true, suffix: "9" },
  "9sus4": { minor: false, suffix: "9sus4" },
  "7b9": { minor: false, suffix: "7b9" },
  "7#9": { minor: false, suffix: "7#9" },
  "7#11": { minor: false, suffix: "7#11" },
  "7b13": { minor: false, suffix: "7b13" },
  "11": { minor: false, suffix: "11" },
  min11: { minor: true, suffix: "11" },
  "13": { minor: false, suffix: "13" },
  maj13: { minor: false, suffix: "maj13" },
  min13: { minor: true, suffix: "13" },
};

function qualityToMinorAndSuffix(quality: ChordQuality): {
  minor: boolean;
  suffix: string;
} {
  return QUALITY_STEP[quality] ?? { minor: false, suffix: "" };
}

/** Convert the current system's Chord[] into the honeycomb text
 *  notation (e.g. "Imaj7 ii7 V7 I").  Round-trips through
 *  honeycombTextToChords(). */
export function chordsToHoneycombText(chords: Chord[]): string {
  return chords
    .map((c) => {
      const { minor, suffix } = qualityToMinorAndSuffix(c.quality);

      const numeral = c.romanNumeral;
      let acc = 0;
      let trimmed = numeral;
      if (trimmed.startsWith("♭") || trimmed.startsWith("b")) {
        acc = -1;
        trimmed = trimmed.slice(1);
      } else if (trimmed.startsWith("♯") || trimmed.startsWith("#")) {
        acc = 1;
        trimmed = trimmed.slice(1);
      }

      const deg = [
        "i",
        "ii",
        "iii",
        "iv",
        "v",
        "vi",
        "vii",
      ].indexOf(trimmed.toLowerCase());

      if (deg === -1) {
        return numeral.replace(/♭/g, "b").replace(/♯/g, "#");
      }

      // Use extendedSuffix when present, otherwise quality-based suffix.
      const stepSuffix = c.extendedSuffix ?? suffix;

      const step: HoneycombStep = {
        deg,
        acc,
        minor,
        suffix: stepSuffix,
        bass: null,
      };
      return emitToken(step);
    })
    .join(" ");
}

/** Parse honeycomb text notation into the system's Chord[] array.
 *  Roots are resolved via the default Ionian (major) scale intervals:
 *  root = keyPc + intervals[degree] + accidental.
 *  The previous `(keyPc + 12) % 12` was a placeholder that always
 *  returned the same root regardless of the parsed degree — fixed. */
export function honeycombTextToChords(
  text: string,
  keyName: NoteName,
  beatsPerChord: number,
  mode?: ScaleType,
): Chord[] {
  const tokens = text.split(/[\s,|➔→>–—]+/).filter(Boolean);
  const keyPc = pitchClass(keyName);
  const scaleKey = mode
    ? (MODE_TO_SCALE_KEY[mode as keyof typeof MODE_TO_SCALE_KEY] ?? "major")
    : "major";
  const intervals = SCALE_INTERVALS[scaleKey];
  const chords: Chord[] = [];

  /** Suffix → quality, then a closest-fit fallback for tokens the closed
   *  vocabulary cannot hold (they also stay on the chord as
   *  `extendedSuffix`, so the fallback only shapes playback). */
  const suffixToQuality = (minor: boolean, suffix: string): ChordQuality => {
    const mapped = parseChordQuality(suffix, minor);
    if (mapped) return mapped;
    const s = (suffix || "").toLowerCase();
    if (minor) return "min7";
    if (s.includes("7")) return "7";
    return "maj";
  };

  for (const t of tokens) {
    const step = parseToken(t);
    if (!step) continue;
    const mapped = parseChordQuality(step.suffix, step.minor);
    const quality = mapped ?? suffixToQuality(step.minor, step.suffix);
    const rm = emitToken(step);

    // Resolve root: pitchClass = keyPc + intervals[degree] + accidental.
    const rootPc = intervals[step.deg] + step.acc;
    const root = noteName(((keyPc + rootPc) % 12 + 12) % 12, keyName);

    chords.push({
      id: crypto.randomUUID(),
      romanNumeral: rm.replace(/b/g, "♭").replace(/#/g, "♯"),
      root,
      quality,
      // Only unmapped suffixes survive here: everything the vocabulary can
      // express is already carried by `quality` (and now sounds correctly),
      // so duplicating it would just give two sources of truth.
      extendedSuffix: mapped === null && step.suffix !== "" ? step.suffix : undefined,
      beats: beatsPerChord,
    });
  }
  return chords;
}
/** Extract roman-numeral degree labels from a chord progression for
 *  persistence as a reusable preset. Strips accidental prefixes from
 *  non-diatonic degrees (e.g. "♭III" → "bIII" for storage). */
export function chordsToPreset(chords: Chord[]): string[] {
  return chords.map((c) => c.romanNumeral.replace(/♭/g, "b").replace(/♯/g, "#"));
}
