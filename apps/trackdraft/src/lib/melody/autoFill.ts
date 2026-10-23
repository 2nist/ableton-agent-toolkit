import { generateMelody, mulberry32, DEFAULT_MELODY_MODEL } from "@platform/progression-engine";
import type { MelodyChord } from "@platform/progression-engine";
import {
  hashSeed,
  resolveChordOccurrences,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  narrativeHarmonySection,
  styleMelodyLine,
  type StyleProfile,
} from "@drum/library";
import { NOTE_TO_PC, SCALE_INTERVALS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type {
  BlueprintSection,
  BlueprintSong,
  MelodyGenerationParams,
  MelodyNote,
  MelodyTrack,
} from "../../types/blueprint";

/**
 * Corpus-driven melody auto-fill, conditioned on the Mix/Bend.
 *
 * The generator itself lives in `@platform/progression-engine` (trained on
 * 1.42M melody points from the Tegridy/LA MIDI corpus). This module owns the
 * TrackDraft-specific parts:
 *   - the chord stream the line must ride (`resolveChordOccurrences`, so
 *     loops/repeats and outline-driven timing match playback);
 *   - the Bend → generator mapping (density, register, contour, rhythm,
 *     repetition, rest);
 *   - gentle in-key snapping, motif repetition, and the final contour
 *     transform (marked `contourApplied` so the stem doesn't shape it twice).
 */

const MAX_NOTE_BEATS = [8, 6, 4, 2, 1, 0.5] as const;

/** App chord qualities → the model's table keys (the corpus says `m7`). */
/** The melody model's own (smaller) quality vocabulary — a chord quality
 *  folds onto the closest member so a `min9` generates a minor-flavoured
 *  line instead of silently falling through to major. */
const MODEL_QUALITY: Record<string, string> = {
  maj: "maj",
  min: "min",
  dim: "dim",
  aug: "aug",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  m7b5: "m7b5",
  sus2: "sus2",
  sus4: "sus4",
  // — extended vocabulary —
  "5": "maj",
  "6": "maj",
  min6: "min",
  "69": "maj",
  add9: "maj",
  dim7: "dim",
  mMaj7: "min",
  "maj7#5": "maj7",
  "7sus4": "7",
  "7b5": "7",
  "7#5": "7",
  "9": "7",
  maj9: "maj7",
  min9: "m7",
  "9sus4": "7",
  "7b9": "7",
  "7#9": "7",
  "7#11": "7",
  "7b13": "7",
  "11": "7",
  min11: "m7",
  "13": "7",
  maj13: "maj7",
  min13: "m7",
};

export function melodyParamsFromProfile(profile: StyleProfile): MelodyGenerationParams {
  return {
    contour: profile.melodyContour ?? 0.5,
    density: profile.melodyDensity ?? 0.5,
    register: profile.melodyRegister ?? 0.5,
    rhythm: profile.melodyRhythm ?? 0.5,
    repetition: profile.melodyRepetition ?? 0.5,
    rest: profile.melodyRest ?? 0.5,
  };
}

export function melodyParamsDiffer(
  a: MelodyGenerationParams | undefined,
  b: MelodyGenerationParams,
  tolerance = 0.01,
): boolean {
  if (!a) return true;
  return (Object.keys(b) as (keyof MelodyGenerationParams)[]).some(
    (key) => Math.abs((a[key] ?? 0.5) - b[key]) > tolerance,
  );
}

/** Stable starting seed; Reroll passes a different one. */
export function melodySeedFor(sectionId: string): number {
  return Math.abs(hashSeed(`melody:${sectionId}`)) % 2_147_483_647 || 1;
}

export function canAutoFill(section: BlueprintSection): boolean {
  return section.chords.length > 0;
}

export interface GenerateMelodyOptions {
  section: BlueprintSection;
  song: BlueprintSong;
  seed: number;
  /** Section-relative chord stream length (defaults to the section's own). */
  durationBeats?: number;
  sectionKey?: NoteName;
  sectionScale?: ScaleType;
}

/**
 * Build a complete `MelodyTrack` for a section. Deterministic for a given
 * seed + Bend state; returns null when there are no chords to ride.
 */
export function generateSectionMelody({
  section,
  song,
  seed,
  durationBeats,
  sectionKey,
  sectionScale,
}: GenerateMelodyOptions): MelodyTrack | null {
  if (!canAutoFill(section)) return null;

  // Narrative's melody axes (density, contour) only exist if the generator
  // reads the EFFECTIVE profile — this is one of their two consumers.
  const profile = resolveEffectiveStyle(section, song);
  const params = melodyParamsFromProfile(profile);
  const bpb = beatsPerBarOf(section);
  const duration = durationBeats ?? section.bars * bpb;

  const occurrences = resolveChordOccurrences(
    narrativeHarmonySection(section, resolveNarrativeProfile(section, song)),
    duration,
  );
  if (occurrences.length === 0) return null;

  const chords: MelodyChord[] = occurrences.map((occurrence) => ({
    rootPc: pitchClassOf(occurrence.chord.root),
    quality: MODEL_QUALITY[occurrence.chord.extendedSuffix ? baseQuality(occurrence.chord.extendedSuffix) : occurrence.chord.quality] ?? "maj",
    durationBeats: occurrence.duration,
  }));

  const rng = mulberry32(seed >>> 0);
  const densityIndex = Math.max(
    0,
    Math.min(MAX_NOTE_BEATS.length - 1, Math.round(params.density * (MAX_NOTE_BEATS.length - 1))),
  );

  const generated = generateMelody(DEFAULT_MELODY_MODEL, chords, {
    rng,
    maxNoteBeats: MAX_NOTE_BEATS[densityIndex],
    velocity: Math.round(84 + profile.energy * 36),
    contourBias: 0.15 + params.contour * 0.6,
  });

  let notes: MelodyNote[] = generated.notes.map((note) => ({
    pitch: note.pitch,
    startTime: round4(note.startTime),
    duration: round4(note.duration),
    velocity: note.velocity,
  }));

  notes = shiftRegister(notes, params.register);
  notes = shapeRhythm(notes, params.rhythm, params.rest, bpb, rng);
  notes = repeatMotif(notes, params.repetition, bpb, rng);
  notes = snapToScale(notes, sectionKey ?? song.key, sectionScale ?? song.scale);
  notes = styleMelodyLine(notes, params.contour).map((note) => ({
    ...note,
    startTime: round4(note.startTime),
    duration: round4(note.duration),
    pitch: Math.max(36, Math.min(96, Math.round(note.pitch))),
  }));

  return {
    notes,
    source: "generated",
    seed,
    params,
    contourApplied: true,
    generatedAt: new Date().toISOString(),
  };
}

function beatsPerBarOf(section: BlueprintSection): number {
  const numerator = section.timeSignatureNumerator ?? 4;
  const denominatorPower = section.timeSignatureDenPower ?? 2;
  return numerator * (4 / 2 ** denominatorPower);
}

function pitchClassOf(root: NoteName): number {
  return NOTE_TO_PC[root] ?? 0;
}

function baseQuality(suffix: string): string {
  const match = suffix.match(/^(maj|min|dim|aug|sus|m|7)/);
  if (!match) return "maj";
  if (suffix.startsWith("min") || suffix.startsWith("m") && !suffix.startsWith("maj")) return "min";
  if (suffix.startsWith("dim")) return "dim";
  if (suffix.startsWith("aug")) return "aug";
  if (suffix.includes("maj7") || suffix.includes("M7")) return "maj7";
  if (suffix.startsWith("m7")) return "min7";
  if (suffix.startsWith("7")) return "7";
  if (suffix.startsWith("sus2")) return "sus2";
  if (suffix.startsWith("sus4")) return "sus4";
  return "maj";
}

/** ±1 octave around the corpus register (0.5 = as generated). */
function shiftRegister(notes: MelodyNote[], register: number): MelodyNote[] {
  const octaves = Math.round((register - 0.5) * 2);
  if (octaves === 0) return notes;
  return notes.map((note) => ({ ...note, pitch: note.pitch + octaves * 12 }));
}

/**
 * Rhythm axis: below neutral, tighten onsets toward the 8th grid; above it,
 * push weak notes late and open phrase-end rests. Durations are clamped so
 * the monophonic line never overlaps itself.
 */
function shapeRhythm(
  notes: MelodyNote[],
  rhythm: number,
  rest: number,
  beatsPerBar: number,
  rng: () => number,
): MelodyNote[] {
  if (notes.length === 0) return notes;

  const sync = Math.max(0, (rhythm - 0.5) * 2); // 0..1
  const tighten = Math.max(0, (0.5 - rhythm) * 2); // 0..1
  const restAmount = Math.max(0, (rest - 0.5) * 2); // 0..1

  const starts = notes.map((note, index) => {
    let start = note.startTime;
    if (tighten > 0) {
      const grid = 0.5;
      start = start + (Math.round(start / grid) * grid - start) * tighten;
    }
    if (sync > 0 && index % 2 === 1) {
      start += sync * 0.25;
    }
    return start;
  });

  const shaped: MelodyNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const next = starts[i + 1] ?? Number.POSITIVE_INFINITY;
    let duration = Math.max(0.1, Math.min(notes[i]!.duration, next - starts[i]!));
    // Air at the last note of each bar when the Rest axis leans open.
    const atBarEnd = Math.abs((starts[i]! % beatsPerBar) - (beatsPerBar - 1)) < 0.26;
    if (atBarEnd && restAmount > 0 && rng() < restAmount * 0.6) {
      duration = Math.max(0.1, duration * (1 - restAmount * 0.5));
    }
    shaped.push({ ...notes[i]!, startTime: round4(starts[i]!), duration: round4(duration) });
  }
  return shaped;
}

