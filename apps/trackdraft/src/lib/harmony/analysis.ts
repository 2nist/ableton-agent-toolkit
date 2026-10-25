/**
 * HarmonyAnalysis — the single derivation of a section's harmony.
 *
 * The strip, the lens, the rehearsal chart and the study table all read this
 * one object, so a numeral, a function, a borrowed flag or a tension value
 * can never disagree between surfaces. Nothing here writes to the song.
 *
 * Roman numerals are DERIVED from (root, quality, the home in force at that
 * beat), never trusted from `Chord.romanNumeral`. The stored string is still
 * carried as `sourceLabel` so imported material (a DCML "FV65/V", a corpus
 * spelling) can be shown beside the derived reading instead of being
 * overwritten.
 */

import {
  MODE_DATA,
  SCALE_INTERVALS,
  getChordIntervals,
  noteName,
  pitchClass,
  type ChordQuality,
  type HarmonicFunction,
  type NoteName,
  type ScaleType,
} from "@music-theory/core";
import { functionalTension } from "@platform/progression-engine";
import type { BlueprintSection, Chord, TonicRegion } from "../../types/blueprint";
import { chordDisplayName } from "./chordBuilder";
import { borrowedChordIds, chordHomes } from "./modeInference";
import { degreeRelativeTo } from "./tonic";

const ROMAN_UP = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Qualities that read as a lowercase numeral. */
const MINOR_ISH: ReadonlySet<ChordQuality> = new Set<ChordQuality>(["min", "min7", "m7b5", "dim"]);

export interface HarmonyEvent {
  chordId: string;
  index: number;
  startBeat: number;
  durationBeats: number;
  home: { key: NoteName; scale: ScaleType; startBeat: number };
  /** 0-based scale degree the root sits nearest. */
  degree: number;
  accidental: -1 | 0 | 1;
  /** The derived numeral, e.g. "♭VII", "iv7", "V7/V". */
  roman: string;
  /** The label the chord arrived with, when it disagrees with `roman`. */
  sourceLabel: string | null;
  /** Absolute display name, e.g. "B♭maj7". */
  absoluteName: string;
  function: HarmonicFunction | null;
  borrowed: boolean;
  /** "V7/V" when this chord is a dominant of the next chord. */
  appliedTo: string | null;
  /** Functional estimate 0 (resolved) … 1 (tense). */
  tension: number;
  /** Absolute pitch classes this chord sounds. */
  pitchClasses: number[];
  /** Bass pitch class (honours a stored inversion). */
  bassPitchClass: number;
}

export interface Cadence {
  fromIndex: number;
  toIndex: number;
  from: string;
  to: string;
  kind: "authentic" | "plagal" | "deceptive" | "half";
  /** 1-based bar within the cycle. */
  bar: number;
}

export interface VoiceLeadingLink {
  fromIndex: number;
  toIndex: number;
  commonTones: number;
  /** Semitones the bass moves; shortest signed distance. */
  bassMotion: number;
}

export interface HarmonyAnalysis {
  key: NoteName;
  scale: ScaleType;
  regions: TonicRegion[];
  events: HarmonyEvent[];
  links: VoiceLeadingLink[];
  cadences: Cadence[];
  /** Tension per event, in the same order as `events`. */
  curve: number[];
  cycleBeats: number;
  stats: {
    borrowedCount: number;
    appliedCount: number;
    distinctDegrees: number;
    averageTension: number;
  };
}

/** The numeral's quality suffix, beyond the triad itself. */
function qualitySuffix(chord: Pick<Chord, "quality" | "extendedSuffix">): string {
  if (chord.extendedSuffix) return chord.extendedSuffix;
  switch (chord.quality) {
    case "7":
      return "7";
    case "maj7":
      return "maj7";
    case "min7":
      return "7";
    case "m7b5":
      return "7♭5";
    case "dim":
      return "°";
    case "sus4":
      return "sus4";
    default:
      return "";
  }
}

