import type { DrumBlockFx } from "../../../types/blueprint";

/**
 * The RANGE FX family — the block-level effects a selection writes into
 * `DrumBlock.fx` and the compiler bakes at plan time
 * (`@drum/library/src/blocks.ts`: quantize → swing → humanize → velCurve,
 * fixed order, seeded per occurrence) — so preview ≡ .mid ≡ live-out ≡
 * Send-to-Ableton for free.
 *
 * One table here so the workbench rows, the modal rows and the seeding
 * readouts all speak the same units (engine units in, display out) and the
 * labels always match what `applyRangeFx` bakes.
 */

export type FxParam = "swing" | "humanize" | "quantize" | "velCurve";

export interface FxSpec {
  id: FxParam;
  /** Row label. */
  label: string;
  /** One-line explanation (row title attr). */
  hint: string;
  /** Engine units. */
  min: number;
  max: number;
  /** The rest value — 0 for all four. */
  rest: number;
  /** 0..1 meter fraction for a value (bipolar params center at 0.5). */
  toFrac: (v: number) => number;
  /** Engine value for a 0..1 meter fraction (snapped so drags are stable). */
  fromFrac: (f: number) => number;
  /** Display string for an engine value. */
  format: (v: number) => string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** 1% steps — drags land on readable values. */
const snap = (n: number) => Math.round(n * 100) / 100;

export const FX_SPECS: Record<FxParam, FxSpec> = {
  swing: {
    id: "swing",
    label: "Swing",
    hint: "Delays off-8ths toward the triplet — 0–67% (67 = full triplet).",
    min: 0,
    max: 1,
    rest: 0,
    toFrac: (v) => clamp(v, 0, 1),
    fromFrac: (f) => snap(clamp(f, 0, 1)),
    // Classic swing scale: 0 = straight, 67% = the ⅔-beat triplet position.
    format: (v) => `${Math.round(clamp(v, 0, 1) * 67)}%`,
  },
  humanize: {
    id: "humanize",
    label: "Humanize",
    hint: "Seeded timing + velocity jitter — deterministic per occurrence.",
    min: 0,
    max: 1,
    rest: 0,
    toFrac: (v) => clamp(v, 0, 1),
    fromFrac: (f) => snap(clamp(f, 0, 1)),
    format: (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`,
  },
  quantize: {
    id: "quantize",
    label: "Quantize",
    hint: "Pulls notes onto the 16th grid (strength).",
    min: 0,
    max: 1,
    rest: 0,
    toFrac: (v) => clamp(v, 0, 1),
    fromFrac: (f) => snap(clamp(f, 0, 1)),
    format: (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`,
  },
  velCurve: {
    id: "velCurve",
    label: "Vel curve",
    hint: "Velocity remap — soft (wider ghost/peak spread) → hard (flatter).",
    min: -1,
    max: 1,
    rest: 0,
    toFrac: (v) => (clamp(v, -1, 1) + 1) / 2,
    fromFrac: (f) => snap(clamp(f * 2 - 1, -1, 1)),
    format: (v) => {
      const c = clamp(v, -1, 1);
      if (c === 0) return "linear";
      return c > 0 ? `hard ${Math.round(c * 100)}%` : `soft ${Math.round(-c * 100)}%`;
    },
  },
};

export const FX_PARAMS: FxParam[] = ["swing", "humanize", "quantize", "velCurve"];

/** Trim a fx record to its authored fields — zero/absent fields dropped so
 *  "no effect" never lingers as `{ swing: 0 }`; undefined when empty. */
export function normalizeFx(fx: DrumBlockFx | undefined | null): DrumBlockFx | undefined {
  if (!fx) return undefined;
  const swing = clamp(fx.swing ?? 0, 0, 1);
  const humanize = clamp(fx.humanize ?? 0, 0, 1);
  const quantize = clamp(fx.quantize ?? 0, 0, 1);
  const velCurve = clamp(fx.velCurve ?? 0, -1, 1);
  const out: DrumBlockFx = {};
  if (swing) out.swing = swing;
  if (humanize) out.humanize = humanize;
  if (quantize) out.quantize = quantize;
  if (velCurve) out.velCurve = velCurve;
  return Object.keys(out).length > 0 ? out : undefined;
}
