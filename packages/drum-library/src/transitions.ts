import { ABLETON_SAFE_NOTES } from "./ableton.js";
import type { PackedNote } from "./presetData.js";

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
}

function resolveVoices(voices: TransitionInput["voices"]): TransitionVoices {
  return { ...DEFAULT_VOICES, ...voices };
}

function buildUp(input: TransitionInput, voices: TransitionVoices): PackedNote[] {
  const grid = Math.max(input.gridBeats, 0.001);
  const totalSteps = Math.max(1, Math.round(input.spanBeats / grid));
  const notes: PackedNote[] = [];

  // Roll density ramps from "every 4th step" to "every step" over the span.
  for (let step = 0; step < totalSteps; step++) {
    const progress = totalSteps > 1 ? step / (totalSteps - 1) : 1;
    const stride = Math.max(1, Math.round(4 * (1 - progress)));
    if (step % stride !== 0) continue;
    const velocity = Math.round(input.velocityTarget * (0.4 + 0.6 * progress));
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
  const keepEvery = [1, 2, 4]; // stage 0: everything, 1: every other, 2: every 4th

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
  return [
    [0, voices.kick, input.velocityTarget],
    [0, voices.snare, input.velocityTarget],
  ];
}

function dropOut(input: TransitionInput, voices: TransitionVoices): PackedNote[] {
  const dropped = new Set((input.dropVoices ?? ["kick"]).map((voice) => voices[voice]));
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
