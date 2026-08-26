/**
 * Drum-Rack-style grid geometry for the APC mini mk2 8×8 pad grid.
 *
 * The 8×8 grid is split to mirror Ableton's Drum Rack:
 *   - Top 4×8   (rows 0-3, all cols)          = the SELECTED pad's 32-step sequencer
 *                                              (row-major: step = row*8 + col)
 *   - Bottom-left 4×4 (rows 4-7, cols 0-3)    = the 16 drum pads, rack notes 36-51
 *                                              (kick = bottom-left, like the rack)
 *   - Bottom-right 4×4 (rows 4-7, cols 4-7)   = FX pads (toggle/momentary)
 *
 * Each of the 16 drum pads has its own pattern (32 steps) and its own sequence
 * length (1-32, set by shift + last step). Pure — no I/O — so the browser app
 * and the LED renderer share exactly the same math, and it's unit-testable.
 */
import {
  APC_MINI_MK2_PALETTE as P,
  cellLedChannel,
  cellNote,
  type ElementMatrix,
} from "@hardware/controller-bridge";
import type { ClockState } from "./clock.js";
import { DEFAULT_VELOCITY, effectiveVelocity, type StepHit } from "./pattern.js";

export const DRUM_PAD_COUNT = 16;
export const DRUM_GRID_ROWS = 8;
export const DRUM_GRID_COLS = 8;
export const STEPS = 32;
export const RACK_NOTE_BASE = 36; // kick = bottom-left

// ---------------------------------------------------------------------------
// Drum-rack pattern model: 16 pads, each with 32 steps + its own length
// ---------------------------------------------------------------------------

export interface DrumPad {
  /** steps[step] — a hit or null (silent). Index 0-31. */
  steps: (StepHit | null)[];
  /** Sequence length (1-32). Hits at step >= length are silent. */
  length: number;
  /** Per-pad level (0-1) — scales every hit's velocity. Default 1. */
  level: number;
  /** Per-pad mute — silences this pad's hits and preview. */
  muted: boolean;
}

export interface DrumRackPattern {
  pads: DrumPad[];
}

export function createDrumRackPattern(): DrumRackPattern {
  return {
    pads: Array.from({ length: DRUM_PAD_COUNT }, () => ({
      steps: Array<StepHit | null>(STEPS).fill(null),
      length: STEPS,
      level: 1,
      muted: false,
    })),
  };
}

export function padLength(drum: DrumRackPattern, pad: number): number {
  return drum.pads[pad]?.length ?? STEPS;
}

export function setPadLength(drum: DrumRackPattern, pad: number, length: number): DrumRackPattern {
  const l = Math.max(1, Math.min(STEPS, Math.floor(length)));
  if (!drum.pads[pad]) return drum;
  const pads = drum.pads.slice();
  pads[pad] = { ...pads[pad]!, length: l };
  return { ...drum, pads };
}

export function getHit(drum: DrumRackPattern, pad: number, step: number): StepHit | null {
  return drum.pads[pad]?.steps[step] ?? null;
}

// ---------------------------------------------------------------------------
// Per-pad level + mute
// ---------------------------------------------------------------------------

export function padLevel(drum: DrumRackPattern, pad: number): number {
  return drum.pads[pad]?.level ?? 1;
}

export function setPadLevel(drum: DrumRackPattern, pad: number, level: number): DrumRackPattern {
  if (!drum.pads[pad]) return drum;
  const l = Math.max(0, Math.min(1, level));
  const pads = drum.pads.slice();
  pads[pad] = { ...pads[pad]!, level: l };
  return { ...drum, pads };
}

export function padMuted(drum: DrumRackPattern, pad: number): boolean {
  return drum.pads[pad]?.muted ?? false;
}

export function setPadMuted(drum: DrumRackPattern, pad: number, muted: boolean): DrumRackPattern {
  if (!drum.pads[pad]) return drum;
  const pads = drum.pads.slice();
  pads[pad] = { ...pads[pad]!, muted };
  return { ...drum, pads };
}

export function togglePadMuted(drum: DrumRackPattern, pad: number): DrumRackPattern {
  return setPadMuted(drum, pad, !padMuted(drum, pad));
}

