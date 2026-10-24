import { DRUM_LANE_VOICES, type DrumLaneId } from "./blocks.js";

/** The six surface lanes, in the order the timeline stages them. */
export const DRUM_LANE_IDS: readonly DrumLaneId[] = ["kick", "snare", "rim", "hat", "cym", "tom"];

/**
 * Which lanes actually sound, given a section's mute/solo — the ONE
 * definition. The drum planner filters notes with it, the app's canvas dims
 * with it, and the CC stream skips with it, so a muted lane can't be silent
 * in one place and audible in another.
 *
 * Any solo ⇒ only soloed lanes; a muted lane stays silent even when soloed.
 */
export function audibleLanes(
  mute?: readonly DrumLaneId[],
  solo?: readonly DrumLaneId[],
): Set<DrumLaneId> {
  const all = DRUM_LANE_IDS.filter((lane) => DRUM_LANE_VOICES[lane] !== undefined);
  const muted = new Set(mute ?? []);
  const soloed = new Set(solo ?? []);
  if (soloed.size === 0) return new Set(all.filter((lane) => !muted.has(lane)));
  return new Set(all.filter((lane) => soloed.has(lane) && !muted.has(lane)));
}
