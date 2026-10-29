import { ABLETON_SAFE_NOTES } from "./ableton.js";
import type { PackedNote } from "./presetData.js";
import { hashSeed, occurrenceSeed } from "./handoffs.js";
import transitionCatalogData from "./data/transition-catalog.json" with { type: "json" };

/**
 * Named transition models for the final span of a section (or the pickup
 * into the next one) — the production vocabulary a section boundary
 * actually gets built from, distinct from the single generic "fill" this
 * library already had:
 *
 * - `buildUp` — density and velocity ramp up toward the boundary (a roll),
 *   landing on a strong hit that launches the next section.
 * - `breakDown` — the *texture* thins out approaching the boundary (fewer
 *   hits, fading velocity) — energy draining out, not a specific voice
 *   silenced (that's `dropOut`).
 * - `cut` — one sharp hit, then dead silence for the rest of the span — a
 *   hard stop before the next section hits.
 * - `dropOut` — the same material continues, but with one or more voices
 *   (by default the kick) silenced for the span — an EDM-style drop.
 */
export type TransitionModel = "buildUp" | "breakDown" | "cut" | "dropOut";

export interface TransitionVoices {
  kick: number;
  snare: number;
  hat: number;
}

const DEFAULT_VOICES: TransitionVoices = {
  kick: ABLETON_SAFE_NOTES.kick,
  snare: ABLETON_SAFE_NOTES.snare,
  hat: ABLETON_SAFE_NOTES.closedHat,
};

export interface TransitionInput {
  /** Beats spanned by the transition — usually the section's last 1-2 bars. */
  spanBeats: number;
  /** Subdivision grid to generate on: an outline's `cellBeats`, or 0.25 for standard presets. */
  gridBeats: number;
  velocityTarget: number;
  /** Defaults to standard kick/snare/closed-hat (note 36/38/42). */
  voices?: Partial<TransitionVoices>;
  /**
   * The groove/click notes that would normally play across this span,
   * positioned relative to the span's own start (beat 0). `breakDown` and
   * `dropOut` thin or filter these rather than inventing new material;
   * `buildUp` and `cut` ignore this and generate fresh material.
   */
  baseNotes?: PackedNote[];
  /** `dropOut` only: which voice(s) to silence. Defaults to `["kick"]`. */
  dropVoices?: (keyof TransitionVoices)[];
  /**
   * For a transition INTO a different meter: the upcoming section's own
   * subdivision grid. When set, the last beat of the span is replaced with
   * a short pickup spaced at this new grid instead of `gridBeats` — a
   * metric-modulation cue that primes the listener's ear for the new pulse
   * before it actually arrives. Composable with any of the four models.
   */
  nextGridBeats?: number;
  /** A named variant of the model (see `TRANSITION_CATALOG`) — the "large
   *  catalog" the auto-assigner draws from. Overrides the matching fields
   *  above; absent → the model's default flavor 0. */
  flavor?: TransitionFlavor;
}

/**
 * A named, parameterized variant of a transition model. Each model exposes
 * several flavors (denser/lighter, faster/slower, different dropped voices),
 * and the auto-assigner picks one per section by seed so repeated sections
 * of the same role don't all land the same gesture — the "large catalog"
 * the library ships, procedural instead of dozens of baked clips.
 */
export interface TransitionFlavor {
  /** Short human label (surfaced in the drums UI's auto readout). */
  label: string;
  /** Subdivision grid for generated material (`buildUp`/`cut`). */
  gridBeats?: number;
  /** `buildUp`: stride density at the roll's peak (1 = every grid step). */
  roll?: number;
  /** `buildUp`: velocity-ramp curvature (1 = linear, >1 = late spike). */
  curve?: number;
  /** `breakDown`: per-stage thinning (stage 0 keeps every 1st, stage 2 Nth). */
  keepEvery?: [number, number, number];
  /** `dropOut`: which voices to silence for the span. */
  dropVoices?: (keyof TransitionVoices)[];
  /** `cut`: include the snare stamp alongside the kick slam. */
  stamp?: boolean;
}

/** The transition catalog — every flavor each model can render. A seeded
 *  pick from here is what makes role-identical sections still vary. */
/**
 * The gesture vocabulary — EDITABLE DATA.
 *
 * `src/data/transition-catalog.json`: each model (build-up, fill, cut, …) maps
 * to its named flavours. Exported/imported as a file like the colour and style
 * tables, so the shapes a writer can drop into a transition are data rather
 * than a compile-time constant.
 */
export let TRANSITION_CATALOG: Record<TransitionModel, TransitionFlavor[]> =
  transitionCatalogData as Record<TransitionModel, TransitionFlavor[]>;

/** Replace the gesture catalog (an imported file). */
export function setTransitionCatalog(
  next: Record<TransitionModel, TransitionFlavor[]>,
): Record<TransitionModel, TransitionFlavor[]> {
  const previous = TRANSITION_CATALOG;
  TRANSITION_CATALOG = next;
  return previous;
}