/**
 * Repetition axis: with increasing probability, later 2-bar phrases restate
 * the opening phrase's contour. Through-composed at neutral and below.
 */
function repeatMotif(
  notes: MelodyNote[],
  repetition: number,
  beatsPerBar: number,
  rng: () => number,
): MelodyNote[] {
  const strength = Math.max(0, (repetition - 0.5) * 2);
  if (strength <= 0 || notes.length < 3) return notes;

  const phraseBeats = Math.max(beatsPerBar, beatsPerBar * 2);
  const phrases = new Map<number, MelodyNote[]>();
  for (const note of notes) {
    const key = Math.floor(note.startTime / phraseBeats);
    if (!phrases.has(key)) phrases.set(key, []);
    phrases.get(key)!.push(note);
  }
  const first = phrases.get(0);
  if (!first || first.length === 0) return notes;

  const pitchAt = new Map<MelodyNote, number>();
  for (const [phraseIndex, phrase] of phrases) {
    if (phraseIndex === 0 || rng() > strength) continue;
    const base = phrase[0]!.pitch;
    phrase.forEach((note, index) => {
      const ref = first[index % first.length]!;
      const target = base + (ref.pitch - first[0]!.pitch);
      pitchAt.set(note, Math.round(note.pitch + (target - note.pitch) * 0.8));
    });
  }

  return notes.map((note) => (pitchAt.has(note) ? { ...note, pitch: pitchAt.get(note)! } : note));
}

/**
 * Gentle in-key snap: only notes within one semitone of a scale tone move.
 * Color tones and deliberate blue notes stay put.
 */
function snapToScale(notes: MelodyNote[], key: NoteName, scale: ScaleType): MelodyNote[] {
  const root = NOTE_TO_PC[key] ?? 0;
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const pcs = new Set(intervals.map((interval) => (root + interval) % 12));
  return notes.map((note) => {
    const pc = ((note.pitch % 12) + 12) % 12;
    if (pcs.has(pc)) return note;
    for (const delta of [1, -1]) {
      if (pcs.has((pc + delta + 12) % 12)) {
        return { ...note, pitch: note.pitch + delta };
      }
    }
    return note;
  });
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
