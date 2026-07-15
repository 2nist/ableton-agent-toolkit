import type {
  Song,
  SongSection,
  ArrangementEntry,
  SectionChord,
  SectionRole,
  DrumPattern,
  VelocityPreset,
} from "./types";
import { VELOCITY_MAP } from "./types";
import type { ScaleType, NoteName } from "./music-theory-types";

/**
 * S() — Section builder factory function.
 *
 * This is the canonical format from lalo-chezia/make_rpp.py:
 *   S(name, bars, chord_progression, beats_per_chord, drum_pattern, velocity, ts_numerator, ts_den_power)
 *
 * Each section defines a named structural unit with its own chord progression,
 * drum pattern, velocity preset, and time signature.
 */
export function S(
  name: string,
  bars: number,
  chordProgression: SectionChord[] = [],
  beatsPerChord: number = 4,
  drumPattern: DrumPattern = "standard",
  velocity: VelocityPreset = "mf",
  timeSignatureNumerator: number = 4,
  timeSignatureDenPower: number = 2,
  role: SectionRole = "custom"
): SongSection {
  return {
    name,
    role,
    bars,
    chordProgression,
    beatsPerChord,
    drumPattern,
    velocity,
    timeSignatureNumerator,
    timeSignatureDenPower,
  };
}

/**
 * Build a complete Song from sections and arrangement.
 *
 * Computes totalBars and totalDurationSeconds automatically.
 */
export function buildSong(params: {
  title: string;
  artist?: string;
  key?: NoteName;
  scale?: ScaleType;
  bpm?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenominator?: number;
  sections: SongSection[];
  arrangement: ArrangementEntry[];
}): Song {
  const key = params.key ?? "C";
  const scale = params.scale ?? "ionian";
  const bpm = params.bpm ?? 120;
  const tsNum = params.timeSignatureNumerator ?? 4;
  const tsDen = params.timeSignatureDenominator ?? 4;

  // Build section map
  const sectionMap: Record<string, SongSection> = {};
  for (const section of params.sections) {
    sectionMap[section.name] = section;
  }

  // Compute total bars from arrangement
  let totalBars = 0;
  for (const entry of params.arrangement) {
    const section = sectionMap[entry.sectionName];
    if (section) {
      totalBars += section.bars * entry.repeats;
    }
  }

  // Compute total duration in seconds
  const secondsPerBeat = 60 / bpm;
  const beatsPerBar = tsNum;
  const totalBeats = totalBars * beatsPerBar;
  const totalDurationSeconds = totalBeats * secondsPerBeat;

  return {
    title: params.title,
    artist: params.artist,
    key,
    scale,
    bpm,
    timeSignatureNumerator: tsNum,
    timeSignatureDenominator: tsDen,
    sections: sectionMap,
    arrangement: params.arrangement,
    totalBars,
    totalDurationSeconds,
  };
}

/**
 * Create a SectionChord with defaults.
 */
export function chord(
  degree: string,
  quality: string = "maj",
  duration: number = 4,
  root?: NoteName,
  isSubstitution: boolean = false
): SectionChord {
  return {
    root: root ?? degree,
    degree,
    quality,
    duration,
    isSubstitution,
  };
}

/**
 * Get the MIDI velocity for a velocity preset.
 */
export function getVelocity(preset: VelocityPreset): number {
  return VELOCITY_MAP[preset];
}

/**
 * Get the total beats for a section.
 */
export function getSectionBeats(section: SongSection): number {
  return section.bars * section.timeSignatureNumerator;
}

/**
 * Get the total chord count for a section (considering beatsPerChord).
 */
export function getSectionChordCount(section: SongSection): number {
  if (section.chordProgression.length === 0) return 1;
  return section.chordProgression.length;
}

/**
 * Check if two sections are identical (same chord progression, drum pattern, etc.).
 */
export function sectionsEqual(a: SongSection, b: SongSection): boolean {
  if (a.bars !== b.bars) return false;
  if (a.drumPattern !== b.drumPattern) return false;
  if (a.velocity !== b.velocity) return false;
  if (a.chordProgression.length !== b.chordProgression.length) return false;
  for (let i = 0; i < a.chordProgression.length; i++) {
    const ca = a.chordProgression[i]!;
    const cb = b.chordProgression[i]!;
    if (ca.degree !== cb.degree || ca.quality !== cb.quality || ca.duration !== cb.duration) {
      return false;
    }
  }
  return true;
}