/** Resolve a catalog flavor for a model+index, falling back to flavor 0. */
export function transitionFlavor(model: TransitionModel, flavorIndex: number): TransitionFlavor {
  const pool = TRANSITION_CATALOG[model];
  return pool[Math.abs(flavorIndex) % pool.length] ?? pool[0];
}

function resolveVoices(voices: TransitionInput["voices"]): TransitionVoices {
  return { ...DEFAULT_VOICES, ...voices };
}

function buildUp(input: TransitionInput, voices: TransitionVoices): PackedNote[] {
  const grid = Math.max(input.flavor?.gridBeats ?? input.gridBeats, 0.001);
  const totalSteps = Math.max(1, Math.round(input.spanBeats / grid));
  const peakStride = Math.max(1, input.flavor?.roll ?? 1);
  const curve = input.flavor?.curve ?? 1;
  const notes: PackedNote[] = [];

  // Roll density ramps from "every 4th step" to the flavor's peak stride
  // (1 = every step), with the velocity ramp shaped by the flavor's curve.
  for (let step = 0; step < totalSteps; step++) {
    const progress = totalSteps > 1 ? step / (totalSteps - 1) : 1;
    const eased = Math.pow(progress, curve);
    const stride = Math.max(1, Math.round(4 - (4 - peakStride) * eased));
    if (step % stride !== 0) continue;
    const velocity = Math.round(input.velocityTarget * (0.4 + 0.6 * eased));
    notes.push([step * grid, voices.hat, velocity]);
  }

  // Final downbeat: a full-strength kick+snare hit to launch the next section.
  const lastBeat = (totalSteps - 1) * grid;
  notes.push([lastBeat, voices.kick, input.velocityTarget]);
  notes.push([lastBeat, voices.snare, input.velocityTarget]);
  return notes;
}

function breakDown(input: TransitionInput): PackedNote[] {
  const base = input.baseNotes ?? [];
  if (base.length === 0 || input.spanBeats <= 0) return [];

  const grid = Math.max(input.gridBeats, 0.001);
  const stageCount = 3;
  const stageBeats = input.spanBeats / stageCount;
  const keepEvery = input.flavor?.keepEvery ?? [1, 2, 4];

  return base
    .filter(([beat]) => {
      const stage = Math.min(stageCount - 1, Math.floor(beat / stageBeats));
      // Step counted *within its own stage*, not from the span's start — so
      // each stage's thinning restarts at 0 and always keeps its own first
      // hit, rather than a stage's survivors depending on chance alignment
      // with step-0 of the whole span (which can empty out a short stage
      // entirely, e.g. one whose surviving multiples-of-4 all fall outside
      // its beat range).
      const stageStartStep = Math.ceil((stage * stageBeats) / grid);
      const stepInStage = Math.round(beat / grid) - stageStartStep;
      return stepInStage % keepEvery[stage]! === 0;
    })
    .map(([beat, pitch, velocity]): PackedNote => {
      const taper = 1 - 0.55 * (beat / input.spanBeats); // fades to ~45% by the end
      return [beat, pitch, Math.max(1, Math.round(velocity * taper))];
    });
}

function cut(input: TransitionInput, voices: TransitionVoices): PackedNote[] {
  const notes: PackedNote[] = [[0, voices.kick, input.velocityTarget]];
  if (input.flavor?.stamp !== false) notes.push([0, voices.snare, input.velocityTarget]);
  return notes;
}

function dropOut(input: TransitionInput, voices: TransitionVoices): PackedNote[] {
  const dropped = new Set(
    (input.flavor?.dropVoices ?? input.dropVoices ?? ["kick"]).map((voice) => voices[voice]),
  );
  return (input.baseNotes ?? []).filter(([, pitch]) => !dropped.has(pitch));
}

/** A short pickup spaced at the *next* section's grid, replacing the span's final beat — see `TransitionInput.nextGridBeats`. */
function meterPickup(spanBeats: number, nextGridBeats: number, voices: TransitionVoices, velocityTarget: number): PackedNote[] {
  const grid = Math.max(nextGridBeats, 0.001);
  const pickupBeats = Math.min(1, spanBeats);
  const start = Math.max(0, spanBeats - pickupBeats);
  const notes: PackedNote[] = [];
  for (let beat = start; beat < spanBeats - 1e-9; beat += grid) {
    notes.push([beat, voices.hat, Math.round(velocityTarget * 0.85)]);
  }
  return notes;
}

/**
 * Generate one of the four named transition models for a section-boundary
 * span. Returned notes are positioned relative to the span's own start
 * (beat 0) — a caller offsets them by wherever the span actually begins in
 * the full clip, the same convention `synthesizeOutlineFill` and
 * `planSectionHandoffFills` already use.
 */
