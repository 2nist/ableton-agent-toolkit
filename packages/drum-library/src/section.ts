import { ABLETON_SAFE_NOTES } from "./ableton.js";
import { voiceOf, type KitVoice } from "./kit.js";
import {
  outlineToClickPattern,
  outlineToGroovePattern,
  outlineBeatsPerBar,
  synthesizeOutlineFill,
  type MeterOutline,
  type CellVoice,
} from "./meter.js";
import type { PackedNote, PackedVariant, PackedPreset } from "./presetData.js";
import type { TimeDomain } from "@music-theory/song-blueprint";
import { applyTimeDomain, normaliseTimeDomain } from "./timeDomain.js";
import type { DrumPattern } from "./presets.js";
import {
  planSectionHandoffFills,
  scaleToVelocityPreset,
  occurrenceSeed,
  hashSeed,
  type FillLibrary,
  type HandoffSectionInput,
} from "./handoffs.js";
import { applyCyclicDevelopment, tileGrooveVaried } from "./vary.js";
import { applyDrumBlocks, DRUM_LANE_VOICES, type DrumBlock, type DrumLaneId } from "./blocks.js";
import { audibleLanes } from "./lanes.js";

export { audibleLanes };
import { extractGroove, applyGroove } from "./groove.js";
import {
  synthesizeTransition,
  planSectionTransitions,
  transitionFlavor,
  type TransitionModel,
  type TransitionFlavor,
} from "./transitions.js";
import type { DrumNote } from "./types.js";
import { PRESET_DATA } from "./presetData.js";

/**
 * The DAW-agnostic per-section drum pipeline shared by BOTH the web app's
 * MIDI export (`planDrumStem`) and the Ableton bridge's clip planner
 * (`planDrumClips`). Everything the two export paths must agree on — how a
 * section's rhythm resolves, how per-voice Euclidean overrides replace the
 * base groove, how a detour/variation or a named transition rewrites the
 * section's tail, and how handoff fills + crashes are spliced — lives here
 * in one place, so the exported .mid, live MIDI out, and "Send to Ableton"
 * can never silently drift apart the way they did before (voice overrides
 * and detours were previewed in the UI but dropped at export).
 *
 * Following the same pattern as `planSectionHandoffFills`: pure functions
 * over already-resolved descriptors — a caller maps its own song-blueprint
 * section into `SectionDrumInput` (resolving outline-vs-pattern, which
 * needs song-level types this package deliberately avoids) and gets back
 * absolute-positioned notes it can drop straight into a MIDI file or an
 * Ableton clip.
 */

/** Round a beat position to 4 decimals — enough for 1/16ths and the
 *  fractional beat values odd meters produce, without floating-point noise
 *  leaking into exported files. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A single resolved hit at an absolute beat offset — the currency of the
 *  per-section pipeline. `DrumNote`-shaped so it flows through the library's
 *  existing note functions unchanged. */
export interface TiledNote {
  beat: number;
  pitch: number;
  velocity: number;
  /** Gate / step length in beats — authored by Drum Blocks' step FX
   *  (`durBeats`); absent → the caller's fixed hit duration (0.25). */
  duration?: number;
}

/** Structurally compatible with song-blueprint's `EuclidPattern` (k/n/rotation)
 *  without importing it — this package stays decoupled from the schema. */
export interface EuclidLike {
  k: number;
  n: number;
  rotation: number;
}

/** A `MeterOutline` that may carry the per-cell kick/snare/hat voicing
 *  (`cellVoices`) song-blueprint adds on top of this package's own
 *  `MeterOutline` — a caller passing a schema outline can still be read
 *  here. */
export interface OutlineWithVoices extends MeterOutline {
  cellVoices?: CellVoice[];
}

/** The onset step indices of a Euclidean pattern, cyclically shifted by
 *  `rotation` — the exact same math the UI's step view uses, exported here
 *  so the export path and the preview can never disagree about where a
 *  per-voice pattern's hits actually fall. */
