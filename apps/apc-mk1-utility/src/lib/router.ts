/**
 * Physical-control resolution for the APC mini mk1.
 *
 * Turns raw incoming MIDI bytes into a named physical event (which fader,
 * which button, pressed or released) against the real hardware note/CC
 * numbers. What happens *after* a control is resolved lives elsewhere:
 * originally this fed a MIDI CC-router for Ableton's native MIDI Map Mode,
 * but that turned out not to reach Live 12's Clip View Pitch/Time/
 * Transform/Generate tools (not standard MIDI-mappable widgets) — those are
 * now driven directly via AbletonOSC (see clipEdit.ts/store.ts). The bank
 * concept survives the pivot: it still groups the 8 faders into named
 * parameter sets, just for real transform functions instead of arbitrary
 * output CCs.
 *
 * Pure logic only — no MIDI I/O here (see midi.ts/hub.ts for that).
 */
import { APC_MINI_MK1 } from "@hardware/controller-bridge";
import type { ParsedMidi } from "@hardware/controller-bridge";

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------

export const BANKS = ["pitch", "time", "transform", "generate", "clip_tools"] as const;
export type BankName = (typeof BANKS)[number];

export const BANK_LABELS: Record<BankName, string> = {
  pitch: "Pitch",
  time: "Time",
  transform: "Transform",
  generate: "Generate",
  clip_tools: "Clip Tools",
};

export function bankIndex(bank: BankName): number {
  return BANKS.indexOf(bank);
}

// ---------------------------------------------------------------------------
// Physical control layout
// ---------------------------------------------------------------------------

/**
 * The mk1's physical note/CC assignments. Seeded from the real hardware
 * values in `@hardware/controller-bridge`'s `APC_MINI_MK1` (sourced from
 * Ableton's own shipped remote script — see that file's header), but kept
 * as a separate, mutable structure here because individual controls can be
 * re-bound at runtime via Learn Mode (see learn.ts) if a specific unit ever
 * disagrees with the shipped values.
 */
export interface PhysicalMap {
  shift: number;
  /** CC numbers, index 0-7. */
  faders: number[];
  /** Note numbers, index 0-7 (bank-select buttons live on indices 0-4). */
  trackButtons: number[];
  /** Note numbers, index 0-7. */
  sceneButtons: number[];
  /** Note numbers, index 0-63 (flattened row-major, matching the real hardware's own numbering). */
  gridPads: number[];
}

export function defaultPhysicalMap(): PhysicalMap {
  const faders = APC_MINI_MK1.matrices.faders?.identifiers[0];
  const trackButtons = APC_MINI_MK1.matrices.track_buttons?.identifiers[0];
  const sceneButtons = APC_MINI_MK1.matrices.scene_launch_buttons?.identifiers[0];
  const gridRows = APC_MINI_MK1.matrices.clip_launch_buttons?.identifiers;
  if (!faders || !trackButtons || !sceneButtons || !gridRows) {
    throw new Error("APC_MINI_MK1 element definitions are missing an expected matrix");
  }
  return {
    shift: APC_MINI_MK1.controls.shift_button!.midi,
    faders: [...faders],
    trackButtons: [...trackButtons],
    sceneButtons: [...sceneButtons],
    gridPads: gridRows.flat(),
  };
}

// ---------------------------------------------------------------------------
// Incoming resolution: raw MIDI -> physical control
// ---------------------------------------------------------------------------

export type PhysicalEvent =
  | { kind: "shift"; pressed: boolean }
  | { kind: "fader"; index: number; value: number }
  | { kind: "bankSelect"; index: number; pressed: boolean }
  | { kind: "sceneButton"; index: number; pressed: boolean }
  | { kind: "gridPad"; index: number; pressed: boolean };

/** Resolve a parsed incoming MIDI message against the current physical map. */
export function resolvePhysical(msg: ParsedMidi, map: PhysicalMap): PhysicalEvent | null {
  if (msg.messageType === "note" && msg.number === map.shift) {
    return { kind: "shift", pressed: msg.value > 0 };
  }
  if (msg.messageType === "cc") {
    const index = map.faders.indexOf(msg.number);
    if (index >= 0) return { kind: "fader", index, value: msg.value };
    return null;
  }
  if (msg.messageType === "note") {
    const trackIndex = map.trackButtons.indexOf(msg.number);
    if (trackIndex >= 0) return { kind: "bankSelect", index: trackIndex, pressed: msg.value > 0 };
    const sceneIndex = map.sceneButtons.indexOf(msg.number);
    if (sceneIndex >= 0) return { kind: "sceneButton", index: sceneIndex, pressed: msg.value > 0 };
    const gridIndex = map.gridPads.indexOf(msg.number);
    if (gridIndex >= 0) return { kind: "gridPad", index: gridIndex, pressed: msg.value > 0 };
  }
  return null;
}
