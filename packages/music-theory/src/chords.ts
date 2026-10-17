import type { ChordType, Chord, ChordQuality, ScaleType, NoteName } from "./types";
import { pitchClass, noteName } from "./notes";
import { MODE_DATA } from "./scales";

/**
 * Chord type definitions with interval patterns
 * Source: APC64 chord editor + hexagon_chord_logic.js
 *
 * Index mapping (matching APC64 Lua implementation):
 * 1=maj, 2=min, 3=7, 4=maj7, 5=m7, 6=sus2, 7=sus4, 8=dim, 9=aug
 */
export const CHORD_TYPES: ChordType[] = [
  { name: "maj", intervals: [0, 4, 7], display: "" },
  { name: "min", intervals: [0, 3, 7], display: "m" },
  { name: "7", intervals: [0, 4, 7, 10], display: "7" },
  { name: "maj7", intervals: [0, 4, 7, 11], display: "maj7" },
  { name: "m7", intervals: [0, 3, 7, 10], display: "m7" },
  { name: "sus2", intervals: [0, 2, 7], display: "sus2" },
  { name: "sus4", intervals: [0, 5, 7], display: "sus4" },
  { name: "dim", intervals: [0, 3, 6], display: "dim" },
  { name: "aug", intervals: [0, 4, 8], display: "aug" },
];

/** Chord quality display suffix mapping */
export const CHORD_QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  m7b5: "m7♭5",
  sus2: "sus2",
  sus4: "sus4",
  dim: "dim",
  aug: "aug",
};

/**
 * Get a chord type by 1-based index (matching APC64 convention)
 */
export function getChordTypeByIndex(index: number): ChordType | undefined {
  return CHORD_TYPES[index - 1];
}

/**
 * Get the display suffix for a chord quality
 */
export function getChordSuffix(quality: ChordQuality): string {
  return CHORD_QUALITY_SUFFIX[quality] ?? "";
}

/**
 * Build full chord name (e.g. "Cmaj7", "F#m", "B♭dim")
 */
export function chordName(
  rootPc: number,
  quality: ChordQuality,
  key?: NoteName
): string {
  const root = noteName(rootPc, key);
  const suffix = getChordSuffix(quality);
  return `${root}${suffix}`;
}

/**
 * Get intervals for a chord quality
 */
