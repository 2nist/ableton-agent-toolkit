/**
 * Step pattern model: up to 32 steps × 16 voices (drum-rack samples).
 *
 * Pure data + pure functions — no I/O, no hardware knowledge. The hardware
 * mapping (which pad is which voice/step) lives in `grid.ts`; the clock that
 * advances playback lives in `clock.ts`. This file only answers "what is in
 * the pattern" and "how does editing change it", so every editing operation
 * is unit-testable without a controller or Live.
 */
export const MAX_VOICES = 16;
export const MAX_STEPS = 32;
export const STEPS_PER_PAGE = 8;
export const DEFAULT_VELOCITY = 100;
export const ACCENT_BOOST = 24;

/** One triggered step on one voice. */
export interface StepHit {
  /** 1-127 note velocity. */
  velocity: number;
  /** Velocity accent — raises the note above the base velocity. */
  accent: boolean;
}

/** Step subdivision: "16" = 16th notes (4 per beat), "8" = 8th notes (2 per beat). */
export type StepResolution = "16" | "8";

export interface StepPattern {
  /** Number of voices in use (<= 16). Voices above this are ignored by playback/editing. */
  voices: number;
  /** Number of active steps (<= 32). Steps at index >= length are silent. */
  length: number;
  resolution: StepResolution;
  /** Swing amount 0-100 (reserved for timing feel; playback applies it). */
  swing: number;
  /** steps[voice][step] — a hit or null (silent). */
  steps: (StepHit | null)[][];
  /**
   * Last known hit per cell — retained when a step is cleared so toggling it
   * back on restores the previous velocity/accent instead of defaulting.
   * Updated on every non-null set; never cleared by clearPage/clearAll.
   */
  last: (StepHit | null)[][];
}

export function createPattern(
  voices: number = MAX_VOICES,
  length: number = MAX_STEPS,
  resolution: StepResolution = "16",
  swing = 0,
): StepPattern {
  const v = Math.max(1, Math.min(MAX_VOICES, voices));
  const l = Math.max(1, Math.min(MAX_STEPS, length));
  return {
    voices: v,
    length: l,
    resolution,
    swing: Math.max(0, Math.min(100, swing)),
    steps: Array.from({ length: v }, () => Array<StepHit | null>(MAX_STEPS).fill(null)),
    last: Array.from({ length: v }, () => Array<StepHit | null>(MAX_STEPS).fill(null)),
  };
}

/** The effective velocity for a hit once accent is applied. */
export function effectiveVelocity(hit: StepHit): number {
  return hit.accent ? Math.min(127, hit.velocity + ACCENT_BOOST) : hit.velocity;
}

/** Get a hit, or null when out of range / silent. */
export function getStep(pattern: StepPattern, voice: number, step: number): StepHit | null {
  if (voice < 0 || voice >= pattern.steps.length) return null;
  if (step < 0 || step >= MAX_STEPS) return null;
  return pattern.steps[voice]![step];
}

/** Toggle a step on/off. Re-enabling restores the last known hit (velocity/accent). */
export function toggleStep(
  pattern: StepPattern,
  voice: number,
  step: number,
  velocity?: number,
  accent?: boolean,
): StepPattern {
  if (getStep(pattern, voice, step)) {
    return setStep(pattern, voice, step, null);
  }
  const previous = pattern.last[voice]?.[step] ?? null;
  return setStep(pattern, voice, step, previous ?? { velocity: velocity ?? DEFAULT_VELOCITY, accent: accent ?? false });
}

/** Set a step to an explicit hit (or null to clear). Records into `last`. */
export function setStep(
  pattern: StepPattern,
  voice: number,
  step: number,
  hit: StepHit | null,
): StepPattern {
  if (voice < 0 || voice >= pattern.steps.length) return pattern;
  if (step < 0 || step >= MAX_STEPS) return pattern;
  const next = cloneSteps(pattern.steps);
  const nextLast = cloneSteps(pattern.last);
  next[voice]![step] = hit;
  if (hit) nextLast[voice]![step] = { ...hit };
  return { ...pattern, steps: next, last: nextLast };
}

/** Set/override a step's velocity (no-op if the step is silent). */
export function setVelocity(
  pattern: StepPattern,
  voice: number,
  step: number,
  velocity: number,
): StepPattern {
  const hit = getStep(pattern, voice, step);
  if (!hit) return pattern;
  return setStep(pattern, voice, step, { ...hit, velocity: clampVelocity(velocity) });
}

/** Toggle a step's accent flag. */
export function toggleAccent(pattern: StepPattern, voice: number, step: number): StepPattern {
  const hit = getStep(pattern, voice, step);
  if (!hit) return pattern;
  return setStep(pattern, voice, step, { ...hit, accent: !hit.accent });
}

