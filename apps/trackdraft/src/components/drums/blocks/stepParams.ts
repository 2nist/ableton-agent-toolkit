import type { DrumBlockNote } from "../../../types/blueprint";

/**
 * The STEP PARAMETERS — what the value-box row under each drum can show and
 * edit: velocity · nudge · gate · probability · ratchet · flam. One table
 * here so the boxes, the drag readout and (next) the Step FX cards all speak
 * the same units, and so the labels always match what the compiler bakes
 * (`@drum/library/src/blocks.ts`: prob 0..1, ratchet 1..4, flam flag,
 * offsetBeats/durBeats in beats).
 */

export type StepParam = "vel" | "nudge" | "gate" | "prob" | "ratchet" | "flam";

/** A note draft the params write into — the DrumBlockNote fields we edit. */
export interface ParamDraftNote {
  beat: number;
  voice: string;
  velocity: number;
  offsetBeats?: number;
  durBeats?: number;
  prob?: number;
  ratchet?: number;
  flam?: boolean;
}

export interface ParamSpec {
  id: StepParam;
  /** Dropdown label. */
  label: string;
  /** Gutter chip + drag readout short name. */
  short: string;
  kind: "continuous" | "discrete";
  /** Internal (schema) units. */
  min: number;
  max: number;
  /** Discrete params only: the values a CLICK cycles through. */
  cycle?: number[];
  /** Internal units changed per drag pixel. */
  perPx: number;
  /** The rest value when nothing is authored (shown dim on hits). */
  rest: number;
  /** Internal value from an authored note — undefined when not authored. */
  read: (n: DrumBlockNote, grid: number) => number | undefined;
  /** Write an internal value into a draft note. */
  write: (n: ParamDraftNote, v: number, grid: number) => void;
  /** Human-readable display of an internal value. */
  format: (v: number, grid: number) => string;
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** 1/32-beat ticks — the nudge display unit (readable integers). */
const NUDGE_TICKS = 32;

export const PARAM_SPECS: Record<StepParam, ParamSpec> = {
  vel: {
    id: "vel",
    label: "Velocity",
    short: "VEL",
    kind: "continuous",
    min: 1,
    max: 127,
    perPx: 1.2,
    rest: 100,
    read: (n) => n.velocity,
    write: (n, v) => { n.velocity = Math.round(clampN(v, 1, 127)); },
    format: (v) => String(Math.round(v)),
  },
  nudge: {
    id: "nudge",
    label: "Nudge",
    short: "NUDGE",
    kind: "continuous",
    min: -0.5,
    max: 0.5,
    perPx: 0.005,
    rest: 0,
    read: (n) => (n.offsetBeats !== undefined ? n.offsetBeats : undefined),
    write: (n, v) => { n.offsetBeats = Math.round(v * NUDGE_TICKS) / NUDGE_TICKS; },
    format: (v) => {
      const t = Math.round(v * NUDGE_TICKS);
      return t > 0 ? `+${t}` : String(t);
    },
  },
  gate: {
    id: "gate",
    label: "Gate",
    short: "GATE",
    kind: "continuous",
    min: 10,
    max: 400,
    perPx: 1.5,
    rest: 100,
    // durBeats is absolute; the boxes speak percent of the step grid.
    read: (n, grid) => (n.durBeats !== undefined && grid > 0 ? (n.durBeats / grid) * 100 : undefined),
    write: (n, v, grid) => { n.durBeats = Math.max(0.02, (clampN(v, 10, 400) / 100) * grid); },
    format: (v) => `${Math.round(v)}%`,
  },
  prob: {
    id: "prob",
    label: "Probability",
    short: "PROB",
    kind: "continuous",
    min: 0,
    max: 1,
    perPx: 0.01,
    rest: 1,
    read: (n) => (n.prob !== undefined ? n.prob : undefined),
    write: (n, v) => { n.prob = clampN(v, 0, 1); },
    format: (v) => `${Math.round(v * 100)}%`,
  },
  ratchet: {
    id: "ratchet",
    label: "Ratchet",
    short: "RATCH",
    kind: "discrete",
    min: 1,
    max: 4,
    cycle: [1, 2, 3, 4],
    perPx: 0.02,
    rest: 1,
    read: (n) => (n.ratchet !== undefined ? n.ratchet : undefined),
    write: (n, v) => { n.ratchet = Math.round(clampN(v, 1, 4)); },
    format: (v) => `×${Math.round(v)}`,
  },
  flam: {
    id: "flam",
    label: "Flam",
    short: "FLAM",
    kind: "discrete",
    min: 0,
    max: 1,
    cycle: [0, 1],
    perPx: 0.03,
    rest: 0,
    read: (n) => (n.flam ? 1 : undefined),
    write: (n, v) => { n.flam = v >= 0.5; },
    format: (v) => (v >= 0.5 ? "F" : "–"),
  },
};

export const STEP_PARAMS: StepParam[] = ["vel", "nudge", "gate", "prob", "ratchet", "flam"];

/** The next value a CLICK on a box cycles to (discrete params). */
export function cycleValue(spec: ParamSpec, current: number): number {
  const cyc = spec.cycle ?? [spec.rest];
  const i = cyc.findIndex((v) => Math.abs(v - current) < 1e-9);
  return cyc[(i + 1) % cyc.length];
}

/** Clamp an internal value into the spec's range. */
export function clampParam(spec: ParamSpec, v: number): number {
  return clampN(v, spec.min, spec.max);
}
