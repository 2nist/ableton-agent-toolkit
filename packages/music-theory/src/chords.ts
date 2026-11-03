import type { ChordType, Chord, ChordQuality, ScaleType, NoteName } from "./types";
import { pitchClass, noteName } from "./notes";
import { MODE_DATA, SCALE_INTERVALS } from "./scales";

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

/**
 * Interval sets for every quality. This is the single source of truth for
 * what a quality *sounds* like — `getChordIntervals` reads it, so adding a
 * row here is what makes a rich symbol (9/11/13/altered) playable rather
 * than merely displayable.
 *
 * Upper extensions sit above the octave (14 = 9, 17 = 11, 21 = 13) so the
 * stack stays root-anchored and `voiceChord` can invert it like any triad.
 */
export const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
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
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  "69": [0, 4, 7, 9, 14],
  add9: [0, 4, 7, 14],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
  "maj7#5": [0, 4, 8, 11],
  "7sus4": [0, 5, 7, 10],
  "7b5": [0, 4, 6, 10],
  "7#5": [0, 4, 8, 10],
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  "9sus4": [0, 5, 7, 10, 14],
  "7b9": [0, 4, 7, 10, 13],
  "7#9": [0, 4, 7, 10, 15],
  "7#11": [0, 4, 7, 10, 18],
  "7b13": [0, 4, 7, 10, 20],
  "11": [0, 7, 10, 14, 17],
  min11: [0, 3, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
  maj13: [0, 4, 7, 11, 14, 21],
  min13: [0, 3, 7, 10, 14, 21],
  // Appended after the 34 measured earlier: the tie-break order is the table's
  // order, so a new quality is only chosen when the ones before it cannot
  // explain the notes. These two are the canonical names a shipped competitor
  // has that this table lacked *and* that a pitch-class reader can reach.
  dim11: [0, 3, 6, 9, 14, 17],
  maj11: [0, 4, 7, 11, 14, 17],
};

/**
 * Chord tones a player may leave out without changing the name.
 *
 * Naming a played shape has to score "four of these five tones" differently
 * for a tone that carries the quality and one that is routinely dropped. The
 * fifth is the classic case: a pianist voicing maj7 plays root–3–7 constantly,
 * and treating the absent fifth as evidence against maj7 pushes the reading
 * toward a wrong, denser chord. These are indices into the quality's
 * `CHORD_INTERVALS` row.
 *
 * The rule follows the vocabulary itself rather than a taste call: on any
 * chord of four or more tones the perfect fifth is optional, the ninth is
 * optional once an eleventh is present, and the eleventh once a thirteenth
 * is. Three-tone chords keep every tone — a triad missing its fifth is a real
 * ambiguity (a rootless reading), not an omission.
 */
function optionalTonesFor(intervals: readonly number[]): readonly number[] {
  if (intervals.length < 4) return [];
  const optional: number[] = [];
  const fifth = intervals.indexOf(7);
  if (fifth >= 0) optional.push(fifth);
  const ninth = intervals.indexOf(14);
  if (ninth >= 0 && intervals.includes(17)) optional.push(ninth);
  const eleventh = intervals.indexOf(17);
  if (eleventh >= 0 && intervals.includes(21)) optional.push(eleventh);
  return optional;
}

/** Per-quality omittable tones, by index into `CHORD_INTERVALS[quality]`. */
export const CHORD_OPTIONAL_TONES: Record<ChordQuality, readonly number[]> =
  Object.fromEntries(
    Object.entries(CHORD_INTERVALS).map(([quality, intervals]) => [
      quality,
      optionalTonesFor(intervals),
    ]),
  ) as Record<ChordQuality, readonly number[]>;

/**
 * Chord qualities that occur on the degrees of a mode.
 *
 * Derived from the scale itself — stack scale thirds on every degree and
 * classify the result — rather than a hand-written table per mode, so all
 * seven modes stay consistent and a new scale needs no second edit.
 *
 * This is the "permitted vocabulary" chord recognition can be handed: the
 * qualities the current key actually offers. It is a preference, not a
 * filter, so a borrowed bVI is still named when nothing in key explains it.
 */
