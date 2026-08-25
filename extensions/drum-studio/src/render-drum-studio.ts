/**
 * Pure transformation from a Drum Studio result into NoteDescription[]
 * ready for MidiClip.notes. No SDK dependency beyond the NoteDescription
 * type, so it's unit-testable without @platform/test-harness — mirrors
 * progression-studio's render-progression.ts.
 *
 * Two modes, matching the modal's two tabs:
 * - `"pattern"` — pick a curated `DrumPattern` + variant (4/4, 6/8, 5/4,
 *   7/8, machine idioms — the Phase 2 picker).
 * - `"outline"` — build any meter from 2s/3s ("apples and gallopings",
 *   Kevin Ferguson's "Mastering Odd, Complex Time Signatures and Rhythms")
 *   for meters the corpus has no analogue for at all (9/8, 11/16, 25/16...),
 *   with each cell's downbeat optionally voiced as kick or snare rather
 *   than a flat click.
 *
 * Both modes share one transition system at the clip's tail: `"none"` plus
 * @drum/library's four named models (buildUp/breakDown/cut/dropOut), and
 * an optional meter-change pickup that primes the ear for a different
 * subdivision just before the boundary.
 */

import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  PRESET_DATA,
  scaleToVelocityPreset,
  tileGrooveVaried,
  outlineBeatsPerBar,
  outlineToGroovePattern,
  synthesizeTransition,
  countLabel,
  type DrumPattern,
  type PackedPreset,
  type PackedNote,
  type MeterCell,
  type MeterOutline,
  type CellVoice,
  type TransitionModel,
} from "@drum/library";
import { getVelocity, type VelocityPreset } from "@music-theory/song-structure";

/** `"none"` is a UI-level sentinel on top of @drum/library's four real models. */
export type TransitionChoice = "none" | TransitionModel;

interface TransitionFields {
  transitionModel: TransitionChoice;
  /** Bars at the clip's end devoted to the transition — ignored when `transitionModel` is `"none"`. */
  transitionBars: number;
  /** Optional meter-change prep: subdivide the transition's final beat at `4 / nextGridDenominator` instead of the section's own grid. */
  nextGridDenominator?: number;
}

export interface PatternStudioResult extends TransitionFields {
  mode: "pattern";
  pattern: DrumPattern;
  variantIndex: number;
  /** Bars of the pattern's *own* meter to fill — e.g. 4 bars of a 7/8 groove. */
  bars: number;
  velocity: VelocityPreset;
}

export interface OutlineStudioResult extends TransitionFields {
  mode: "outline";
  /**
   * The actual 2s/3s cell sequence, in order — the modal's cell editor lets
   * a player start from a curated `canonicalGroupings` option and then
   * freely toggle/add/remove cells, so this (not a numerator + grouping
   * index) is the real source of truth. Values other than 2 or 3 are
   * dropped defensively before rendering.
   */
  cells: number[];
  /** Per-cell kick/snare/hat assignment, same length as `cells` (short arrays default the rest to `"hat"`). */
  cellVoices: CellVoice[];
  denominator: number;
  bars: number;
  velocity: VelocityPreset;
}

export type StudioResult = PatternStudioResult | OutlineStudioResult;

export interface RenderedDrumPattern {
  notes: NoteDescription[];
  totalBeats: number;
  /** Human-readable label, e.g. "Standard · 4 bars" or "7/16 (2+2+3) · 4 bars". */
  name: string;
}

/** A short, un-sustained hit — matches trackdraft-bridge's drumClips.ts convention. */
const HIT_DURATION = 0.25;

/** Friendly labels for the picker — every `DrumPattern` except `"none"`, which has no preset data. */
export const PATTERN_LABELS: Record<Exclude<DrumPattern, "none">, string> = {
  kick_only: "Kick only",
  standard: "Standard",
  half_time: "Half-time",
  driving: "Driving",
  bridge_sparse: "Bridge (sparse)",
  intense: "Intense",
  dnb: "Drum & Bass",
  "78": "7/8",
  "68": "6/8",
  "54": "5/4",
  four_on_floor: "Four on the Floor",
  trap: "Trap",
  breakbeat: "Breakbeat",
};

export const BAR_OPTIONS = [1, 2, 4, 8, 16, 32];

/** Numerators with at least a generated 2s/3s decomposition worth offering directly in the picker. */
export const OUTLINE_NUMERATOR_OPTIONS = [5, 7, 9, 10, 11, 12, 13];
export const OUTLINE_DENOMINATOR_OPTIONS = [8, 16];

/** Every transition choice the modal offers, in menu order — `"none"` first. */
export const TRANSITION_LABELS: Record<TransitionChoice, string> = {
  none: "None",
  buildUp: "Build up",
  breakDown: "Break down",
  cut: "Cut",
  dropOut: "Drop out",
};

/**
 * Patterns that actually have preset data to render, in `PATTERN_LABELS`
 * order — computed against whatever `presetData` is passed (real
 * `PRESET_DATA` by default) so the picker never offers an empty pattern.
 */
export function selectablePatterns(
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): Exclude<DrumPattern, "none">[] {
  return (Object.keys(PATTERN_LABELS) as Exclude<DrumPattern, "none">[]).filter(
    (pattern) => (presetData[pattern]?.variants.length ?? 0) > 0,
  );
}

type TiledNote = { beat: number; pitch: number; velocity: number };

function tileAndFormat(notes: PackedNote[], tileLengthBeats: number, durationBeats: number, seed: string): TiledNote[] {
  return tileGrooveVaried(
    notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
    tileLengthBeats,
    durationBeats,
    { seed },
  );
}

