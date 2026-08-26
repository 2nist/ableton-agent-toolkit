/**
 * Effects mapping: the 8 faders (CC 48-55) + master fader (CC 56) → effect
 * slots on a Drum Rack / device. Pure state: which fader controls which
 * (track, device, parameter), plus learn-mode bookkeeping.
 *
 * The browser app renders a slot to Live via `/live/midimap/map_cc` (native,
 * hardware latency) or `/live/device/set/parameter/value` (OSC fallback).
 * This module only owns the mapping and the value conversion.
 */
export const FADER_CCS = [48, 49, 50, 51, 52, 53, 54, 55] as const;
export const MASTER_FADER_CC = 56;
export const FADER_COUNT = 8;

/** A minimal description of a discoverable device parameter (from OSC or the SDK probe). */
export interface ParamMeta {
  name: string;
  min: number;
  max: number;
}

export interface EffectSlot {
  /** 0-7 for the faders, 8 for the master fader. */
  fader: number;
  track: number;
  device: number;
  param: number;
  label: string;
  min: number;
  max: number;
}

export interface EffectsState {
  /** slots[0..7] = faders, slots[8] = master fader. */
  slots: (EffectSlot | null)[];
  /** Fader currently being learned (0-8), or null when not in learn mode. */
  learnFader: number | null;
}

export function createEffectsState(): EffectsState {
  return { slots: Array<EffectSlot | null>(FADER_COUNT + 1).fill(null), learnFader: null };
}

export function setSlot(state: EffectsState, fader: number, slot: EffectSlot): EffectsState {
  if (fader < 0 || fader > FADER_COUNT) return state;
  const slots = state.slots.slice();
  slots[fader] = { ...slot, fader };
  return { ...state, slots };
}

export function clearSlot(state: EffectsState, fader: number): EffectsState {
  if (fader < 0 || fader > FADER_COUNT) return state;
  const slots = state.slots.slice();
  slots[fader] = null;
  return { ...state, slots };
}

export function beginLearn(state: EffectsState, fader: number): EffectsState {
  if (fader < 0 || fader > FADER_COUNT) return state;
  return { ...state, learnFader: fader };
}

export function endLearn(state: EffectsState): EffectsState {
  return { ...state, learnFader: null };
}

/** CC number for a fader index (0-7 → 48-55, 8 → 56). */
export function faderIndexToCc(fader: number): number | null {
  if (fader >= 0 && fader < FADER_COUNT) return FADER_CCS[fader]!;
  if (fader === FADER_COUNT) return MASTER_FADER_CC;
  return null;
}

/** Fader index for a CC number, or null. */
export function ccToFaderIndex(cc: number): number | null {
  if (cc >= FADER_CCS[0]! && cc <= FADER_CCS[FADER_COUNT - 1]!) return cc - FADER_CCS[0]!;
  if (cc === MASTER_FADER_CC) return FADER_COUNT;
  return null;
}

/** Map a raw CC value (0-127) into a parameter's numeric range. */
export function ccToParamValue(cc: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(127, cc)) / 127;
  return min + (max - min) * t;
}

/**
 * Remap a raw fader CC (0-127) into 0-1 using a running min/max. Hardware
 * faders often send a narrow range (e.g. ~0-1) — a plain /127 map then only
 * sweeps 1/127th of the destination. Given the observed low/high, this maps
 * the fader's full throw onto 0-1 (identity once the full 0-127 is seen).
 */
export function remapCcToUnit(cc: number, lo: number, hi: number): number {
  const span = Math.max(1, hi - lo);
  return Math.max(0, Math.min(1, (cc - lo) / span));
}

/** Map a parameter value back to a CC value (for LED/meter feedback). */
export function paramValueToCc(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const t = (value - min) / (max - min);
  return Math.round(Math.max(0, Math.min(1, t)) * 127);
}

/**
 * Build the default effect slots from a device's first up-to-8 parameters
 * (typically a Drum Rack's macros). Parameters beyond 8 are skipped; the
 * caller can also pass 9 entries to include a master slot via `masterParam`.
 */
export function slotsFromParameters(
  track: number,
  device: number,
  params: ParamMeta[],
  masterParam?: ParamMeta,
): (EffectSlot | null)[] {
  const slots: (EffectSlot | null)[] = Array<EffectSlot | null>(FADER_COUNT + 1).fill(null);
  for (let i = 0; i < Math.min(FADER_COUNT, params.length); i++) {
    const p = params[i]!;
    slots[i] = { fader: i, track, device, param: i, label: p.name, min: p.min, max: p.max };
  }
  if (masterParam) {
    slots[FADER_COUNT] = {
      fader: FADER_COUNT,
      track,
      device,
      param: Math.min(FADER_COUNT, params.length),
      label: masterParam.name,
      min: masterParam.min,
      max: masterParam.max,
    };
  }
  return slots;
}