export function diatonicChordQualities(scaleType: ScaleType): ChordQuality[] {
  const scale = SCALE_INTERVALS[scaleType] ?? SCALE_INTERVALS.ionian;
  const size = scale.length;
  if (size === 0) return [];

  // Scale step `degree` (may run past the end) as a pitch class.
  const at = (degree: number): number => {
    const octave = Math.floor(degree / size);
    const step = ((degree % size) + size) % size;
    return (((scale[step] + 12 * octave) % 12) + 12) % 12;
  };

  const found: ChordQuality[] = [];
  const add = (quality: ChordQuality) => {
    if (!found.includes(quality)) found.push(quality);
  };

  for (let degree = 0; degree < size; degree += 1) {
    const root = at(degree);
    const third = (at(degree + 2) - root + 12) % 12;
    const fifth = (at(degree + 4) - root + 12) % 12;
    const seventh = (at(degree + 6) - root + 12) % 12;

    const triad: ChordQuality | null =
      third === 4 && fifth === 7
        ? "maj"
        : third === 3 && fifth === 7
          ? "min"
          : third === 3 && fifth === 6
            ? "dim"
            : third === 4 && fifth === 8
              ? "aug"
              : null;
    if (!triad) continue;
    add(triad);
    if (size < 7) continue;

    if (triad === "maj") add(seventh === 11 ? "maj7" : seventh === 10 ? "7" : "maj");
    else if (triad === "min") add(seventh === 10 ? "min7" : seventh === 11 ? "mMaj7" : "min");
    else if (triad === "dim") add(seventh === 10 ? "m7b5" : seventh === 9 ? "dim7" : "dim");
    else add("maj7#5");
  }

  return found;
}

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
  "5": "5",
  "6": "6",
  min6: "m6",
  "69": "6/9",
  add9: "add9",
  dim7: "dim7",
  mMaj7: "mMaj7",
  "maj7#5": "maj7♯5",
  "7sus4": "7sus4",
  "7b5": "7♭5",
  "7#5": "7♯5",
  "9": "9",
  maj9: "maj9",
  min9: "m9",
  "9sus4": "9sus4",
  "7b9": "7♭9",
  "7#9": "7♯9",
  "7#11": "7♯11",
  "7b13": "7♭13",
  "11": "11",
  min11: "m11",
  "13": "13",
  maj13: "maj13",
  min13: "m13",
  dim11: "dim11",
  maj11: "maj11",
};

/** The picker's grouping of `CHORD_QUALITIES` — triads stay one tap away,
 *  the extended vocabulary sits below. Order within a group is deliberate
 *  (plain → altered), so the chips read as a ladder. */
export const CHORD_QUALITY_GROUPS: { label: string; qualities: ChordQuality[] }[] = [
  {
    label: "Triads",
    qualities: ["maj", "min", "dim", "aug", "5", "sus2", "sus4"],
  },
  {
    label: "Sevenths & sixths",
    qualities: ["7", "maj7", "min7", "m7b5", "dim7", "mMaj7", "6", "min6", "69", "add9"],
  },
  {
    label: "Altered dominants",
    qualities: ["7b9", "7#9", "7#11", "7b13", "7b5", "7#5", "7sus4", "maj7#5"],
  },
  {
    // The diminished family keeps its extensions together rather than in the
    // extended group: they read as one colour, and nobody looks for a dim13
    // among the ninths.
    label: "Diminished",
    qualities: ["dim11"],
  },
  {
    label: "Extended (9·11·13)",
    qualities: ["9", "maj9", "min9", "11", "maj11", "min11", "13", "maj13", "min13", "9sus4"],
  },
];

/** Symbol spellings that mean a quality but aren't a suffix spelling of one. */
const CHORD_QUALITY_SYMBOLS: Record<string, string> = {
  "ø": "m7b5",
  "ø7": "m7b5",
  "o": "dim",
  "o7": "dim7",
  "°": "dim",
  "°7": "dim7",
  "°11": "dim11",
  "o11": "dim11",
  "+": "aug",
  "Δ": "maj",
  "Δ7": "maj7",
  "dom7": "7",
  "6/9": "69",
};

