/**
 * Adapters: TrackDraft's own data shapes → the lyric engine's `BriefInput`.
 *
 * The brief is computed LIVE from a `BlueprintSection` (that is how TrackDraft
 * instantiates sections — a template's slots are gone the moment a map is
 * applied), but `MapSlot` still maps structurally too, so the same brief can
 * be previewed on a template before it is applied.
 *
 * Both source shapes are accepted structurally (`SectionLike` / `SlotLike`)
 * rather than by importing the store's types, so the mapping stays pure,
 * unit-testable, and honest about which fields exist where:
 *
 *  - a section has real chords, meter, melody, velocity and written lyrics;
 *  - a slot has `swing`/`optional`/`lyric` hints and no ids of its own.
 *
 * Fields neither shape carries stay `undefined` and the engine's own fallback
 * applies (e.g. no progression → assumed 4-bar phrases).
 */
import { segmentPhrases, type MelodyNoteLike } from "./melodyPhrases";
import {
  beatsPerBarFor, energyOfVelocity,
  type BriefInput, type SectionRole, type SlotLyricHints,
} from "./lyricBrief";
import { rhymeScheme, schemeString, type Pronouncer } from "./phonetics";

// ---- structural source shapes ---------------------------------------------

/** The parts of a `BlueprintSection` the brief reads. `lyricHints` is read
 *  when present (no authored field exists yet — future templates may carry a
 *  slot's `lyric` hints through apply); everything else maps 1:1. */
export interface SectionLike {
  id: string;
  role: SectionRole;
  bars: number;
  chords: readonly { romanNumeral: string }[];
  beatsPerChord: number;
  velocity: string;
  timeSignatureNumerator: number;
  timeSignatureDenPower: number;
  /** Captured melody — phrases are derived with `segmentPhrases`. */
  melody?: { notes: readonly MelodyNoteLike[] };
  /** Holds the map slot's `purpose` after apply (the FEEL: sentence). */
  transitionNote?: string;
  /** Per-section Bend — its `feel` axis is the swing signal. */
  bend?: { feel?: number };
  lyrics?: string;
  lyricHints?: SlotLyricHints;
}

/** The parts of a `MapSlot` the brief reads. */
export interface SlotLike {
  role: SectionRole;
  label: string;
  purpose: string;
  bars?: number;
  velocity?: string;
  beatsPerChord?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenPower?: number;
  progression?: readonly string[];
  swing?: number;
  optional?: boolean;
  lyric?: SlotLyricHints;
}

export interface BriefContext {
  /** The previous section in the song — feeds `prevEnergy` and `priorScheme`. */
  previous?: SectionLike | null;
  /** Injected pronunciation source, needed for `priorScheme` (end-word rhyme
   *  keys). Without one the brief simply has no prior scheme to report. */
  pronouncer?: Pronouncer | null;
  /** Persisted reroll counter (same section + same reroll → same prompts). */
  reroll?: number;
}

// ---- shared helpers --------------------------------------------------------

/**
 * `StyleProfile.feel` (0 = straight grid … 1 = swung/human) → the template
 * scale the engine's swing hint uses (0 = straight, ~58-67 = triplet swing).
 * Calibrated so the neutral 0.5 stays neutral: `feel` is scaled to ±100 around
 * it, so only a genuinely swung section (feel ≥ 0.75) trips the hint.
 */
export function swingFromBendFeel(feel: number | undefined): number | undefined {
  return feel === undefined ? undefined : Math.round(feel * 200 - 100);
}

/** Rhyme scheme of written lyrics, or `undefined` when there is nothing usable
 *  (no text, or an end word without a pronunciation). */
export function schemeOfLyrics(lyrics: string, pronouncer: Pronouncer): string | undefined {
  const lines = lyrics.split(/\r?\n/);
  if (!lines.some((line) => line.trim())) return undefined;
  const scheme = schemeString(rhymeScheme(lines, pronouncer));
  // "?" marks an end word the pronouncer didn't know — a guessed letter is not
  // a fact, so it can't be offered as the previous section's scheme.
  return scheme && !scheme.includes("?") ? scheme : undefined;
}

/** Chord cycle as roman numerals, in playing order. */
function romanNumerals(chords: readonly { romanNumeral: string }[] | undefined): string[] | undefined {
  const out = chords?.map((c) => c.romanNumeral).filter((r) => r.length > 0);
  return out && out.length > 0 ? out : undefined;
}

// ---- the two adapters ------------------------------------------------------

/** Live section → brief input. */
export function briefInputFromSection(section: SectionLike, ctx: BriefContext = {}): BriefInput {
  const notes = section.melody?.notes;
  const previous = ctx.previous ?? null;
  return {
    id: section.id,
    role: section.role,
    bars: section.bars,
    beatsPerBar: beatsPerBarFor(section.timeSignatureNumerator, section.timeSignatureDenPower),
    beatsPerChord: section.beatsPerChord,
    progression: romanNumerals(section.chords),
    purpose: section.transitionNote,
    swing: swingFromBendFeel(section.bend?.feel),
    lyric: section.lyricHints,
    phrases: notes && notes.length > 0 ? segmentPhrases(notes) : undefined,
    priorScheme: ctx.pronouncer && previous?.lyrics
      ? schemeOfLyrics(previous.lyrics, ctx.pronouncer)
      : undefined,
    energy: energyOfVelocity(section.velocity),
    prevEnergy: previous ? energyOfVelocity(previous.velocity) : undefined,
    reroll: ctx.reroll,
  };
}

/** Template slot → brief input. Ids are minted fresh when a map is applied, so
 *  a slot has no id; the map id + slot label is the stable seed instead. */
export function briefInputFromSlot(slot: SlotLike, mapId: string, reroll?: number): BriefInput {
  return {
    id: `${mapId}:${slot.label}`,
    role: slot.role,
    bars: slot.bars ?? 8,
    beatsPerBar: beatsPerBarFor(slot.timeSignatureNumerator ?? 4, slot.timeSignatureDenPower ?? 2),
    beatsPerChord: slot.beatsPerChord,
    progression: slot.progression ? [...slot.progression] : undefined,
    purpose: slot.purpose,
    swing: slot.swing,
    optional: slot.optional,
    lyric: slot.lyric,
    energy: slot.velocity ? energyOfVelocity(slot.velocity) : undefined,
    reroll,
  };
}
