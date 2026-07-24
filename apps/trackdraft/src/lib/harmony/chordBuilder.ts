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

/** Quality suffix → { minor, suffix } mapping for HoneycombStep.
 *  Covers the ChordQuality union from @music-theory/core as well
 *  as a few compound qualities the honeycomb parser understands. */
function qualityToMinorAndSuffix(quality: ChordQuality): {
  minor: boolean;
  suffix: string;
} {
  switch (quality) {
    case "maj":
      return { minor: false, suffix: "" };
    case "min":
      return { minor: true, suffix: "" };
    case "dim":
      return { minor: true, suffix: "°" };
    case "aug":
      return { minor: false, suffix: "+" };
    case "7":
      return { minor: false, suffix: "7" };
    case "maj7":
      return { minor: false, suffix: "maj7" };
    case "min7":
      return { minor: true, suffix: "7" };
    case "m7b5":
      return { minor: true, suffix: "7b5" };
    case "sus2":
      return { minor: false, suffix: "sus2" };
    case "sus4":
      return { minor: false, suffix: "sus4" };
    default:
      return { minor: false, suffix: "" };
  }
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

  const suffixToQuality = (
    minor: boolean,
    suffix: string,
  ): ChordQuality => {
    const s = (suffix || "").toLowerCase();
    if (s === "" || s === "maj") return minor ? "min" : "maj";
    if (s === "maj7") return "maj7";
    if (s === "7" || s === "dom7") return minor ? "min7" : "7";
    if (s === "7b5" || s === "ø7" || s === "m7b5") return "m7b5";
    if (s === "°" || s === "dim" || s === "°7" || s === "dim7")
      return "dim";
    if (s === "+" || s === "aug") return "aug";
    if (s === "sus2") return "sus2";
    if (s === "sus4") return "sus4";
    // Extended chords (9, 11, 13, etc.) — fall back to closest triad quality.
    if (minor) return "min7";
    if (s.includes("7")) return "7";
    return "maj";
  };

  for (const t of tokens) {
    const step = parseToken(t);
    if (!step) continue;
    const quality = suffixToQuality(step.minor, step.suffix);
    const rm = emitToken(step);

    // Resolve root: pitchClass = keyPc + intervals[degree] + accidental.
    const rootPc = intervals[step.deg] + step.acc;
    const root = noteName(((keyPc + rootPc) % 12 + 12) % 12, keyName);

    // Preserve honeycomb suffix as extendedSuffix when it carries more
    // info than ChordQuality alone (e.g. "maj9", "7b13", "m11").
    const simpleQuality = suffixToQuality(step.minor, "");
    const isExtended =
      step.suffix !== "" && quality !== simpleQuality;

    chords.push({
      id: crypto.randomUUID(),
      romanNumeral: rm.replace(/b/g, "♭").replace(/#/g, "♯"),
      root,
      quality,
      beats: beatsPerChord,
      extendedSuffix: isExtended ? step.suffix : undefined,
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