export function euclidOnsetSteps(pat: EuclidLike): number[] {
  const n = Math.max(1, Math.floor(pat.n));
  const k = Math.max(1, Math.min(n, Math.floor(pat.k)));
  const r = ((Math.floor(pat.rotation) % n) + n) % n;
  const steps: number[] = [];
  for (let i = 0; i < k; i++) {
    const base = Math.round((i * n) / k);
    steps.push((base + r) % n);
  }
  return steps.sort((a, b) => a - b);
}
/** A named Euclidean rhythm a chord grid can be seeded from. */
export interface RhythmSeed {
  name: string;
  k: number;
  n: number;
  rotation: number;
}

/**
 * The seeds the Harmony panel offers, shortest cycle first: the two straight
 * ones, the three-, five-, six- and seven-note cycles that read as groove
 * rather than as a metronome, and one pushed variant of the three.
 *
 * The plug-in's `Source/Rhythm.cpp` mirrors this table; its console tests pin
 * each seed's digits against the values this function produces, so the two
 * cannot drift apart silently.
 */
export const RHYTHM_SEEDS: RhythmSeed[] = [
  { name: "Eighths", k: 8, n: 16, rotation: 0 },
  { name: "On the beat", k: 4, n: 16, rotation: 0 },
  { name: "Three over the bar", k: 3, n: 16, rotation: 0 },
  { name: "Pushed three", k: 3, n: 16, rotation: 2 },
  { name: "Five over the bar", k: 5, n: 16, rotation: 0 },
  { name: "Six over the bar", k: 6, n: 16, rotation: 0 },
  { name: "Seven over the bar", k: 7, n: 16, rotation: 0 },
];

/** Sixteenths in a rhythm grid — one bar of 4/4, matching the note planner. */
export const RHYTHM_GRID_STEPS = 16;

/**
 * The grid a seed fills: its onsets mapped onto the bar proportionally (an
 * eight-step loop lands on the eighths), hits at "normal", with the downbeat
 * and half-bar accented when the loop hits them. Returns the sixteen digits the
 * preset and the plug-in both use.
 */
export function seedRhythmGrid(seed: RhythmSeed, steps = RHYTHM_GRID_STEPS): string {
  const levels = new Array<number>(steps).fill(0);

  for (const step of euclidOnsetSteps(seed)) {
    const placed = Math.round((step * steps) / Math.max(1, seed.n));
    if (placed >= 0 && placed < steps) levels[placed] = 2;
  }

  for (const anchor of [0, Math.floor(steps / 2)]) {
    if (levels[anchor] !== 0) levels[anchor] = 3;
  }

  return levels.join("");
}


/**
 * One canonical GM pitch per `KitVoice` — all 13 voices, not just the subset
 * `ABLETON_SAFE_NOTES` covers. Derived from `ABLETON_SAFE_NOTES` where the
 * two overlap so they can't drift; the missing voices (pedalHat, tomLow,
 * rideBell) get their standard GM note.
 */
export const KIT_PITCHES: Record<KitVoice, number> = {
  ...ABLETON_SAFE_NOTES,
  // General MIDI's own assignments — a GM kit plays these untransposed.
  shaker: 82,
  cowbell: 56,
  pedalHat: 44,
  tomLow: 41,
  rideBell: 53,
};

export interface EuclidPatternNotesOptions {
  /** Beats spanned by one full loop of the pattern — the base variant's
   *  `lengthBeats` (a 4/4 bar is 4 beats, a 7/8 bar is 3.5). The `n` steps
   *  are spread evenly across this, exactly how the necklace UI reads "n
   *  steps around one loop", so a per-voice pattern lands in the same place
   *  on the timeline it appears in the preview. Defaults to 4 (one 4/4 bar). */
  loopBeats?: number;
  /** Velocity for every generated hit. Callers usually rescale afterwards
   *  (`scaleToVelocityPreset`), so a plain 100 is the neutral default. */
  velocity?: number;
}

/** Turns a free-form Euclidean pattern into notes for one voice — `k`
 *  onsets spread as evenly as possible across `n` steps, rotated, each
 *  step `loopBeats / n` apart. The per-voice authoring path ("edit the
 *  drums voice by voice") and the export now share this. */