/**
 * Toggle a hit on a pad's step; when shift is held, set the pad's sequence
 * length instead (1-based: shift + step 16 = a 16-step loop).
 * Named `toggleDrumStep` to avoid clashing with `pattern.ts`'s `toggleStep`
 * (which operates on the single-voice `StepPattern`).
 */
export function toggleDrumStep(
  drum: DrumRackPattern,
  pad: number,
  step: number,
  shift: boolean,
  velocity: number = DEFAULT_VELOCITY,
): DrumRackPattern {
  if (!drum.pads[pad]) return drum;
  const pads = drum.pads.slice();
  const p = pads[pad]!;
  const steps = p.steps.slice();

  if (shift) {
    pads[pad] = { ...p, length: Math.min(STEPS, Math.max(1, step + 1)) };
    return { ...drum, pads };
  }

  const existing = steps[step];
  steps[step] = existing ? null : { velocity, accent: false };
  pads[pad] = { ...p, steps };
  return { ...drum, pads };
}

export function clearPad(drum: DrumRackPattern, pad: number): DrumRackPattern {
  if (!drum.pads[pad]) return drum;
  const pads = drum.pads.slice();
  pads[pad] = { ...pads[pad]!, steps: Array<StepHit | null>(STEPS).fill(null) };
  return { ...drum, pads };
}

export function randomizePad(
  drum: DrumRackPattern,
  pad: number,
  density: number,
  random: () => number = Math.random,
): DrumRackPattern {
  if (!drum.pads[pad]) return drum;
  const p = drum.pads[pad]!;
  const steps = p.steps.slice();
  for (let s = 0; s < p.length; s++) {
    steps[s] = random() < density ? { velocity: DEFAULT_VELOCITY, accent: random() < 0.2 } : null;
  }
  for (let s = p.length; s < STEPS; s++) steps[s] = null;
  const pads = drum.pads.slice();
  pads[pad] = { ...p, steps };
  return { ...drum, pads };
}

export function hasHits(drum: DrumRackPattern, pad: number): boolean {
  return (drum.pads[pad]?.steps ?? []).some(Boolean);
}

