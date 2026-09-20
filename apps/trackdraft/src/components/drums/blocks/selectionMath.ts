import { motionModelFor, type DrumLaneId } from "@drum/library";
import { TOP_PAD, TRACK_H } from "../../../lib/timeline/beatMap";
import type { DrumBlock } from "../../../types/blueprint";

/**
 * Geometry + gesture math shared by the Drum Blocks view, its docked XY pad
 * and the exploded selection editor — one place for how a ring drag maps to
 * euclid values, how the step-value boxes are laid out, and how a motion
 * vector reads as a gesture name. Keeping it here means the compact pad and
 * the big modal display can never disagree.
 */

/** Air between the top of a lane and its cell row. */
export const CELL_TOP_PAD = 2;

/** Upsert blocks by id — deterministic ids make repeated gestures over the
 *  same range rewrite the same block instead of piling up duplicates. */
export function upsertBlocks(blocks: DrumBlock[] | undefined, changes: DrumBlock[]): DrumBlock[] {
  const byId = new Map((blocks ?? []).map((b) => [b.id, b]));
  for (const c of changes) byId.set(c.id, c);
  return [...byId.values()];
}

/** The euclid blocks a ring gesture writes: one per selected lane, linked
 *  as an interleave cluster when more than one lane moves together. */
export function euclidBlocksFor(
  lanes: DrumLaneId[], startBeat: number, endBeat: number, k: number, n: number, rotation: number,
): DrumBlock[] {
  const group = lanes.length > 1;
  return lanes.map((laneKey) => ({
    id: `blk-${laneKey}-${startBeat}-${endBeat}-euclid`,
    lane: laneKey,
    groupId: group ? `grp-${startBeat}-${endBeat}` : undefined,
    interleave: group || undefined,
    startBeat,
    endBeat,
    mode: "euclid" as const,
    euclid: { k, n, rotation },
  }));
}

/** The motion block a gesture writes (first selected lane). */
export function motionBlockFor(
  lane: DrumLaneId, startBeat: number, endBeat: number, x: number, y: number,
): DrumBlock {
  return {
    id: `blk-${lane}-${startBeat}-${endBeat}-motion`,
    lane,
    startBeat,
    endBeat,
    mode: "motion",
    motion: { x, y },
  };
}

/** Human name + intensity for a motion vector (pad + modal readout). */
export function motionLabelFor(v: { x: number; y: number }): string | null {
  const pick = motionModelFor(v);
  if (!pick) return null;
  const mag = Math.round(Math.min(1, Math.hypot(v.x, v.y)) * 100);
  switch (pick.model) {
    case "buildUp": return `${v.x < 0 ? "CRESCENDO" : "BUILD"} · ${mag}%`;
    case "dropOut": return `BREAK · ${mag}%`;
    case "breakDown": return `THIN · ${mag}%`;
    case "cut": return `CUT · ${mag}%`;
  }
}

export interface BoxMetrics {
  /** Top edge of the value box row (svg y). */
  top: number;
  bottom: number;
  h: number;
  w: number;
  /** Mono font size for the number inside. */
  font: number;
}

/**
 * The step-value box under a lane's cell row: a uniform little slot per
 * step that shows the step's velocity. Returns null when the grid is too
 * tight to draw meaningful boxes (low zoom) — the cells carry it then.
 */
export function boxMetrics(laneIdx: number, r: number, spacing: number): BoxMetrics | null {
  const w = Math.min(spacing - 2.5, 30);
  if (w < 6) return null;
  const laneTop = TOP_PAD + laneIdx * TRACK_H;
  const top = laneTop + CELL_TOP_PAD + 2 * r + 3;
  const bottom = laneTop + TRACK_H - 4;
  const h = bottom - top;
  if (h < 8) return null;
  return { top, bottom, h, w, font: Math.max(6.5, Math.min(w * 0.42, 10)) };
}

/** The euclid handle's position on a ring of radius R — angle = rotation,
 *  distance grows from `base` (k=1) out to R (k=n). Used by the docked pad
 *  and, with a much longer arm, by the modal display. */
export function ringHand(
  k: number, n: number, rotation: number, R: number, base = 26,
): { x: number; y: number; dist: number } {
  const nn = Math.max(1, n);
  const dist = base + (Math.min(k, nn) / nn) * (R - base);
  const a = -Math.PI / 2 + (rotation / nn) * 2 * Math.PI;
  return { x: Math.cos(a) * dist, y: Math.sin(a) * dist, dist };
}

/** Inverse of `ringHand`: a pointer offset from the ring center maps to
 *  quantized euclid values. Angle drives rotation (top = 0, clockwise),
 *  distance drives density. */
export function euclidFromRing(
  dx: number, dy: number, n: number, R: number, base = 26,
): { k: number; rotation: number } {
  const nn = Math.max(1, n);
  const angle = Math.atan2(dy, dx) + Math.PI / 2; // 0 at 12 o'clock, cw
  const rotation = ((Math.round((angle / (2 * Math.PI)) * nn) % nn) + nn) % nn;
  const dist = Math.hypot(dx, dy);
  const span = Math.max(1, R - base);
  const k = Math.max(1, Math.min(nn, Math.round(((dist - base) / span) * nn)));
  return { k, rotation };
}

/** A uniform velocity delta applied to the loudest hit on each affected
 *  step — the range-scrub write. `hits` is a press-time snapshot so
 *  repeated drag moves never compound. */
export interface VelocityScrubTarget {
  laneKey: string;
  /** Block range the scrub writes to (beats). */
  start: number;
  end: number;
  /** Baseline hits in [start,end) — the block's note content. */
  hits: { beat: number; velocity: number; voice: string }[];
  /** The loudest hit on each step that has one — the ones that move. */
  peaks: { beat: number; voice: string; velocity: number }[];
  /** The pressed step's peak velocity (drag origin). */
  base: number;
}

export function scrubbedNotes(s: VelocityScrubTarget, value: number): { beat: number; voice: string; velocity: number }[] {
  const delta = value - s.base;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  return s.hits.map((h) => {
    const peak = s.peaks.find((p) => Math.abs(p.beat - h.beat) < 1e-6 && p.voice === h.voice);
    return {
      beat: round4(h.beat - s.start),
      voice: h.voice,
      velocity: peak ? Math.max(1, Math.min(127, Math.round(peak.velocity + delta))) : h.velocity,
    };
  });
}