function numeralFor(
  degree: number,
  accidental: number,
  quality: ChordQuality,
  suffix: string,
  scale?: ScaleType,
): string {
  // The mode's own label carries its accidentals — in aeolian the sixth is
  // ♭VI, and printing "VI" there names a chord the key does not contain.
  // Mode labels are display labels ("vii°"), not roman bases: strip the case
  // and the quality mark and let the chord's own quality put them back.
  const label = scale ? MODE_DATA[scale]?.degrees[degree] : undefined;
  const spelled = label ? label.replace(/[°+ø]/g, "").toUpperCase() : ROMAN_UP[degree] || "I";
  const lane = accidental === -1 ? "♭" : accidental === 1 ? "♯" : "";
  const withLane = lane === "♯" && spelled.startsWith("♭") ? spelled.slice(1) : `${lane}${spelled}`;
  const cased = MINOR_ISH.has(quality) ? withLane.toLowerCase() : withLane;
  return `${cased}${suffix}`;
}

/** The chord's bass pitch class, honouring a stored inversion. */
function bassPitchClass(chord: Chord): number {
  const intervals = getChordIntervals(chord.quality);
  const inversion = chord.voicing?.inversion ?? 0;
  const index = Math.min(Math.max(0, Math.round(inversion)), intervals.length - 1);
  return (pitchClass(chord.root) + (intervals[index] ?? 0)) % 12;
}

/**
 * Derive one chord's reading. `next` is only used to name an applied
 * dominant ("the V of whatever this resolves to").
 */
export function deriveEvent(
  chord: Chord,
  next: Chord | null,
  home: { key: NoteName; scale: ScaleType; startBeat: number },
  options: { borrowed?: boolean } = {},
): Omit<HarmonyEvent, "chordId" | "index" | "startBeat" | "durationBeats"> {
  const rootPc = pitchClass(chord.root);
  const { deg, acc } = degreeRelativeTo(rootPc, pitchClass(home.key), home.scale, chord.spelling);
  const suffix = qualitySuffix(chord);

  let roman = numeralFor(deg, acc, chord.quality, suffix, home.scale);
  let appliedTo: string | null = null;
  let fn: HarmonicFunction | null = null;

  // Applied dominant: this chord is a fifth above the chord it resolves to.
  if (next && (chord.quality === "7" || chord.quality === "maj7")) {
    const interval = ((pitchClass(chord.root) - pitchClass(next.root)) % 12 + 12) % 12;
    if (interval === 7) {
      const target = degreeRelativeTo(pitchClass(next.root), pitchClass(home.key), home.scale);
      // V → I is the key's own dominant, not a *secondary* dominant: only a
      // chord that tonicises something other than the tonic gets a slash.
      const tonicisesHome = target.deg === 0 && target.acc === 0;
      if (!tonicisesHome) {
        const targetRoman = numeralFor(target.deg, target.acc, next.quality, "", home.scale);
        appliedTo = targetRoman;
        roman = `V${suffix}/${targetRoman}`;
        fn = "D";
      }
    }
  }

  // An applied dominant is chromatic on purpose — calling it borrowed too
  // double-counts the same chord under two readings.
  const borrowed = appliedTo ? false : (options.borrowed ?? false);

  if (!fn) {
    // Only a diatonic (unaccidental) degree can claim a function; a borrowed
    // chord gets its reading from `borrowed` rather than a guessed label.
    if (acc === 0) {
      const degrees = MODE_DATA[home.scale]?.degrees;
      const label = degrees?.[deg];
      fn = (label ? MODE_DATA[home.scale].map[label]?.func : null) ?? null;
    }
    if (borrowed) fn = null;
  }

  // Tension: the engine's functional estimate, keyed by the numeral without
  // its quality suffix. Unknown numerals fall back to a neutral 0.5.
  const tensionKey = numeralFor(deg, acc, chord.quality, "");
  // An applied dominant is a dominant: the functional table has no entry for
  // the chromatic root, but its pull is the strongest in the key.
  const base = appliedTo ? 0.8 : functionalTension(tensionKey);
  const tension = Math.max(0, Math.min(1, base + (borrowed ? 0.1 : 0) + (appliedTo ? 0.08 : 0)));

  const sourceLabel =
    chord.annotation && chord.annotation !== roman
      ? chord.annotation
      : chord.romanNumeral && chord.romanNumeral !== roman
        ? chord.romanNumeral
        : null;

  // Spell the absolute name to match the numeral: a flat degree reads "A♭",
  // never "G♯", however the key signature is written. A mode's own label
  // carries that intent too — in D aeolian ♭VI is Bb, not A#.
  const degreeLabel = MODE_DATA[home.scale]?.degrees[deg] ?? "";
  // Net accidentals, not the lane's: sharpening the mode's ♭III cancels to the
  // natural third, so F# must not be spelled Gb just because the label had a ♭.
  const labelAccent = degreeLabel.startsWith("♭") ? -1 : degreeLabel.startsWith("♯") ? 1 : 0;
  const net = labelAccent + acc;
  const spellingKey: NoteName = net < 0 ? "F" : net > 0 ? "C" : home.key;

  return {
    home,
    degree: deg,
    accidental: (acc < 0 ? -1 : acc > 0 ? 1 : 0) as -1 | 0 | 1,
    roman,
    sourceLabel,
    absoluteName: chordDisplayName(rootPc, chord.quality, spellingKey),
    function: fn,
    borrowed,
    appliedTo,
    tension,
    pitchClasses: getChordIntervals(chord.quality).map((i) => (rootPc + i) % 12),
    bassPitchClass: bassPitchClass(chord),
  };
}