export function synthesizeTransition(model: TransitionModel, input: TransitionInput): PackedNote[] {
  const voices = resolveVoices(input.voices);
  let notes: PackedNote[];
  switch (model) {
    case "buildUp":
      notes = buildUp(input, voices);
      break;
    case "breakDown":
      notes = breakDown(input);
      break;
    case "cut":
      notes = cut(input, voices);
      break;
    case "dropOut":
      notes = dropOut(input, voices);
      break;
  }

  if (input.nextGridBeats) {
    const pickupStart = Math.max(0, input.spanBeats - Math.min(1, input.spanBeats));
    notes = notes.filter(([beat]) => beat < pickupStart);
    notes.push(...meterPickup(input.spanBeats, input.nextGridBeats, voices, input.velocityTarget));
  }

  return notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Input to the role-aware auto-transition planner — one per section, in
 *  arrangement order. `role` drives the gesture (build up into choruses,
 *  break down out of verses, drop out of bridges...); `manualModel` /
 *  `hasVariation` mark sections the user already authored so the planner
 *  leaves them alone (their explicit choice wins downstream). */
export interface TransitionPlanInput {
  sectionId: string;
  occurrenceIndex: number;
  role?: string | null;
  durationBeats: number;
  beatsPerBar: number;
  velocityTarget: number;
  /** true when the user explicitly assigned a `drumTransitionModel`. */
  manualModel?: boolean;
  /** true when the user authored a variation/detour. */
  hasVariation?: boolean;
}

/** A section's auto-assigned transition, or a clean handoff. */
export interface SectionTransitionPlan {
  model: TransitionModel | null;
  /** Bars at the section's end devoted to the gesture (1 or 2 when set). */
  bars: number;
  /** Index into `TRANSITION_CATALOG[model]` — the seeded flavor. */
  flavor: number;
}

/**
 * Auto-assigns a transition gesture to each section's final bars from the
 * musical role of the boundary, replacing the old "every long-enough
 * section gets a generic fill" behavior:
 *
 *   - build up INTO choruses (and pre-choruses, and out of intros)
 *   - break down out of verses
 *   - drop out of bridges
 *   - cut into outros
 *   - clean handoff by default elsewhere, with a modest seeded chance of a
 *     spice gesture so not every boundary carries a fill/transition.
 *
 * Seeded variation (a catalog flavor + 1-2 bars) means repeated sections of
 * the same role render differently, not byte-identical. Sections the user
 * authored (manualModel / hasVariation) return null — the caller keeps the
 * authorial choice.
 */
export function planSectionTransitions(sections: TransitionPlanInput[]): SectionTransitionPlan[] {
  // A refrain is a chorus (Beatles-style labels) — normalize so the
  // planner builds up INTO refrains and treats them like choruses.
  const normalizeRole = (role: string | null | undefined): string | null =>
    role === "refrain" ? "chorus" : (role ?? null);

  return sections.map((section, i) => {
    const base: SectionTransitionPlan = { model: null, bars: 1, flavor: 0 };
    if (section.manualModel || section.hasVariation) return base;
    if (i === sections.length - 1) return base;

    const next = sections[i + 1];
    const nextRole = normalizeRole(next?.role);
    const role = normalizeRole(section.role);
    const maxBars = Math.max(1, Math.floor(section.durationBeats / Math.max(0.001, section.beatsPerBar)));

    // A short intro hands off cleanly — a roll/build-up over a 1-3 bar
    // intro is the "train wreck" (the intro is mostly roll, not setup).
    // Long intros can build, but only with a single-bar gesture.
    if (role === "intro" && maxBars < 4) return base;

    // Priority — the loudest, most directional signal wins. A bridge drops
    // out even into a chorus (the explicit "drop outs for bridges" ask);
    // otherwise build up into choruses/pre-choruses/out of long intros,
    // break down out of verses, cut into outros.
    let model: TransitionModel | null = null;
    if (role === "bridge") model = "dropOut";
    else if (nextRole === "chorus") model = "buildUp";
    else if (role === "intro") model = "buildUp";
    else if (nextRole === "pre_chorus" || role === "pre_chorus") model = "buildUp";
    else if (nextRole === "outro") model = "cut";
    else if (role === "verse") model = "breakDown";
    else if (nextRole === "bridge") model = "breakDown";

    if (model === null) {
      // Plain handoff — mostly clean, occasionally a spice gesture (seeded).
      const roll = hashSeed(`${occurrenceSeed(section.sectionId, section.occurrenceIndex)}:transition`);
      const r = roll % 100;
      if (r < 15) model = "buildUp";
      else if (r < 25) model = "cut";
      else if (r < 35) model = "breakDown";
      // else: clean handoff
    }
    if (model === null) return base;

    const seed = hashSeed(`${occurrenceSeed(section.sectionId, section.occurrenceIndex)}:transition:${model}`);
    const flavor = seed % TRANSITION_CATALOG[model].length;
    // A `cut` is a hard STOP, not a gap. Its span is how long the silence
    // lasts, so it has to be the last 2-4 beats — one bar at most. A 2-bar
    // cut is two bars of nothing and reads as the drums ending six bars into
    // an eight-bar section, which is not what a cut means.
    // An intro's build is likewise always a single bar (a 2-bar roll eats
    // the intro); everywhere else 2 bars is a valid gesture length.
    const bars = model === "cut" || role === "intro" ? 1 : maxBars >= 2 && seed % 3 === 0 ? 2 : 1;
    return { model, bars, flavor };
  });
}
