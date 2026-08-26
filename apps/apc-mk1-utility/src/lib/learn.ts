/**
 * Optional Learn Mode safety net.
 *
 * The default physical map (router.ts's `defaultPhysicalMap()`) is sourced
 * from Ableton's own shipped remote script for this device, so it should be
 * correct out of the box. This module exists only as an escape hatch: if a
 * specific unit's firmware ever disagrees, the user can re-bind a single
 * control at runtime by pressing "Learn" and moving/pressing the physical
 * control, without needing a code change. Overrides persist to
 * localStorage so they survive a page reload.
 */
import type { PhysicalMap } from "./router";

const STORAGE_KEY = "apc-mk1-utility:physical-map-overrides";

export interface PhysicalMapOverrides {
  shift?: number;
  faders?: Partial<Record<number, number>>;
  trackButtons?: Partial<Record<number, number>>;
  sceneButtons?: Partial<Record<number, number>>;
  gridPads?: Partial<Record<number, number>>;
}

export function loadOverrides(): PhysicalMapOverrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PhysicalMapOverrides) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: PhysicalMapOverrides): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Learn Mode is a convenience, not critical — ignore storage failures.
  }
}

export function clearOverrides(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function applyOverrides(base: PhysicalMap, overrides: PhysicalMapOverrides): PhysicalMap {
  const map: PhysicalMap = {
    shift: overrides.shift ?? base.shift,
    faders: [...base.faders],
    trackButtons: [...base.trackButtons],
    sceneButtons: [...base.sceneButtons],
    gridPads: [...base.gridPads],
  };
  for (const [i, v] of Object.entries(overrides.faders ?? {})) {
    if (v !== undefined) map.faders[Number(i)] = v;
  }
  for (const [i, v] of Object.entries(overrides.trackButtons ?? {})) {
    if (v !== undefined) map.trackButtons[Number(i)] = v;
  }
  for (const [i, v] of Object.entries(overrides.sceneButtons ?? {})) {
    if (v !== undefined) map.sceneButtons[Number(i)] = v;
  }
  for (const [i, v] of Object.entries(overrides.gridPads ?? {})) {
    if (v !== undefined) map.gridPads[Number(i)] = v;
  }
  return map;
}

export type LearnTarget =
  | { kind: "shift" }
  | { kind: "fader"; index: number }
  | { kind: "trackButton"; index: number }
  | { kind: "sceneButton"; index: number }
  | { kind: "gridPad"; index: number };

export function learnTargetLabel(target: LearnTarget): string {
  switch (target.kind) {
    case "shift":
      return "Shift";
    case "fader":
      return `Fader ${target.index + 1}`;
    case "trackButton":
      return `Track Button ${target.index + 1}`;
    case "sceneButton":
      return `Scene Button ${target.index + 1}`;
    case "gridPad":
      return `Pad ${target.index + 1}`;
  }
}

/**
 * Capture a raw incoming message for a learn target into an overrides
 * patch, or null if the message type doesn't match what's being learned
 * (e.g. a stray fader nudge while learning a button).
 */
export function captureLearn(
  target: LearnTarget,
  msg: { messageType: "note" | "cc" | "sysex"; number: number },
  overrides: PhysicalMapOverrides,
): PhysicalMapOverrides | null {
  if (target.kind === "fader" && msg.messageType !== "cc") return null;
  if (target.kind !== "fader" && msg.messageType !== "note") return null;

  const next: PhysicalMapOverrides = {
    shift: overrides.shift,
    faders: { ...overrides.faders },
    trackButtons: { ...overrides.trackButtons },
    sceneButtons: { ...overrides.sceneButtons },
    gridPads: { ...overrides.gridPads },
  };
  switch (target.kind) {
    case "shift":
      next.shift = msg.number;
      break;
    case "fader":
      next.faders![target.index] = msg.number;
      break;
    case "trackButton":
      next.trackButtons![target.index] = msg.number;
      break;
    case "sceneButton":
      next.sceneButtons![target.index] = msg.number;
      break;
    case "gridPad":
      next.gridPads![target.index] = msg.number;
      break;
  }
  return next;
}