function toNoteDescriptions(tiled: TiledNote[]): NoteDescription[] {
  return tiled
    .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    .map(({ beat, pitch, velocity }) => ({ pitch, startTime: beat, duration: HIT_DURATION, velocity }));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

const VALID_TRANSITION_MODELS: readonly TransitionModel[] = ["buildUp", "breakDown", "cut", "dropOut"];

function isTransitionModel(value: TransitionChoice): value is TransitionModel {
  return (VALID_TRANSITION_MODELS as readonly string[]).includes(value);
}

/**
 * Replaces a clip's final `transitionBars` bars with one of
 * @drum/library's named transition models, splicing at the same
 * fillStart/filter/push convention `drumClips.ts`'s handoff logic and
 * `synthesizeOutlineFill` already use. A no-op when `transitionModel` is
 * `"none"`, or when the clip is too short to give up a whole bar to it.
 */
function applyTransition(
  tiled: TiledNote[],
  durationBeats: number,
  barBeats: number,
  gridBeats: number,
  velocityTarget: number,
  fields: TransitionFields,
): TiledNote[] {
  // Guards against an unrecognized/missing model (e.g. a stale cached
  // modal payload from before a field was added) degrading to "no
  // transition" rather than crashing renderStudioResult entirely.
  if (!isTransitionModel(fields.transitionModel)) return tiled;

  const maxBars = Math.floor(durationBeats / barBeats);
  const spanBars = Math.max(1, Math.min(Math.round(fields.transitionBars), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  const fillStart = durationBeats - spanBeats;
  const baseNotes: PackedNote[] = tiled
    .filter((n) => n.beat >= fillStart)
    .map((n): PackedNote => [round4(n.beat - fillStart), n.pitch, n.velocity]);

  const generated = synthesizeTransition(fields.transitionModel, {
    spanBeats,
    gridBeats,
    velocityTarget,
    baseNotes,
    nextGridBeats: fields.nextGridDenominator ? 4 / fields.nextGridDenominator : undefined,
  });

  const kept = tiled.filter((n) => n.beat < fillStart);
  const added = generated.map(([beat, pitch, velocity]): TiledNote => ({ beat: round4(beat + fillStart), pitch, velocity }));
  return [...kept, ...added];
}

function renderPatternResult(
  result: PatternStudioResult,
  presetData: Partial<Record<DrumPattern, PackedPreset>>,
): RenderedDrumPattern | null {
  const preset = presetData[result.pattern];
  if (!preset || preset.variants.length === 0) return null;

  const variantIndex = Math.max(0, Math.min(result.variantIndex, preset.variants.length - 1));
  const variant = preset.variants[variantIndex]!;
  const bars = Math.max(1, Math.round(result.bars));

  const velocityTarget = getVelocity(result.velocity);
  const scaled = scaleToVelocityPreset(variant.notes, velocityTarget);
  const durationBeats = bars * variant.beatsPerBar;

  let tiled = tileAndFormat(scaled, variant.lengthBeats, durationBeats, `${result.pattern}:${variantIndex}`);
  tiled = applyTransition(tiled, durationBeats, variant.beatsPerBar, 0.25, velocityTarget, result);
  const notes = toNoteDescriptions(tiled);

  const label = PATTERN_LABELS[result.pattern as Exclude<DrumPattern, "none">] ?? result.pattern;
  return { notes, totalBeats: durationBeats, name: `${label} · ${bars} bar${bars === 1 ? "" : "s"}` };
}

function renderOutlineResult(result: OutlineStudioResult): RenderedDrumPattern | null {
  const cells = result.cells.filter((c): c is MeterCell => c === 2 || c === 3);
  if (cells.length === 0) return null;

  const outline: MeterOutline = { cellBeats: 4 / result.denominator, cells, label: countLabel(cells) };
  const barBeats = outlineBeatsPerBar(outline);
  const bars = Math.max(1, Math.round(result.bars));
  const durationBeats = bars * barBeats;

  const velocityTarget = getVelocity(result.velocity);
  const groove = scaleToVelocityPreset(outlineToGroovePattern(outline, result.cellVoices), velocityTarget);
  let tiled = tileAndFormat(groove, barBeats, durationBeats, `outline:${cells.join("-")}/${result.denominator}`);
  tiled = applyTransition(tiled, durationBeats, barBeats, outline.cellBeats, velocityTarget, result);

  const notes = toNoteDescriptions(tiled);
  const numeratorValue = cells.reduce((sum, cell) => sum + cell, 0);
  const meterLabel = `${numeratorValue}/${result.denominator} (${cells.join("+")})`;
  return { notes, totalBeats: durationBeats, name: `${meterLabel} · ${bars} bar${bars === 1 ? "" : "s"}` };
}

/**
 * Renders one `StudioResult` to notes — dispatches on `mode`. Pattern mode
 * scales+tiles a curated variant (the same two steps `trackdraft-bridge`'s
 * `planDrumClips` uses per section); outline mode builds a kick/snare/hat
 * groove from the 2s/3s cells and their assigned voices. Both then run the
 * same transition splice and reuse `@drum/library` as-is throughout.
 *
 * Returns `null` when there's nothing to render (an empty pattern, or no
 * valid 2/3 cells) rather than throwing.
 */
export function renderStudioResult(
  result: StudioResult,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): RenderedDrumPattern | null {
  return result.mode === "outline" ? renderOutlineResult(result) : renderPatternResult(result, presetData);
}