export function euclidPatternNotes(
  pat: EuclidLike,
  voice: KitVoice,
  opts: EuclidPatternNotesOptions = {},
): PackedNote[] {
  const n = Math.max(1, Math.floor(pat.n));
  const loopBeats = Math.max(0.001, opts.loopBeats ?? 4);
  const stepBeats = loopBeats / n;
  const velocity = opts.velocity ?? 100;
  const pitch = KIT_PITCHES[voice];
  return euclidOnsetSteps(pat).map((step) => [round4(step * stepBeats), pitch, velocity]);
}

/**
 * Applies per-voice Euclidean overrides (`drumVoicePatterns`) on top of a
 * section's resolved base groove: every note whose voice is overridden is
 * removed and replaced with that voice's own k/n rhythm, everything else
 * (including the base's humanized microtiming) is kept. Returns the base
 * untouched when there's nothing to override.
 *
 * The override's step grid spans the base's own loop length (`lengthBeats`),
 * so a voice re-patterned in the UI previews and exports in the same place.
 * New notes inherit the base voice's peak velocity when the voice was
 * present, falling back to a neutral 100 (the caller rescales to the
 * section's velocity preset afterwards anyway).
 */
export function applyVoiceOverrides(
  base: PackedVariant,
  overrides: Partial<Record<KitVoice, EuclidLike>>,
  opts: EuclidPatternNotesOptions = {},
): PackedVariant {
  const keys = (Object.keys(overrides) as KitVoice[]).filter((v) => overrides[v]);
  if (keys.length === 0) return base;

  const overridden = new Set(keys);
  const baseVelocity = new Map<KitVoice, number>();
  for (const [, pitch, velocity] of base.notes) {
    const v = voiceOf(pitch);
    if (v && (!baseVelocity.has(v) || velocity > baseVelocity.get(v)!)) baseVelocity.set(v, velocity);
  }

  const notes: PackedNote[] = [
    ...base.notes.filter(([, pitch]) => {
      const v = voiceOf(pitch);
      return !(v && overridden.has(v));
    }),
    ...keys.flatMap((v) =>
      euclidPatternNotes(overrides[v]!, v, {
        loopBeats: opts.loopBeats ?? base.lengthBeats,
        velocity: opts.velocity ?? baseVelocity.get(v) ?? 100,
      }),
    ),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  return { ...base, notes };
}

export interface ApplyVariationOptions {
  /** Total beats of the section. */
  durationBeats: number;
  /** The base groove's beats per bar, to convert `variationBars` into beats. */
  barBeats: number;
  /** Peak velocity the detour's notes are scaled to (the section's velocity preset). */
  velocityTarget: number;
  /** Section-relative beat where the detour begins. Absent → the detour sits
   *  in the section's final `variationBars` bars (the classic ending fill). */
  variationStartBeat?: number;
}

/**
 * Spliced a section's ending detour (`drumVariationOutline`) into its final
 * bars — a deliberately different k/n for a bar or two that then returns to
 * the base groove, the way a drummer plays a fill that lands back in the
 * pocket. Replaces whatever was in the span (including an automatic handoff
 * fill planned for the same region — a authored detour wins over the
 * default, same precedence `applySectionTransition` already uses). The
 * detour's own per-cell voicing (`cellVoices`) is honored when present; a
 * plain click otherwise — identical to how the section's main outline is
 * generated. Returns the notes unchanged when there's no detour or the
 * section is too short to give up a bar.
 */
export function applyVariation(
  tiled: TiledNote[],
  variation: OutlineWithVoices | null | undefined,
  variationBars: number | undefined,
  opts: ApplyVariationOptions,
): TiledNote[] {
  if (!variation) return tiled;
  const { durationBeats, barBeats, velocityTarget } = opts;
  const maxBars = Math.floor(durationBeats / barBeats);
  if (maxBars < 1) return tiled;
  const spanBars = Math.max(1, Math.min(Math.round(variationBars ?? 1), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  // `variationStartBeat` positions the detour ANYWHERE in the section (the
  // beat-dot insert surface); absent → it sits in the final bars, the classic
  // ending fill. Clamped so it never overruns the section edge.
  const fillStart = Math.max(
    0,
    Math.min(opts.variationStartBeat ?? durationBeats - spanBeats, durationBeats - spanBeats),
  );

  const raw = variation.cellVoices
    ? outlineToGroovePattern(variation, variation.cellVoices)
    : outlineToClickPattern(variation);
  const peak = Math.max(...raw.map(([, , v]) => v), 1);
  const scale = velocityTarget / peak;

  const generated: TiledNote[] = raw.map(([beat, pitch, velocity]) => ({
    beat: round4(beat + fillStart),
    pitch,
    velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
  }));

  const kept = tiled.filter((n) => n.beat < fillStart || n.beat >= fillStart + spanBeats);
  return [...kept, ...generated];
}

export interface ApplyTransitionOptions {
  model: TransitionModel | null | undefined;
  transitionBars: number | undefined;
  durationBeats: number;
  variant: PackedVariant;
  velocityTarget: number;
  /** Subdivision grid the transition is generated on — an outline's
   *  `cellBeats`, or 0.25 (16ths) for standard presets. */
  gridBeats?: number;
  /** A catalog flavor for the model — the seeded variation the
   *  auto-assigner picks; absent → the model's default flavor. */
  flavor?: TransitionFlavor;
}

/**
 * Splices a section's named transition (`drumTransitionModel`) into its
 * final bars, replacing whatever's there — including an automatic handoff
 * fill. An explicit transition is a deliberate authorial choice and wins
 * over the default fill, not a second thing layered on top of it. Moved
 * here from the bridge so the app's MIDI export applies the exact same
 * build/break/cut/drop the Ableton export does.
 */
export function applySectionTransition(
  tiled: TiledNote[],
  opts: ApplyTransitionOptions,
): TiledNote[] {
  const { model } = opts;
  if (!model) return tiled;

  const barBeats = opts.variant.beatsPerBar;
  const gridBeats = opts.gridBeats ?? 0.25;

  const maxBars = Math.floor(opts.durationBeats / barBeats);
  if (maxBars < 1) return tiled;
  const spanBars = Math.max(1, Math.min(Math.round(opts.transitionBars ?? 1), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  const fillStart = opts.durationBeats - spanBeats;
  const baseNotes: PackedNote[] = tiled
    .filter((n) => n.beat >= fillStart)
    .map((n): PackedNote => [round4(n.beat - fillStart), n.pitch, n.velocity]);

  const generated = synthesizeTransition(model, {
    spanBeats,
    gridBeats,
    velocityTarget: opts.velocityTarget,
    baseNotes,
    flavor: opts.flavor,
  });

  const kept = tiled.filter((n) => n.beat < fillStart);
  const added: TiledNote[] = generated.map(([beat, pitch, velocity]) => ({
    beat: round4(beat + fillStart),
    pitch,
    velocity,
  }));
  return [...kept, ...added];
}

/**
 * Borrows real human timing/velocity character from an actual corpus
 * performance and imposes it on an outline's mathematically-precise onsets —
 * real feel for a meter the corpus has no recording of at all. Extracted
 * per-*beat*, not per-bar: "how a human's timing wobbles within one beat"
 * generalizes across any bar length. Always draws from the `standard`
 * preset's first variant (a real, always-baked E-GMD performance); falls
 * back to the untouched notes if that preset is missing rather than
 * throwing — humanization is an improvement, not a hard dependency. Shared
 * by the bridge's outline export and the app's, so both produce the same
 * groove.
 */
export function humanizeOutlineNotes(
  notes: PackedNote[],
  cellBeats: number,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): PackedNote[] {
  const reference = presetData.standard?.variants[0];
  if (!reference || reference.notes.length === 0) return notes;
  const groove = extractGroove(toDrumNotes(reference.notes), 1, cellBeats);
  if (groove.points.length === 0) return notes;
  return toPackedNotes(applyGroove(toDrumNotes(notes), groove));
}

function toDrumNotes(notes: PackedNote[]): DrumNote[] {
  return notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity }));
}

function toPackedNotes(notes: DrumNote[]): PackedNote[] {
  return notes.map((n): PackedNote => [n.beat, n.pitch, n.velocity]);
}

/** A section's drums, as the shared pipeline needs them — resolved by the
 *  caller (which owns the song-level types), consumed by
 *  `planSectionDrumNotes`. */
export interface SectionDrumInput {
  sectionId: string;
  occurrenceIndex: number;
  /** The section's role (chorus/verse/bridge/...) — drives the automatic
   *  role-aware transition when the user hasn't authored one. */
  role?: string | null;
  /** Resolved base groove — an outline-driven variant, a pattern variant,
   *  or `null` for silence. The caller resolves outline-vs-pattern because
   *  that path needs song-blueprint / song-structure types. */
  variant: PackedVariant | null;
  /** The section's own beats-per-bar (4 for 4/4). Anchors motion blocks on
   *  a blocks-only section — one whose base groove resolved to `null` —
   *  where there's no variant to read a bar length from. Absent → 4. */
  beatsPerBar?: number;
  /** The section's `drumMeterOutline`, for outline-driven sections only —
   *  used to inject a synthesized fill for its (often fractional)
   *  beats-per-bar, which `FILL_DATA` has nothing for. */
  outline?: OutlineWithVoices | null;
  /** Per-voice Euclidean overrides (`drumVoicePatterns`). */
  voiceOverrides?: Partial<Record<KitVoice, EuclidLike>>;
  /** The section's own clock (`BlueprintSection.timeDomain`). Applied to the
   *  finished plan, so every gesture block, fill and authored block moves with
   *  the material rather than staying on the song's grid. */
  timeDomain?: TimeDomain;
  /** Authored drum blocks (`BlueprintSection.drumBlocks`) — the range-scoped
   *  authoring layer applied last, after the detour/transition gestures, so
   *  authored material always wins within its lane+range. */
  blocks?: DrumBlock[];
  /** Ending detour (`drumVariationOutline`). */
  variation?: OutlineWithVoices | null;
  variationBars?: number;
  /** Section-relative beat where the detour begins — absent → the section's
   *  final bars. Lets a detour live anywhere on the timeline. */
  variationStartBeat?: number;
  /** Named ending transition (`drumTransitionModel`). */
  transitionModel?: TransitionModel | null;
  transitionBars?: number;
  /** The section's subdivision grid for transitions — its outline's
   *  `cellBeats`, or 0.25 for preset/heuristic grooves. */
  gridBeats?: number;
  /** Muted surface lanes (`BlueprintSection.drumLaneMute`). Their notes are
   *  dropped from the plan, so the canvas, the .mid, live out and the
   *  Ableton clips all lose them together. */
  mute?: readonly DrumLaneId[];
  /** Soloed surface lanes (`drumLaneSolo`). Any solo ⇒ only soloed lanes
   *  sound; a muted lane stays silent even when soloed. */
  solo?: readonly DrumLaneId[];
  durationBeats: number;
  velocityTarget: number;
  /** Beat length of each bar, in order, when the section changes meter.
   *  Absent → every bar is `beatsPerBar`, which is what every section
   *  without a `meterMap` means, and the tiling is untouched. */
  barBeats?: number[];
  /** Grooves for the *other* bar lengths in `barBeats`, keyed by bar length
   *  ("3.5"). `variant` covers the opening meter; a run of 7/8 bars gets the
   *  7/8 groove instead of a 4/4 one chopped at 3.5 beats. */
  meterVariants?: Record<string, PackedVariant>;
}

/** Consecutive bars of equal length, as `{ beatsPerBar, lengthBeats }` runs.
 *  A section with one meter is a single run covering the whole thing. */
export function meterRuns(barBeats: number[] | undefined, fallbackBeatsPerBar: number, durationBeats: number): { beatsPerBar: number; lengthBeats: number }[] {
  if (!barBeats || barBeats.length === 0) return [{ beatsPerBar: fallbackBeatsPerBar, lengthBeats: durationBeats }];
  const runs: { beatsPerBar: number; lengthBeats: number }[] = [];
  for (const length of barBeats) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.beatsPerBar - length) < 1e-9) last.lengthBeats += length;
    else runs.push({ beatsPerBar: length, lengthBeats: length });
  }
  return runs;
}