/** The rack MIDI note for a drum-pad index (0-15). Bottom-left (12) = 36. */
export function rackNoteOfPad(pad: number): number {
  return 48 - 4 * Math.floor(pad / 4) + (pad % 4);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type GridRegion = "step" | "drum" | "fx";

export function regionOf(row: number, col: number): GridRegion {
  if (row < 4) return "step";
  if (col < 4) return "drum";
  return "fx";
}

/** Step index (0-31) for a top-grid cell (row 0-3). */
export function stepAt(row: number, col: number): number {
  return row * 8 + col;
}

/** Step number (1-32) for a top-grid cell. */
export function stepNumber(row: number, col: number): number {
  return stepAt(row, col) + 1;
}

/** Drum-pad index (0-15) for a bottom-left cell. */
export function drumPadAt(row: number, col: number): number {
  return (row - 4) * 4 + col;
}

/** Rack note (36-51) for a bottom-left cell. */
export function rackNoteAt(row: number, col: number): number {
  return RACK_NOTE_BASE + (7 - row) * 4 + col;
}

/** FX slot index (0-15) for a bottom-right cell. */
export function fxSlotAt(row: number, col: number): number {
  return (row - 4) * 4 + (col - 4);
}

// ---------------------------------------------------------------------------
// Banks: the 16 drum pads split into two 8-pad banks
// ---------------------------------------------------------------------------

export type DrumBank = "A" | "B";

/** Bank A = the bottom two drum rows (pads 8-15); Bank B = the top two (pads 0-7). */
export const BANK_A_PADS = [12, 13, 14, 15, 8, 9, 10, 11];
export const BANK_B_PADS = [4, 5, 6, 7, 0, 1, 2, 3];

export function bankOfPad(pad: number): DrumBank {
  return pad >= 8 ? "A" : "B";
}

/** The pad index for a bank slot (0-7). Slot 0 = bottom-left of that bank. */
export function bankSlotPad(bank: DrumBank, slot: number): number {
  return (bank === "A" ? BANK_A_PADS : BANK_B_PADS)[Math.max(0, Math.min(7, slot))];
}

/** Which slot (0-7) a pad occupies within its bank. */
export function padBankSlot(pad: number): number {
  const arr = bankOfPad(pad) === "A" ? BANK_A_PADS : BANK_B_PADS;
  const i = arr.indexOf(pad);
  return i === -1 ? 0 : i;
}

/** Hardware pad note (0-63) for any grid cell. */
export function hardwareNoteAt(row: number, col: number): number {
  return row * 8 + col;
}

// ---------------------------------------------------------------------------
// Input → action resolution
// ---------------------------------------------------------------------------

export type FaderMode = "volume" | "device" | "send" | "pan";

export type GridAction =
  | { type: "previewPad"; pad: number; previewNote: number }
  | { type: "selectPad"; pad: number; previewNote: number }
  | { type: "toggleStep"; pad: number; step: number; shift: boolean }
  | { type: "toggleFx"; slot: number }
  | { type: "selectBank"; bank: DrumBank }
  | { type: "setFaderMode"; mode: FaderMode }
  | { type: "toggleLive" }
  | { type: "none" };

/**
 * Resolve a physical pad press into the action it should perform.
 *
 * Drum pads: a plain tap only auditions the sample (preview) and leaves the
 * step editor on the currently selected pad — so auditioning other drums never
 * wipes your step view. SHIFT + tap selects a pad for editing (and previews).
 *
 * FX region (bottom-right 4×4): the first row is the mode panel — Bank A,
 * Bank B, Device, Live — and the remaining 12 cells stay FX toggles.
 */
export function resolvePadPress(
  row: number,
  col: number,
  shiftHeld: boolean,
  selectedPad: number,
): GridAction {
  const region = regionOf(row, col);
  if (region === "drum") {
    const pad = drumPadAt(row, col);
    const previewNote = rackNoteAt(row, col);
    return shiftHeld
      ? { type: "selectPad", pad, previewNote }
      : { type: "previewPad", pad, previewNote };
  }
  if (region === "step") {
    return { type: "toggleStep", pad: selectedPad, step: stepAt(row, col), shift: shiftHeld };
  }
  const slot = fxSlotAt(row, col);
  if (slot === 0) return { type: "selectBank", bank: "A" };
  if (slot === 1) return { type: "selectBank", bank: "B" };
  if (slot === 2) return { type: "setFaderMode", mode: "device" };
  if (slot === 3) return { type: "toggleLive" };
  return { type: "toggleFx", slot };
}

// ---------------------------------------------------------------------------
// LED render
// ---------------------------------------------------------------------------

export interface DrumLedCell {
  row: number;
  col: number;
  note: number;
  ledChannel: number;
  /** Palette color value (sent as note velocity on the LED channel). */
  color: number;
  /** Optional channel override (e.g. pulse channel for the sweeping playhead). */
  channel?: number;
}

export interface DrumLedInput {
  drum: DrumRackPattern;
  selectedPad: number;
  /** FX pad on-states (length 16). */
  fx: boolean[];
  bank?: DrumBank;
  faderMode?: FaderMode;
  liveMode?: boolean;
  /** Advanced mode renders the FX mode row (bank/device/live); Basic shows FX toggles. */
  advanced?: boolean;
  clock?: ClockState;
}

/**
 * Render the 8×8 grid to LED writes for an 8×8 RGB pad matrix. Color language
 * matches the interactive reference: step hits yellow, selected pad ocean,
 * pads with a sequence amber, playhead column green (pulse when empty),
 * firing pad green, muted pad red, FX pads blue, mode row (bank/device/live)
 * green/blue/red when active, loop-end step amber, beyond-length dim.
 */
export function renderDrumRackLeds(
  matrix: ElementMatrix,
  input: DrumLedInput,
): DrumLedCell[] {
  const { drum, selectedPad, fx, bank, faderMode, liveMode, advanced, clock } = input;
  const cells: DrumLedCell[] = [];
  const playing = !!clock?.isPlaying;

  for (let row = 0; row < DRUM_GRID_ROWS; row++) {
    for (let col = 0; col < DRUM_GRID_COLS; col++) {
      const note = cellNote(matrix, row, col);
      const ledChannel = cellLedChannel(matrix, row, col);
      if (note === null) continue;
      const region = regionOf(row, col);

      let color: number;
      let channel: number | undefined;

      if (region === "step") {
        const s = renderStepColor(drum, selectedPad, row, col, playing, clock?.step ?? 0);
        color = s.color;
        channel = s.channel;
      } else if (region === "drum") {
        color = renderDrumColor(drum, selectedPad, row, col, playing, clock?.step ?? 0);
      } else {
        const slot = fxSlotAt(row, col);
        color = renderFxColor(!!advanced, bank ?? "A", faderMode ?? "volume", liveMode ?? false, fx, slot);
      }

      cells.push({ row, col, note, ledChannel, color, channel });
    }
  }
  return cells;
}

function renderStepColor(
  drum: DrumRackPattern,
  selectedPad: number,
  row: number,
  col: number,
  playing: boolean,
  currentStep: number,
): { color: number; channel?: number } {
  const step = stepAt(row, col);
  const len = padLength(drum, selectedPad);
  const hit = getHit(drum, selectedPad, step);
  const within = step < len;
  const isPlayhead = playing && step === currentStep;

  if (isPlayhead && within) {
    if (hit) return { color: P.colors.green.value };
    return { color: P.colors.green.value, channel: P.channels.pulse };
  }
  if (hit && within) return { color: P.colors.yellow.value };
  // Loop-end marker only when the sequence is shortened (< 32) — at the full
  // length the last step must read as OFF, not as a lit marker.
  if (step + 1 === len && !hit && within && len < STEPS) return { color: P.colors.amber.value };
  if (hit) return { color: P.colors.amber.value }; // beyond length → dim amber
  return { color: P.colors.black.value };
}

function isDrumFiring(
  drum: DrumRackPattern,
  row: number,
  col: number,
  playing: boolean,
  currentStep: number,
): boolean {
  if (!playing) return false;
  const pad = drumPadAt(row, col);
  return currentStep < padLength(drum, pad) && !!getHit(drum, pad, currentStep);
}

function renderDrumColor(
  drum: DrumRackPattern,
  selectedPad: number,
  row: number,
  col: number,
  playing: boolean,
  currentStep: number,
): number {
  const pad = drumPadAt(row, col);
  if (isDrumFiring(drum, row, col, playing, currentStep)) return P.colors.green.value;
  // Muted wins over selected so a muted pad is visible red on the controller too.
  if (padMuted(drum, pad)) return P.colors.red.value;
  if (pad === selectedPad) return P.colors.ocean.value;
  if (hasHits(drum, pad)) return P.colors.amber.value;
  return P.colors.black.value;
}

/** FX region color: in Basic mode every cell is an FX toggle; in Advanced mode the
 * first row is the mode panel (bank/device/live) and the rest are FX toggles. */
function renderFxColor(
  advanced: boolean,
  bank: DrumBank,
  faderMode: FaderMode,
  liveMode: boolean,
  fx: boolean[],
  slot: number,
): number {
  if (!advanced) return fx[slot] ? P.colors.blue.value : P.colors.black.value;
  if (slot === 0) return bank === "A" ? P.colors.green.value : P.colors.black.value;
  if (slot === 1) return bank === "B" ? P.colors.green.value : P.colors.black.value;
  if (slot === 2) return faderMode === "device" ? P.colors.blue.value : P.colors.black.value;
  if (slot === 3) return liveMode ? P.colors.red.value : P.colors.black.value;
  return fx[slot] ? P.colors.blue.value : P.colors.black.value;
}

// ---------------------------------------------------------------------------
// Playback triggers: which rack notes fire on a given global step
// ---------------------------------------------------------------------------

export interface DrumRackTrigger {
  /** Rack note (36-51). */
  pitch: number;
  velocity: number;
}

/** Rack notes (with velocities) that fire on `step` across all 16 pads. */
export function drumRackTriggers(drum: DrumRackPattern, step: number): DrumRackTrigger[] {
  const out: DrumRackTrigger[] = [];
  for (let pad = 0; pad < DRUM_PAD_COUNT; pad++) {
    const hit = getHit(drum, pad, step);
    const level = padLevel(drum, pad);
    if (hit && step < padLength(drum, pad) && !padMuted(drum, pad) && level > 0) {
      out.push({
        pitch: rackNoteOfPad(pad),
        velocity: Math.max(1, Math.min(127, Math.round(effectiveVelocity(hit) * level))),
      });
    }
  }
  return out;
}
