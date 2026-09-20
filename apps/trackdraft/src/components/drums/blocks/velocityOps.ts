import { hashSeed } from "@drum/library";

/**
 * Velocity shaping ops — the "shape the whole selection" family from the
 * velocity card: ramps · accents every N · alternate · humanize · scale.
 *
 * Pure factor math: each op returns a multiplier for the hits on a step,
 * so relative dynamics inside a step survive (a ghost under an accent stays
 * proportionally quieter). The caller (DrumBlocksView) materializes the
 * audible range into `steps` notes, scales each hit and clamps — the write
 * lands in the draft like any other edit, so one gesture = one Apply.
 *
 * `humanize` is seeded (`hashSeed`), so the same selection always bakes
 * the same feel — deterministic preview ≡ export, matching the house rule.
 */

export type VelocityOp =
  | { kind: "ramp"; dir: "up" | "down" }
  | { kind: "accents"; every: number }
  | { kind: "alternate" }
  | { kind: "humanize" }
  | { kind: "scale"; target: number };

export interface VelocityOpContext {
  /** Steps in the selection (>= 1). */
  stepCount: number;
  /** The loudest hit in this lane's selection — what `scale` maps to `target`. */
  peakVelocity: number;
  /** Stable seed for `humanize` (e.g. `${sectionId}:${lane}`). */
  seed?: string;
}

/** Multiplier for every hit on step `i` (0-based within the selection). */
export function velocityOpFactor(op: VelocityOp, i: number, ctx: VelocityOpContext): number {
  const n = Math.max(1, ctx.stepCount);
  switch (op.kind) {
    case "ramp": {
      const t = n <= 1 ? 1 : i / (n - 1);
      return op.dir === "up" ? 0.55 + 0.45 * t : 1 - 0.45 * t;
    }
    case "accents": {
      const every = Math.max(2, Math.round(op.every));
      return i % every === 0 ? 1 : 0.7;
    }
    case "alternate":
      return i % 2 === 0 ? 1 : 0.65;
    case "humanize": {
      // ±12% velocity jitter, seeded per (seed, step) — idempotent.
      const h = (hashSeed(`${ctx.seed ?? "vel"}:hop:${i}`) % 1000) / 1000 - 0.5;
      return 1 + h * 0.24;
    }
    case "scale": {
      if (ctx.peakVelocity <= 0) return 1;
      return Math.max(0.05, Math.min(127 / Math.max(1, ctx.peakVelocity), op.target / ctx.peakVelocity));
    }
  }
}

/** The exact math the view writes: scale + round + clamp to MIDI range. */
export function scaleVelocity(v: number, factor: number): number {
  return Math.max(1, Math.min(127, Math.round(v * factor)));
}