export interface SectionDrumPlan {
  /** Absolute-positioned notes within the section (beat 0 = section start),
   *  sorted by beat then pitch, ready for a caller to offset by the span's
   *  own start beat. */
  notes: TiledNote[];
}

export interface PlanSectionDrumOptions {
  /** Pitch used for the crash that resolves a preceding fill. Defaults to
   *  the library's `CRASH_PITCH` (note 49). */
  crashPitch?: number;
}

/**
 * One clip per section's drums — the full pipeline both export paths share:
 *
 *   1. Per-voice Euclidean overrides (`drumVoicePatterns`) are applied to
 *      the resolved base groove first, so the handoff planner matches fills
 *      against the *final* groove.
 *   2. A synthesized fill is injected for any outline-driven meter
 *      `FILL_DATA` has no analogue for.
 *   3. Each section is velocity-scaled and tiled with seeded per-occurrence
 *      micro-variation (`tileGrooveVaried`).
 *   4. A role-aware transition (`planSectionTransitions`) is auto-assigned
 *      to every section the user hasn't authored — build up into choruses,
 *      break down out of verses, drop out of bridges, cut into outros —
 *      with a seeded catalog flavor and 1-2 bars for variation. The
 *      automatic handoff fill only fires where no such gesture applies
 *      (and then by seeded spice), so NOT every section carries a fill.
 *   5. An authored detour (`drumVariationOutline`) and a named transition
 *      (`drumTransitionModel`) overwrite the same tail region in turn —
 *      authorial choices always beat the auto-assigned gesture.
 *   6. A section preceded by a fill or build-up opens with a crash, unless
 *      its groove already does.
 *
 * Pure and DAW-agnostic — the caller maps its own section model into
 * `SectionDrumInput` (exactly like `planSectionHandoffFills`), so both the
 * web app and the Ableton bridge call one function and can't drift.
 */
