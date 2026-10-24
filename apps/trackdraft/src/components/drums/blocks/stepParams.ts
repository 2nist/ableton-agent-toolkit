import { DRUM_LANE_VOICES, type DrumLaneId, type KitVoice } from "@drum/library";
import type { DrumBlockNote } from "../../../types/blueprint";
import { VOICE_LABEL } from "../voiceStyle";

/**
 * The STEP PARAMETERS — what the value-box row under each drum can show and
 * edit: velocity · nudge · probability · ratchet · flam. One table here so
 * the boxes, the drag readout and the marks under the cells all speak the
 * same units, and so the labels always match what the compiler bakes
 * (`@drum/library/src/blocks.ts`: prob 0..1, ratchet 1..4, flam flag,
 * offsetBeats in beats).
 *
 * GATE was removed on 2026-10-23: `durBeats` is a MIDI note LENGTH, and a
 * one-shot drum sample ignores it — it was the one param you could set and
 * hear nothing. The schema field stays (imported/Ableton-authored blocks
 * still carry it, the compiler still honours it, and a cell that has one
 * still shows the gate rule); it just isn't offered as a step control.
 */

export type StepParam = "vel" | "nudge" | "prob" | "ratchet" | "flam" | "voice";

/** The kit voices a lane can pick from — the lane's own family, so a HAT cell
 *  can be an open or pedal hat but never a kick. */
export function laneVoices(lane: DrumLaneId): KitVoice[] {
  return DRUM_LANE_VOICES[lane] ?? [];
}

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
  /** Internal value from an authored note — undefined when not authored.
   *  `lane` is only meaningful for VOICE (the choice is the lane's family). */
  read: (n: DrumBlockNote, grid: number, lane?: DrumLaneId) => number | undefined;
  /** Write an internal value into a draft note. */
  write: (n: ParamDraftNote, v: number, grid: number, lane?: DrumLaneId) => void;
  /** Human-readable display of an internal value. */
  format: (v: number, grid: number, lane?: DrumLaneId) => string;
  /** Per-lane cycle (VOICE); static `cycle` covers everything else. */
  cycleFor?: (lane?: DrumLaneId) => number[];
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
  voice: {
    id: "voice",
    label: "Voice",
    short: "VOICE",
    kind: "discrete",
    min: 0,
    max: 3,
    perPx: 0.03,
    rest: 0,
    // the value is an INDEX into the lane's voice list, so it carries no
    // meaning without the lane — `lane` is therefore required in practice
    read: (n, _grid, lane) => {
      if (!lane) return undefined;
      const i = laneVoices(lane).indexOf(n.voice as KitVoice);
      return i < 0 ? undefined : i;
    },
    write: (n, v, _grid, lane) => {
      if (!lane) return;
      const list = laneVoices(lane);
      if (list.length === 0) return;
      const i = Math.max(0, Math.min(list.length - 1, Math.round(v)));
      n.voice = list[i];
    },
    format: (v, _grid, lane) => {
      if (!lane) return "";
      const voice = laneVoices(lane)[Math.max(0, Math.round(v))];
      return voice ? VOICE_LABEL[voice] ?? String(voice) : "";
    },
    cycleFor: (lane) => (lane ? laneVoices(lane).map((_, i) => i) : [0]),
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

export const STEP_PARAMS: StepParam[] = ["vel", "nudge", "prob", "ratchet", "flam", "voice"];

/** A persisted chip selection is untrusted (it outlives the table): anything
 *  that is no longer a step param — including the retired "gate" — reads as
 *  VEL instead of crashing the lane. */
export function asStepParam(v: unknown): StepParam {
  return typeof v === "string" && (STEP_PARAMS as readonly string[]).includes(v) ? (v as StepParam) : "vel";
}

/** The next value a CLICK on a box cycles to (discrete params). */
export function cycleValue(spec: ParamSpec, current: number, lane?: DrumLaneId): number {
  const cyc = spec.cycleFor?.(lane) ?? spec.cycle ?? [spec.rest];
  const i = cyc.findIndex((v) => Math.abs(v - current) < 1e-9);
  return cyc[(i + 1) % cyc.length];
}

/** Clamp an internal value into the spec's range. */
export function clampParam(spec: ParamSpec, v: number): number {
  return clampN(v, spec.min, spec.max);
}
