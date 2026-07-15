import type { ScaleType, NoteName } from "./music-theory-types";

/** Drum pattern presets — from lalo-chezia S() format */
export type DrumPattern =
  | "none"
  | "kick_only"
  | "standard"
  | "half_time"
  | "driving"
  | "bridge_sparse"
  | "intense"
  | "dnb"
  | "78"
  | "68"
  | "54";

/** Section type labels — common song section roles */
export type SectionRole =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "solo"
  | "breakdown"
  | "outro"
  | "custom";

/** Velocity preset */
export type VelocityPreset =
  | "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff";

/** Velocity map (MIDI 0-127) */
export const VELOCITY_MAP: Record<VelocityPreset, number> = {
  ppp: 32, pp: 48, p: 64, mp: 80, mf: 96, f: 112, ff: 120, fff: 127,
};

/**
 * A single chord in a section's progression.
 * Extends @music-theory/core Chord with duration in beats.
 */
export interface SectionChord {
  /** Root note name */
  root: NoteName;
  /** Scale degree (roman numeral) */
  degree: string;
  /** Chord quality */
  quality: string;
  /** Duration in beats */
  duration: number;
  /** Whether this chord is a substitution */
  isSubstitution: boolean;
  /** Substitution source degree */
  substitutedFrom?: string;
}

/**
 * A song section — a named structural unit (Verse, Chorus, etc.).
 *
 * This is the S() format from lalo-chezia:
 *   S(name, bars, chord_progression, beats_per_chord, drum_pattern, velocity, ts_numerator, ts_den_power)
 */
export interface SongSection {
  /** Section name (e.g., "Verse 1", "Chorus") */
  name: string;
  /** Section role */
  role: SectionRole;
  /** Duration in bars */
  bars: number;
  /** Chord progression for this section */
  chordProgression: SectionChord[];
  /** Default beats per chord (override per-chord) */
  beatsPerChord: number;
  /** Drum pattern */
  drumPattern: DrumPattern;
  /** Velocity preset */
  velocity: VelocityPreset;
  /** Time signature numerator (default 4) */
  timeSignatureNumerator: number;
  /** Time signature denominator as power of 2 (2=4/4, 3=8/8) */
  timeSignatureDenPower: number;
  /** Sub-bars for short variations */
  subBars?: number;
}

/**
 * An arrangement entry — a section placed in the song timeline with repeat count.
 */
export interface ArrangementEntry {
  /** Reference to the section */
  sectionName: string;
  /** Number of times to repeat this section */
  repeats: number;
  /** Optional variation name (e.g., "Verse 1a") */
  variation?: string;
  /** Override section properties for this entry */
  overrides?: Partial<SongSection>;
}

/**
 * Complete song definition.
 *
 * Combines metadata, sections, and arrangement into a single source of truth
 * that can generate .rpp files, MIDI exports, or DAW project templates.
 */
export interface Song {
  /** Song title */
  title: string;
  /** Artist/author */
  artist?: string;
  /** Key root (e.g., "C", "F#") */
  key: NoteName;
  /** Scale/mode */
  scale: ScaleType;
  /** Tempo in BPM */
  bpm: number;
  /** Time signature numerator */
  timeSignatureNumerator: number;
  /** Time signature denominator (default 4) */
  timeSignatureDenominator: number;
  /** All defined sections */
  sections: Record<string, SongSection>;
  /** Timeline arrangement */
  arrangement: ArrangementEntry[];
  /** Total duration in bars (computed) */
  totalBars: number;
  /** Total duration in seconds (computed) */
  totalDurationSeconds: number;
}

/**
 * Sketch Mode track template.
 *
 * Based on Activate_Sketch_Mode.lua — 8-track layout with pre-configured
 * routing, VST loading, and record/monitor modes.
 */