/** Pitch → lane, inverted from the library's own voice tables so the filter
 *  below can never disagree with `DRUM_LANE_VOICES`. Built LAZILY: this
 *  module and blocks.ts import each other, and a top-level loop here would
 *  run before blocks.ts has initialized its tables. */
let laneByPitchCache: Map<number, DrumLaneId> | null = null;
function laneByPitch(): Map<number, DrumLaneId> {
  if (laneByPitchCache) return laneByPitchCache;
  const map = new Map<number, DrumLaneId>();
  for (const lane of Object.keys(DRUM_LANE_VOICES) as DrumLaneId[]) {
    for (const voice of DRUM_LANE_VOICES[lane]) map.set(KIT_PITCHES[voice], lane);
  }
  laneByPitchCache = map;
  return map;
}

/** Drop the notes of muted / un-soloed lanes. A note whose pitch belongs to
 *  no known lane (a click track, a stray import) is kept. */
function filterMutedLanes(notes: TiledNote[], input: SectionDrumInput): TiledNote[] {
  if ((input.mute?.length ?? 0) === 0 && (input.solo?.length ?? 0) === 0) return notes;
  const play = audibleLanes(input.mute, input.solo);
  const byPitch = laneByPitch();
  return notes.filter((n) => {
    const lane = byPitch.get(n.pitch);
    return lane === undefined || play.has(lane);
  });
}