/** Clear all steps within a page of `STEPS_PER_PAGE` steps. */
export function clearPage(pattern: StepPattern, page: number): StepPattern {
  const start = page * STEPS_PER_PAGE;
  if (start < 0 || start >= MAX_STEPS) return pattern;
  const end = Math.min(MAX_STEPS, start + STEPS_PER_PAGE);
  const next = cloneSteps(pattern.steps);
  for (const row of next) {
    for (let step = start; step < end; step++) row![step] = null;
  }
  return { ...pattern, steps: next };
}

/** Clear every step. */
export function clearAll(pattern: StepPattern): StepPattern {
  return { ...pattern, steps: pattern.steps.map((row) => row.map(() => null)) };
}

/** Copy `STEPS_PER_PAGE` steps from `source` into `target` at `page`. */
export function copyPageInto(
  target: StepPattern,
  source: StepPattern,
  page: number,
): StepPattern {
  const start = page * STEPS_PER_PAGE;
  const next = cloneSteps(target.steps);
  const nextLast = cloneSteps(target.last);
  for (let voice = 0; voice < target.voices; voice++) {
    for (let offset = 0; offset < STEPS_PER_PAGE; offset++) {
      const step = start + offset;
      if (step >= MAX_STEPS) break;
      const src = source.steps[voice]?.[step] ?? null;
      next[voice]![step] = src ? { ...src } : null;
      if (src) nextLast[voice]![step] = { ...src };
    }
  }
  return { ...target, steps: next, last: nextLast };
}

/** Randomize the steps on the current page of `voices` voices (density 0-1). */
export function randomizePage(
  pattern: StepPattern,
  page: number,
  density: number,
  random: () => number = Math.random,
): StepPattern {
  const start = page * STEPS_PER_PAGE;
  let next = pattern;
  for (let voice = 0; voice < pattern.voices; voice++) {
    for (let offset = 0; offset < STEPS_PER_PAGE; offset++) {
      const step = start + offset;
      if (step >= MAX_STEPS) break;
      if (random() < density) {
        next = setStep(next, voice, step, {
          velocity: DEFAULT_VELOCITY,
          accent: random() < 0.2,
        });
      } else {
        next = setStep(next, voice, step, null);
      }
    }
  }
  return next;
}

/** Set pattern length (clamps, never shrinks the storage). */
export function setLength(pattern: StepPattern, length: number): StepPattern {
  const l = Math.max(1, Math.min(MAX_STEPS, Math.floor(length)));
  return l === pattern.length ? pattern : { ...pattern, length: l };
}

export function setResolution(pattern: StepPattern, resolution: StepResolution): StepPattern {
  return pattern.resolution === resolution ? pattern : { ...pattern, resolution };
}

export function setSwing(pattern: StepPattern, swing: number): StepPattern {
  const s = Math.max(0, Math.min(100, Math.round(swing)));
  return s === pattern.swing ? pattern : { ...pattern, swing: s };
}

/** Number of steps per beat for the resolution. */
export function stepsPerBeat(resolution: StepResolution): number {
  return resolution === "16" ? 4 : 2;
}

/** Serializable JSON form (compact — only non-null hits, row-major). */
export interface SerializedPattern {
  v: number;
  l: number;
  r: StepResolution;
  s: number;
  /** rows of [step, velocity, accent] tuples (accent omitted when false). */
  notes: [number, number, 0 | 1][][];
}

export function serialize(pattern: StepPattern): SerializedPattern {
  return {
    v: pattern.voices,
    l: pattern.length,
    r: pattern.resolution,
    s: pattern.swing,
    notes: pattern.steps.map((row) =>
      row
        .map((hit, step) =>
          hit ? ([step, hit.velocity, hit.accent ? 1 : 0] as [number, number, 0 | 1]) : null,
        )
        .filter((n): n is [number, number, 0 | 1] => n !== null),
    ),
  };
}

export function deserialize(data: SerializedPattern): StepPattern {
  const pattern = createPattern(data.v, data.l, data.r, data.s);
  const next = cloneSteps(pattern.steps);
  const nextLast = cloneSteps(pattern.last);
  for (let voice = 0; voice < next.length; voice++) {
    for (const [step, velocity, accent] of data.notes[voice] ?? []) {
      if (step >= 0 && step < MAX_STEPS) {
        const hit = { velocity: clampVelocity(velocity), accent: accent === 1 };
        next[voice]![step] = hit;
        nextLast[voice]![step] = { ...hit };
      }
    }
  }
  return { ...pattern, steps: next, last: nextLast };
}

function cloneSteps(steps: (StepHit | null)[][]): (StepHit | null)[][] {
  return steps.map((row) => row.map((hit) => (hit ? { ...hit } : null)));
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}