export function getChordIntervals(quality: ChordQuality): number[] {
  // Map from quality to CHORD_TYPES entry
  const qualityToIntervals: Record<string, number[]> = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    "7": [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    m7b5: [0, 3, 6, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
  };
  return qualityToIntervals[quality] ?? [0, 4, 7];
}

/**
 * Get MIDI note numbers for a chord at a given octave
 */
export function chordToMidiNotes(
  rootPc: number,
  quality: ChordQuality,
  octave: number = 4
): number[] {
  const intervals = getChordIntervals(quality);
  const base = octave * 12;
  return intervals.map((interval) => base + rootPc + interval);
}

/**
 * How a chord is voiced — which tone is in the bass and how tightly the
 * upper voices sit.
 *
 * `inversion` rotates the chord tones (0 = root position, 1 = first
 * inversion with the third in the bass, …), `spread` chooses close spacing
 * or an "open" voicing that drops the second-highest tone an octave. Both are
 * optional: absent means root position, close — exactly the historical
 * block chord, so an existing song sounds unchanged.
 */
export interface ChordVoicing {
  /** 0 = root position, 1 = 1st inversion, … clamped to the chord's size. */
  inversion?: number;
  /** "close" (default) stacks the tones; "open" drops the second-highest an
   *  octave so the voicing spans more than an octave. */
  spread?: "close" | "open";
}

/**
 * Rotate the chord tones: the lowest `n` move up an octave, so the nth tone
 * becomes the bass. Offsets stay relative to the ORIGINAL root (they can
 * exceed 12), which is what `voiceChord` re-bases afterwards.
 */
function invertIntervals(intervals: number[], inversion: number): number[] {
  const size = intervals.length;
  if (size === 0) return [];
  const shift = ((Math.round(inversion) % size) + size) % size;
  if (shift === 0) return [...intervals];
  return [
    ...intervals.slice(shift),
    ...intervals.slice(0, shift).map((interval) => interval + 12),
  ];
}

/** Drop the second-highest tone an octave — the classic "open" spread. */
function openIntervals(intervals: number[]): number[] {
  if (intervals.length < 3) return [...intervals];
  const pitches = [...intervals];
  pitches[pitches.length - 2] -= 12;
  return pitches.sort((a, b) => a - b);
}

/**
 * Re-express a chord as (root, intervals) with a voicing applied. The result
 * is the same shape every planner already takes (`rootMidi` + ascending
 * semitone offsets), so the export, the in-app audition and the Ableton
 * bridge can all share one voicing decision instead of each re-deriving it.
 */
export function voiceChord(
  rootMidi: number,
  intervals: number[],
  voicing?: ChordVoicing
): { rootMidi: number; intervals: number[] } {
  const inverted = invertIntervals(intervals, voicing?.inversion ?? 0);
  const shaped = voicing?.spread === "open" ? openIntervals(inverted) : inverted;
  const base = shaped.length > 0 ? Math.min(...shaped) : 0;
  return {
    rootMidi: rootMidi + base,
    intervals: shaped.map((interval) => interval - base),
  };
}

/** One note in a block chord — the shape every performance-effect input/
 *  output shares (pitch/velocity untouched by the effect, only timing
 *  redistributed). Structurally typed rather than importing
 *  song-blueprint's `ChordPerformanceEffect`, since that package depends
 *  on this one, not the other way around. */
export interface PerformanceEffectNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

export interface PerformanceEffectInput {
  style: "strum" | "pulse" | "arp";
  params?: Record<string, number>;
}

/**
 * Reshapes a block chord's simultaneous notes (same startTime/duration,
 * different pitches) into a performed pattern:
 *  - "strum": staggers onsets low-to-high across a short window
 *    (`params.spreadBeats`, default 0.05 beats), trimming each note's
 *    duration by its own offset so the chord still ends together.
 *  - "arp": breaks the chord into a straight ascending sequence spanning
 *    the original duration, each note getting an equal slice
 *    (`params.noteBeats` overrides the slice length).
 *  - "pulse": retriggers the full chord every `params.pulseBeats`
 *    (default 1 beat) for the original duration, each retrigger cut
 *    slightly short so consecutive hits don't legato together.
 * Any other style is returned unchanged.
 */
export function applyPerformanceEffect<T extends PerformanceEffectNote>(
  notes: T[],
  effect: PerformanceEffectInput
): T[] {
  if (notes.length === 0) return notes;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const startTime = sorted[0].startTime;
  const duration = sorted[0].duration;

  switch (effect.style) {
    case "strum": {
      const spreadBeats = effect.params?.spreadBeats ?? 0.05;
      return sorted.map((n, i) => {
        const offset = i * spreadBeats;
        return { ...n, startTime: n.startTime + offset, duration: Math.max(0.05, n.duration - offset) };
      });
    }
    case "arp": {
      const noteBeats = effect.params?.noteBeats ?? duration / sorted.length;
      return sorted.map((n, i) => ({
        ...n,
        startTime: startTime + i * noteBeats,
        duration: noteBeats,
      }));
    }
    case "pulse": {
      const pulseBeats = effect.params?.pulseBeats ?? 1;
      const pulseDuration = pulseBeats * 0.9;
      const pulses: T[] = [];
      for (let t = 0; t < duration - 1e-9; t += pulseBeats) {
        const thisDuration = Math.min(pulseDuration, duration - t);
        for (const n of sorted) pulses.push({ ...n, startTime: startTime + t, duration: thisDuration });
      }
      return pulses;
    }
    default:
      return notes;
  }
}

/**
 * Create a Chord object from a degree in a key/mode
 */
export function buildChord(
  key: NoteName,
  degree: string,
  mode: ScaleType,
  beats: number = 4
): Chord {
  const keyPc = pitchClass(key);
  const modeData = MODE_DATA[mode];
  const degreeEntry = modeData.map[degree];

  if (!degreeEntry) {
    throw new Error(
      `Degree "${degree}" not found in ${mode} mode`
    );
  }

  const rootPc = ((keyPc + degreeEntry.pc) % 12 + 12) % 12;
  const root = noteName(rootPc, key);

  return {
    root,
    degree,
    quality: degreeEntry.triad,
    beats,
    key,
    mode,
    isSubstitution: degreeEntry.isBorrowed ?? false,
  };
}

/**
 * Create a Chord from an absolute root note + quality
 */
export function chord(
  rootNote: NoteName,
  quality: ChordQuality,
  beats: number = 4,
  key?: NoteName,
  mode?: ScaleType
): Chord {
  return {
    root: rootNote,
    degree: rootNote, // Absolute chords don't have a scale degree
    quality,
    beats,
    key: key ?? "C",
    mode: mode ?? "ionian",
    isSubstitution: false,
  };
}