export function planSectionDrumNotes(
  inputs: SectionDrumInput[],
  fills: FillLibrary,
  opts: PlanSectionDrumOptions = {},
): SectionDrumPlan[] {
  const crashPitch = opts.crashPitch ?? ABLETON_SAFE_NOTES.crash;

  // First pass: apply per-voice overrides so the handoff planner matches
  // fills against the final groove, not the pre-override base.
  const resolved: (PackedVariant | null)[] = inputs.map((input) =>
    input.variant && input.voiceOverrides
      ? applyVoiceOverrides(input.variant, input.voiceOverrides, { loopBeats: input.variant.lengthBeats })
      : input.variant,
  );

  // Give planSectionHandoffFills somewhere to find a fill for each distinct
  // outline meter in play — a local copy, never mutating the caller's fills,
  // and only adding keys that aren't already present.
  const outlineFillData: FillLibrary = { acoustic: fills.acoustic, synth: { ...fills.synth } };
  for (const input of inputs) {
    if (!input.outline) continue;
    const key = String(outlineBeatsPerBar(input.outline));
    if (!outlineFillData.synth[key]) {
      outlineFillData.synth[key] = [synthesizeOutlineFill(input.outline, 100)];
    }
  }

  const handoffInputs: HandoffSectionInput[] = inputs.map((input, i) => ({
    sectionId: input.sectionId,
    occurrenceIndex: input.occurrenceIndex,
    variant: resolved[i],
    durationBeats: input.durationBeats,
    velocityTarget: input.velocityTarget,
  }));
  const handoffPlans = planSectionHandoffFills(handoffInputs, outlineFillData);

  // Role-aware auto transitions for sections the user hasn't authored —
  // build up into choruses, break down out of verses, drop out of bridges,
  // cut into outros, seeded catalog flavor + bars for variation. Sections
  // with an authored transition/variation return null and keep their own.
  const autoTransitions = planSectionTransitions(
    inputs.map((input) => ({
      sectionId: input.sectionId,
      occurrenceIndex: input.occurrenceIndex,
      role: input.role ?? null,
      durationBeats: input.durationBeats,
      beatsPerBar: input.variant ? input.variant.beatsPerBar : 4,
      velocityTarget: input.velocityTarget,
      manualModel: input.transitionModel != null,
      hasVariation: input.variation != null,
    })),
  );

  // Which boundaries actually carry the automatic handoff fill — only where
  // there's no authored gesture AND no auto transition, and then by seeded
  // spice, so NOT every section gets a fill (the old blanket behavior).
  const fillApplied: boolean[] = inputs.map((input, i) => {
    if (input.transitionModel || input.variation) return false;
    if (autoTransitions[i].model !== null) return false;
    if (handoffPlans[i].fillStart === null) return false;
    return hashSeed(`${occurrenceSeed(input.sectionId, input.occurrenceIndex)}:fill`) % 100 < 45;
  });
  // A crash opens the next section when the previous one built into it —
  // a fill or a build-up gesture both resolve onto this downbeat.
  const precededByGesture: boolean[] = inputs.map((_, i) =>
    i > 0 ? fillApplied[i - 1] || autoTransitions[i - 1].model === "buildUp" : false,
  );

  return inputs.map((input, i) => {
    const variant = resolved[i];

    // Blocks-only section — e.g. an importer's transcribed material over a
    // muted base (`drumPattern: "none"`). The timeline preview compiles the
    // authored blocks over an empty tiled base, so the export must too:
    // compile here and nothing else — no fills, no auto transitions, no
    // crash — so imported material stays exactly what was authored.
    const clock = normaliseTimeDomain(input.timeDomain);
    if (!variant) {
      if (!input.blocks || input.blocks.length === 0) return { notes: [] };
      return {
        notes: applyTimeDomain<TiledNote>(
          filterMutedLanes(
            applyDrumBlocks([], input.blocks, {
              durationBeats: input.durationBeats,
              beatsPerBar: input.beatsPerBar ?? 4,
              velocityTarget: input.velocityTarget,
              gridBeats: input.gridBeats,
              seed: occurrenceSeed(input.sectionId, input.occurrenceIndex),
            }),
            input,
          ),
          clock,
          input.durationBeats,
        ),
      };
    }

    const velocityTarget = input.velocityTarget;
    const scaled = scaleToVelocityPreset(variant.notes, velocityTarget);

    const seed = occurrenceSeed(input.sectionId, input.occurrenceIndex);
    const runs = meterRuns(input.barBeats, variant.beatsPerBar, input.durationBeats);
    let tiled: TiledNote[];
    if (runs.length <= 1) {
      tiled = tileGrooveVaried(
        scaled.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
        variant.lengthBeats,
        input.durationBeats,
        { seed },
      );
    } else {
      // Meter change inside the section: restart the groove at each new bar
      // length with that length's own variant, so the downbeat keeps landing
      // on the bar line instead of a 4/4 groove being chopped at 3.5.
      tiled = [];
      let cursor = 0;
      runs.forEach((run, runIndex) => {
        const runVariant = input.meterVariants?.[String(run.beatsPerBar)] ?? variant;
        const body = tileGrooveVaried(
          scaleToVelocityPreset(runVariant.notes, velocityTarget).map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
          runVariant.lengthBeats,
          run.lengthBeats,
          { seed: `${seed}:meter${runIndex}` },
        );
        for (const note of body) tiled.push({ ...note, beat: note.beat + cursor });
        cursor += run.lengthBeats;
      });
    }

    // The 4-bar cycle: open the hat in bar 2, turn the last eighth over into
    // the next cycle in bar 4. Structural development, applied BEFORE the
    // gestures so a fill or transition still owns the tail it replaces.
    //
    // NOT for an authored meter outline: that groove is the user's own bar,
    // built cell by cell for a meter the corpus has nothing for. Imposing a
    // 4-bar turnaround on it would be the system editing their work.
    if (!input.outline) {
      tiled = applyCyclicDevelopment(tiled, {
        beatsPerBar: variant.beatsPerBar,
        durationBeats: input.durationBeats,
        velocityTarget,
        openHatPitch: ABLETON_SAFE_NOTES.openHat,
        closedHatPitch: ABLETON_SAFE_NOTES.closedHat,
        kickPitch: ABLETON_SAFE_NOTES.kick,
      });
    }

    const plan = handoffPlans[i];
    if (fillApplied[i] && plan.fillStart !== null) {
      const fillStart = plan.fillStart;
      tiled = tiled.filter((note) => note.beat < fillStart);
      for (const [beat, pitch, velocity] of plan.fillNotes) {
        tiled.push({ beat, pitch, velocity });
      }
    }

    // Authorial ending gestures overwrite the automatic fill's region.
    if (input.variation) {
      tiled = applyVariation(tiled, input.variation, input.variationBars, {
        durationBeats: input.durationBeats,
        barBeats: variant.beatsPerBar,
        velocityTarget,
        variationStartBeat: input.variationStartBeat,
      });
    }

    // The effective transition: the user's authored model, else the
    // role-aware auto gesture (with its seeded catalog flavor).
    const auto = autoTransitions[i];
    const model = input.transitionModel ?? auto.model;
    if (model) {
      const flavor = input.transitionModel ? undefined : transitionFlavor(model, auto.flavor);
      tiled = applySectionTransition(tiled, {
        model,
        transitionBars: input.transitionModel ? (input.transitionBars ?? 1) : auto.bars,
        durationBeats: input.durationBeats,
        variant,
        velocityTarget,
        gridBeats: input.gridBeats,
        flavor,
      });
    }

    // Authored drum blocks (`drumBlocks`) — the range-scoped authoring
    // layer. Applied last of the content layers so authored material always
    // wins over automatic fills/transitions; the crash guard below sees the
    // final notes (an authored crash on the cym lane at beat 0 suppresses
    // the automatic one via the existing check).
    if (input.blocks && input.blocks.length > 0) {
      tiled = applyDrumBlocks(tiled, input.blocks, {
        durationBeats: input.durationBeats,
        beatsPerBar: variant.beatsPerBar,
        velocityTarget,
        gridBeats: input.gridBeats,
        seed: occurrenceSeed(input.sectionId, input.occurrenceIndex),
      });
    }

    // A build-up/fill resolves onto a crash — put it on this section's
    // downbeat when the previous section built into it, unless the groove
    // already opens with one.
    if (precededByGesture[i] && !tiled.some((n) => n.pitch === crashPitch && n.beat < 0.25)) {
      tiled.push({ beat: 0, pitch: crashPitch, velocity: Math.min(127, velocityTarget + 4) });
    }

    tiled.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
    // The section's own clock is applied to the finished plan: every layer
    // above (groove, fill, transition, authored blocks) moves together, which
    // is what "this section runs at half time" has to mean.
    return {
      notes: applyTimeDomain<TiledNote>(
        filterMutedLanes(tiled, input),
        clock,
        input.durationBeats,
      ),
    };
  });
}
