import type { PresetProgression, ScaleType, NoteName, Chord } from "./types";
import { buildChord } from "./chords";

/**
 * Preset chord progressions
 * Source: hexagon_chord_logic.js + APC64 chord editor
 */
export const PRESET_PROGRESSIONS: Record<string, PresetProgression> = {
  /** Classic doo-wop / 50s progression */
  "50s_progression": {
    name: "50s Progression",
    degrees: ["I", "vi", "IV", "V"],
    mode: "ionian",
  },
  /** Modern pop progression */
  pop_progression: {
    name: "Pop Progression",
    degrees: ["I", "V", "vi", "IV"],
    mode: "ionian",
  },
  /** Standard jazz turnaround */
  jazz_turnaround: {
    name: "Jazz Turnaround",
    degrees: ["ii", "V", "I"],
    mode: "ionian",
  },
  /** Classic blues progression */
  blues: {
    name: "12-Bar Blues",
    degrees: [
      "I", "I", "I", "I",
      "IV", "IV", "I", "I",
      "V", "IV", "I", "V",
    ],
    mode: "ionian",
  },
  /** Pachelbel's Canon progression */
  canon: {
    name: "Canon (Pachelbel)",
    degrees: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
    mode: "ionian",
  },
  /** Andalusian cadence (descending minor tetrachord) */
  andalusian: {
    name: "Andalusian Cadence",
    degrees: ["i", "♭VII", "♭VI", "V"],
    mode: "aeolian",
  },
  /** dorian funk progression */
  dorian_funk: {
    name: "Dorian Funk",
    degrees: ["i", "IV", "i", "IV"],
    mode: "dorian",
  },
  /** Mixolydian rock progression */
  mixolydian_rock: {
    name: "Mixolydian Rock (♭VII-I)",
    degrees: ["I", "♭VII", "IV", "I"],
    mode: "mixolydian",
  },
  /** Lydian float */
  lydian_float: {
    name: "Lydian Float",
    degrees: ["I", "II", "I", "II"],
    mode: "lydian",
  },
  /** Phrygian dark */
  phrygian_dark: {
    name: "Phrygian Dark",
    degrees: ["i", "♭II", "i", "♭II"],
    mode: "phrygian",
  },

  // ─── Mined from lead-sheet-dataset (Theorytab / hooktheory) ───────────────
  // Most common pop progressions across 17,527 lead-sheet sections.
  // Degrees are ionian keys; counts = n-chord windows (see
  // /Users/Matthew/ableton-midi/progressions/lead-sheet-progressions.md).
  /** Axis rotation starting on vi (vi–IV–I–V) */
  axis_on_vi: {
    name: "Axis on vi (vi-IV-I-V)",
    degrees: ["vi", "IV", "I", "V"],
    mode: "ionian",
  },
  /** Axis rotation starting on IV (IV–I–V–vi) */
  axis_from_IV: {
    name: "Axis from IV (IV-I-V-vi)",
    degrees: ["IV", "I", "V", "vi"],
    mode: "ionian",
  },
  /** Axis rotation starting on V (V–vi–IV–I) */
  axis_from_V: {
    name: "Axis from V (V-vi-IV-I)",
    degrees: ["V", "vi", "IV", "I"],
    mode: "ionian",
  },
  /** Classic I–IV–V–I turnaround */
  classic_turnaround: {
    name: "Classic Turnaround (I-IV-V-I)",
    degrees: ["I", "IV", "V", "I"],
    mode: "ionian",
  },
  /** Pop four-chord I–V–IV–I */
  pop_four: {
    name: "Pop Four (I-V-IV-I)",
    degrees: ["I", "V", "IV", "I"],
    mode: "ionian",
  },
  /** Pop V–I–IV–V */
  pop_five: {
    name: "Pop Five (V-I-IV-V)",
    degrees: ["V", "I", "IV", "V"],
    mode: "ionian",
  },
  /** Modal rock ♭VI–♭III–♭VII–♭VI */
  modal_rock: {
    name: "Modal Rock (bVI-bIII-bVII-bVI)",
    degrees: ["♭VI", "♭III", "♭VII", "♭VI"],
    mode: "ionian",
  },
  /** Modal rock variant ♭VII–♭VI–♭III–♭VII */
  modal_rock_b: {
    name: "Modal Rock B (bVII-bVI-bIII-bVII)",
    degrees: ["♭VII", "♭VI", "♭III", "♭VII"],
    mode: "ionian",
  },
  /** Jazz-flavored pop I–vi–ii–V */
  jazzy_pop: {
    name: "Jazzy Pop (I-vi-ii-V)",
    degrees: ["I", "vi", "ii", "V"],
    mode: "ionian",
  },
  /** Rock ♭VI–♭VII–I anthem ending */
  rock_bvi_bvii: {
    name: "Rock bVI-bVII-I",
    degrees: ["♭VI", "♭VII", "I"],
    mode: "ionian",
  },
  /** One–four–five I–IV–V */
  one_four_five: {
    name: "One-Four-Five (I-IV-V)",
    degrees: ["I", "IV", "V"],
    mode: "ionian",
  },
  /** Axis with return: I–V–vi–IV–I */
  axis_five: {
    name: "Axis Five (I-V-vi-IV-I)",
    degrees: ["I", "V", "vi", "IV", "I"],
    mode: "ionian",
  },
  /** Axis loop: I–V–vi–IV–I–V */
  axis_six: {
    name: "Axis Six (I-V-vi-IV-I-V)",
    degrees: ["I", "V", "vi", "IV", "I", "V"],
    mode: "ionian",
  },
};

/**
 * Resolve a preset progression into an array of Chord objects
 */
export function resolveProgression(
  presetKey: string,
  key: NoteName = "C",
  beatsPerChord: number = 4
): Chord[] {
  const preset = PRESET_PROGRESSIONS[presetKey];
  if (!preset) {
    throw new Error(`Unknown preset progression: ${presetKey}`);
  }

  return preset.degrees.map((degree) =>
    buildChord(key, degree, preset.mode, beatsPerChord)
  );
}

/**
 * Create a custom progression from an array of degrees
 */
export function customProgression(
  key: NoteName,
  mode: ScaleType,
  degrees: string[],
  beatsPerChord: number = 4
): Chord[] {
  return degrees.map((degree) =>
    buildChord(key, degree, mode, beatsPerChord)
  );
}

/**
 * Get all preset progression keys
 */
export function getPresetKeys(): string[] {
  return Object.keys(PRESET_PROGRESSIONS);
}

/**
 * Get preset by key
 */
export function getPreset(key: string): PresetProgression | undefined {
  return PRESET_PROGRESSIONS[key];
}