export interface SketchTrackTemplate {
  /** Track name */
  name: string;
  /** Track type */
  type:
    | "chord_detector"
    | "drums"
    | "bass"
    | "chords"
    | "melody"
    | "vocal"
    | "scratchpad"
    | "fx_bus";
  /** Whether track should be record-armed */
  recordArm: boolean;
  /** Whether track should be input-monitored */
  recordMonitor: boolean;
  /** Record mode (0=off, 1=input, 2=auto-punch, 3=auto-punch selected) */
  recordMode: number;
  /** Whether track starts muted */
  muted: boolean;
  /** VST3 plugin to load (optional) */
  vstPlugin?: string;
  /** MIDI routing: source track name (optional) */
  midiSource?: string;
  /** MIDI routing: destination channel (1-16) */
  midiDestinationChannel?: number;
}

/**
 * Sketch Mode environment config.
 *
 * Based on Activate_Sketch_Mode.lua — one-click project template.
 */
export interface SketchEnvironment {
  /** Default BPM */
  bpm: number;
  /** Default time signature */
  timeSignature: { numerator: number; denominator: number };
  /** Default loop length in bars */
  loopBars: number;
  /** Sketch folder name */
  sketchFolder: string;
  /** Track templates */
  tracks: SketchTrackTemplate[];
}

/**
 * Default 8-track Sketch Mode template (matching Activate_Sketch_Mode.lua).
 */
export const DEFAULT_SKETCH_ENVIRONMENT: SketchEnvironment = {
  bpm: 90,
  timeSignature: { numerator: 4, denominator: 4 },
  loopBars: 32,
  sketchFolder: "Sketches",
  tracks: [
    {
      name: "Chord Detector (Scaler)",
      type: "chord_detector",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
      vstPlugin: "Scaler 3 (Plugin Boutique) (VST3)",
    },
    {
      name: "Drum Sketch",
      type: "drums",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
    },
    {
      name: "Bass Sketch",
      type: "bass",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
    },
    {
      name: "Chord Sketch",
      type: "chords",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
      midiSource: "Chord Detector (Scaler)",
      midiDestinationChannel: 1,
    },
    {
      name: "Melody Sketch",
      type: "melody",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
      midiSource: "Chord Detector (Scaler)",
      midiDestinationChannel: 1,
    },
    {
      name: "Vocal Sketch",
      type: "vocal",
      recordArm: true,
      recordMonitor: true,
      recordMode: 1,
      muted: false,
    },
    {
      name: "Scratchpad",
      type: "scratchpad",
      recordArm: false,
      recordMonitor: false,
      recordMode: 0,
      muted: false,
    },
    {
      name: "FX Bus (Muted)",
      type: "fx_bus",
      recordArm: false,
      recordMonitor: false,
      recordMode: 0,
      muted: true,
    },
  ],
};

/**
 * Drum pattern → track names for automatic track creation.
 * Maps a drum pattern preset to which sketch tracks should be active.
 */
export interface DrumTrackConfig {
  /** Which tracks to enable for this pattern */
  activeTracks: string[];
  /** Default complexity (0-1) */
  complexity: number;
  /** Default density (0-1) — notes per beat */
  density: number;
}

/**
 * Drum pattern configurations.
 */
export const DRUM_TRACK_CONFIGS: Record<DrumPattern, DrumTrackConfig> = {
  none: {
    activeTracks: [],
    complexity: 0,
    density: 0,
  },
  kick_only: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.1,
    density: 0.25,
  },
  standard: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.5,
    density: 0.5,
  },
  half_time: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.3,
    density: 0.25,
  },
  driving: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.7,
    density: 0.75,
  },
  bridge_sparse: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.2,
    density: 0.15,
  },
  intense: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.9,
    density: 1.0,
  },
  dnb: {
    activeTracks: ["Drum Sketch"],
    complexity: 0.8,
    density: 1.0,
  },
  "78": {
    activeTracks: ["Drum Sketch"],
    complexity: 0.6,
    density: 0.6,
  },
  "68": {
    activeTracks: ["Drum Sketch"],
    complexity: 0.5,
    density: 0.5,
  },
  "54": {
    activeTracks: ["Drum Sketch"],
    complexity: 0.4,
    density: 0.45,
  },
};