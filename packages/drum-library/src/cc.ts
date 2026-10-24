import type { DrumLaneId } from "./blocks.js";
import { audibleLanes } from "./lanes.js";

/**
 * PER-LANE MIDI CC — the automation a drum surface needs but notes can't
 * carry: hat openness (CC4 on some racks), filter cutoff (CC74), expression
 * (CC11), the device's own macros.
 *
 * One controller per surface lane per section, ramped from `from` to `to`
 * across the section. Pure and deterministic: same section in, same message
 * list out, so the .mid and the live MIDI out can't disagree.
 *
 * The Ableton Extensions SDK has no clip-envelope API, so this does not reach
 * "Send to Ableton" clips — documented in the schema field.
 */

export interface LaneCcSpec {
  /** Controller number, 0..127. */
  cc: number;
  /** Value at the section's start, 0..127. */
  from: number;
  /** Value at the section's end, 0..127. */
  to: number;
}

export interface LaneCcEvent {
  /** Section-relative beat. */
  beat: number;
  cc: number;
  value: number;
  lane: DrumLaneId;
}

const clamp7 = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface PlanLaneCcInput {
  durationBeats: number;
  beatsPerBar: number;
  perLane?: Partial<Record<DrumLaneId, LaneCcSpec>> | null;
  /** Muted / soloed lanes — same rule as the notes (`audibleLanes`). */
  mute?: readonly DrumLaneId[];
  solo?: readonly DrumLaneId[];
  /** Messages per bar: 1 (default) = a value per bar; 4 = one per beat. */
  perBar?: number;
}

/**
 * The section's CC stream. A static value (`from === to`) emits ONE message
 * at the section's start — a device setting, not a ramp. A ramp emits
 * `perBar` messages per bar, inclusive of both ends.
 */
export function planLaneCc(input: PlanLaneCcInput): LaneCcEvent[] {
  const lanes = Object.keys(input.perLane ?? {}) as DrumLaneId[];
  if (lanes.length === 0) return [];
  const audible = audibleLanes(input.mute, input.solo);
  const perBar = Math.max(1, Math.round(input.perBar ?? 1));
  const step = input.beatsPerBar / perBar;
  const out: LaneCcEvent[] = [];

  for (const lane of lanes) {
    const spec = input.perLane?.[lane];
    if (!spec || !audible.has(lane)) continue;
    const cc = clamp7(spec.cc);
    const from = clamp7(spec.from);
    const to = clamp7(spec.to);
    if (from === to) {
      out.push({ beat: 0, cc, value: from, lane });
      continue;
    }
    const steps = Math.max(1, Math.floor(input.durationBeats / step + 1e-9));
    for (let i = 0; i <= steps; i++) {
      const beat = i * step;
      if (beat > input.durationBeats + 1e-9) break;
      const frac = input.durationBeats > 0 ? Math.min(1, beat / input.durationBeats) : 1;
      out.push({ beat: round4(beat), cc, value: clamp7(from + (to - from) * frac), lane });
    }
  }
  return out.sort((a, b) => a.beat - b.beat || a.lane.localeCompare(b.lane));
}