/** Shortest signed distance between two pitch classes, in semitones. */
function signedDistance(from: number, to: number): number {
  let d = ((to - from) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

function detectCadences(events: HarmonyEvent[], beatsPerBar: number): Cadence[] {
  const out: Cadence[] = [];
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    const bar = Math.floor(b.startBeat / beatsPerBar) + 1;
    const toTonic = b.degree === 0 && b.accidental === 0;
    let kind: Cadence["kind"] | null = null;
    if (a.function === "D" && toTonic) kind = "authentic";
    else if (a.degree === 3 && toTonic) kind = "plagal";
    else if (a.function === "D" && b.degree === 5) kind = "deceptive";
    else if (a.function === "PD" && b.function === "D") kind = "half";
    if (kind) out.push({ fromIndex: i, toIndex: i + 1, from: a.roman, to: b.roman, kind, bar });
  }
  return out;
}

/**
 * Analyze the authored chord cycle of a section.
 *
 * `regions` are the homes in force (authored or inferred); a chord is judged
 * against the home at its own beat, so a modulation reads as a key change
 * rather than as a run of borrowed chords.
 */
export function analyzeSection(
  chords: Chord[],
  options: {
    key: NoteName;
    scale: ScaleType;
    regions?: TonicRegion[];
    beatsPerBar?: number;
  },
): HarmonyAnalysis {
  const { key, scale, regions = [], beatsPerBar = 4 } = options;
  const fallback = { key, scale };
  const homes = chordHomes(chords, regions, fallback);
  const borrowedIds = borrowedChordIds(chords, regions, fallback);

  let cursor = 0;
  const events: HarmonyEvent[] = chords.map((chord, index) => {
    const home = homes.get(chord.id) ?? { startBeat: 0, key, scale };
    const next = chords[index + 1] ?? null;
    const derived = deriveEvent(chord, next, home, { borrowed: borrowedIds.has(chord.id) });
    const event: HarmonyEvent = {
      ...derived,
      chordId: chord.id,
      index,
      startBeat: cursor,
      durationBeats: chord.beats,
    };
    cursor += chord.beats;
    return event;
  });

  const links: VoiceLeadingLink[] = events.slice(0, -1).map((a, i) => {
    const b = events[i + 1];
    const commonTones = a.pitchClasses.filter((pc) => b.pitchClasses.includes(pc)).length;
    return {
      fromIndex: i,
      toIndex: i + 1,
      commonTones,
      bassMotion: signedDistance(a.bassPitchClass, b.bassPitchClass),
    };
  });

  const curve = events.map((event) => event.tension);
  const averageTension = curve.length
    ? curve.reduce((sum, value) => sum + value, 0) / curve.length
    : 0;

  return {
    key,
    scale,
    regions,
    events,
    links,
    cadences: detectCadences(events, beatsPerBar),
    curve,
    cycleBeats: cursor,
    stats: {
      borrowedCount: events.filter((event) => event.borrowed).length,
      appliedCount: events.filter((event) => event.appliedTo).length,
      distinctDegrees: new Set(events.map((event) => `${event.degree}:${event.accidental}`)).size,
      averageTension,
    },
  };
}

/** Analyze a section straight from the blueprint. */
export function analyzeSectionOf(
  section: BlueprintSection,
  key: NoteName,
  scale: ScaleType,
  regions: TonicRegion[] | undefined,
  beatsPerBar = 4,
): HarmonyAnalysis {
  return analyzeSection(section.chords, { key, scale, regions, beatsPerBar });
}

/**
 * A display transpose — a *view* transform, never a write. Returns a chord
 * with the same id and timing, so selection and edits stay attached.
 */
/**
 * The root a degree + accidental means in a key — how a drag on the floor
 * becomes a chord. A flat accidental forces flat spelling, because "♭III in
 * F" is Bb, never A♯.
 */
export function rootForDegree(
  keyName: NoteName,
  scale: ScaleType,
  degree: number,
  accidental: number,
): NoteName {
  const mode = MODE_DATA[scale];
  const degrees = mode?.degrees ?? [];
  if (degrees.length === 0) return keyName;
  const label = degrees[Math.max(0, Math.min(degrees.length - 1, degree))];
  const pc = (pitchClass(keyName) + (mode.map[label]?.pc ?? 0) + accidental + 12) % 12;
  return noteName(pc, accidental < 0 ? "F" : keyName);
}

/**
 * How far a tonic move of `steps` SCALE degrees travels in semitones — the
 * floor transposes by degrees, so a drag in D dorian lands a whole tone up on
 * degree II, not a semitone. Negative steps wrap the other way.
 */
export function scaleStepSemitones(scale: ScaleType, steps: number): number {
  const mode = MODE_DATA[scale];
  const degrees = mode?.degrees ?? [];
  if (degrees.length === 0 || steps === 0) return 0;
  const wrapped = ((steps % degrees.length) + degrees.length) % degrees.length;
  const from = mode.map[degrees[0]]?.pc ?? 0;
  const to = mode.map[degrees[wrapped]]?.pc ?? 0;
  return (to - from + 12) % 12;
}

/** The ladder position of a degree + lane: semitones above the tonic, 0..11. */
export function semitoneForDegree(scale: ScaleType, degree: number, accidental: number): number {
  const mode = MODE_DATA[scale];
  const degrees = mode?.degrees ?? [];
  if (degrees.length === 0) return 0;
  const label = degrees[Math.max(0, Math.min(degrees.length - 1, degree))];
  return (((mode.map[label]?.pc ?? 0) + accidental) % 12 + 12) % 12;
}

/**
 * The root a LADDER STEP means — the inverse of `degreeRelativeTo`. A scale
 * pitch is spelled by the key (♭VI in F is Bb, never A#); a chromatic pitch is
 * spelled the way the author asked (♯III vs ♭IV), because the key has no
 * opinion about a note it does not contain.
 */
export function rootForStep(
  keyName: NoteName,
  scale: ScaleType,
  step: number,
  spelling?: "sharp" | "flat",
): NoteName {
  const pc = (pitchClass(keyName) + ((step % 12) + 12)) % 12;
  const inScale = (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(((step % 12) + 12) % 12);
  if (inScale) return noteName(pc, keyName);
  return noteName(pc, spelling === "sharp" ? "E" : "F");
}

export function transposeForDisplay(chord: Chord, semitones: number, keyName: NoteName): Chord {
  if (semitones === 0) return chord;
  const root = pitchClass(chord.root);
  const shifted = ((root + semitones) % 12 + 12) % 12;
  return { ...chord, root: noteName(shifted, keyName) };
}

/** The label a rehearsal chart shows for one event. */
export function eventLabel(
  event: HarmonyEvent,
  options: { nashville?: boolean; simplify?: boolean } = {},
): string {
  if (options.nashville) return String(event.degree + 1);
  if (!options.simplify) return event.roman;
  return event.roman.replace(/(maj7|m7♭5|7♭5|m7|7|°|sus4)$/u, "");
}