/** Suffix → quality when the chord's third is MAJOR (or absent). */
const MAJOR_SUFFIX_QUALITY: Record<string, ChordQuality> = {
  "": "maj",
  maj: "maj",
  "5": "5",
  "6": "6",
  "69": "69",
  add9: "add9",
  "7": "7",
  maj7: "maj7",
  "9": "9",
  maj9: "maj9",
  "11": "11",
  "13": "13",
  maj13: "maj13",
  "7b5": "7b5",
  "7#5": "7#5",
  "7b9": "7b9",
  "7#9": "7#9",
  "7#11": "7#11",
  "7b13": "7b13",
  "maj7#5": "maj7#5",
  sus2: "sus2",
  sus4: "sus4",
  "7sus4": "7sus4",
  "9sus4": "9sus4",
  dim: "dim",
  dim7: "dim7",
  aug: "aug",
  dim11: "dim11",
  maj11: "maj11",
};

/** Suffix → quality when the chord's third is MINOR (`min`/`m`/`-` peeled
 *  off by the caller or by `parseChordQuality` itself). Suspensions ignore
 *  the third entirely, so they map the same in both directions. */
const MINOR_SUFFIX_QUALITY: Record<string, ChordQuality> = {
  "": "min",
  "6": "min6",
  "69": "min6",
  "7": "min7",
  "9": "min9",
  "11": "min11",
  "13": "min13",
  "7b5": "m7b5",
  maj7: "mMaj7",
  dim: "dim",
  dim7: "dim7",
  sus2: "sus2",
  sus4: "sus4",
};

/**
 * Normalise a chord-symbol suffix to the closed `ChordQuality` vocabulary.
 *
 * `minor` tells the function the chord's third is minor when the caller has
 * already peeled the `m`/`min`/`-` marker off (the honeycomb token parser
 * does this); it also peels it itself, so both `parseChordQuality("m7")` and
 * `parseChordQuality("7", true)` give `min7`.
 *
 * Returns `null` when the suffix carries more than one quality can hold
 * (e.g. `"7#9b13"`). Callers keep those as `Chord.extendedSuffix`.
 */
export function parseChordQuality(suffix: string, minor = false): ChordQuality | null {
  let s = (suffix ?? "").trim().replace(/\s+/g, "");
  if (s === "") return minor ? "min" : "maj";

  const symbol = CHORD_QUALITY_SYMBOLS[s] ?? CHORD_QUALITY_SYMBOLS[s.replace(/♭/g, "b").replace(/♯/g, "#")];
  if (symbol) s = symbol;

  // Peel a leading third marker. Order matters: `Maj`/`M7` are the MAJOR
  // shorthand, `min`/`m`/`-` are minor, and a bare `M` stays whatever the
  // caller said (chord charts are split on it, and existing importers read
  // it as minor) — so it is only peeled by the case-insensitive rule below.
  let isMinor = minor;
  for (let guard = 0; guard < 3; guard += 1) {
    if (/^maj/i.test(s)) {
      s = `maj${s.slice(3)}`;
      break;
    }
    if (/^M(?=[0-9])/.test(s)) {
      s = `maj${s.slice(1)}`;
      break;
    }
    if (/^min/i.test(s)) {
      isMinor = true;
      s = s.slice(3);
      continue;
    }
    if (/^m(?!aj)/i.test(s)) {
      isMinor = true;
      s = s.slice(1);
      continue;
    }
    if (s.startsWith("-")) {
      isMinor = true;
      s = s.slice(1);
      continue;
    }
    break;
  }

  // Quality spellings reach us in both ASCII and glyph form.
  s = s
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .toLowerCase();

  if (s === "") return isMinor ? "min" : "maj";
  const table = isMinor ? MINOR_SUFFIX_QUALITY : MAJOR_SUFFIX_QUALITY;
  return table[s] ?? null;
}

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
  return CHORD_INTERVALS[quality] ?? [0, 4, 7];
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