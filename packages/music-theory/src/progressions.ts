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