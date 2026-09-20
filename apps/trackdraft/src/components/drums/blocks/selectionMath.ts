import { motionModelFor, type DrumLaneId } from "@drum/library";
import { TOP_PAD, TRACK_H } from "../../../lib/timeline/beatMap";
import type { DrumBlock, DrumBlockFx } from "../../../types/blueprint";
import { normalizeFx } from "./fxParams";

/**
 * Geometry + gesture math shared by the Drum Blocks view, its docked XY pad
 * and the exploded selection editor — one place for how a ring drag maps to
 * euclid values, how the step-value boxes are laid out, how a motion vector
 * reads as a gesture name, and how the RANGE FX family (swing / humanize /
 * quantize / velCurve) is written onto — and kept alive across — the
 * selection's blocks. Keeping it here means the compact pad and the big
 * modal display can never disagree.
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

// ---------------------------------------------------------------------------
// Range FX — the DrumBlockFx family (swing / humanize / quantize / velCurve)
// ---------------------------------------------------------------------------

/** Tolerance for "exactly this range" matches — ids are built from these
 *  numbers, so the writers' own rounding is the only source of drift. */
const RANGE_EPS = 1e-6;

/** True when a block covers exactly this range — the identity every
 *  selection writer upserts by (the range IS the block's key). */
export function isExactRange(b: DrumBlock, startBeat: number, endBeat: number): boolean {
  return Math.abs(b.startBeat - startBeat) < RANGE_EPS && Math.abs(b.endBeat - endBeat) < RANGE_EPS;
}

/** The range FX in effect for a lane — carried by any exact-range block
 *  (a mode block with `fx` merged on, or an `inherit` carrier). */
export function fxForRange(
  blocks: readonly DrumBlock[] | undefined,
  lane: DrumLaneId,
  startBeat: number,
  endBeat: number,
): DrumBlockFx | undefined {
  for (const b of blocks ?? []) {
    if (b.lane !== lane || !isExactRange(b, startBeat, endBeat)) continue;
    const fx = normalizeFx(b.fx);
    if (fx) return fx;
  }
  return undefined;
}

/** The first selected lane that has range FX — what the sliders seed from
 *  (same convention as `existingEuclid`'s first-lane lookup). */
export function fxForLanes(
  blocks: readonly DrumBlock[] | undefined,
  lanes: readonly DrumLaneId[],
  startBeat: number,
  endBeat: number,
): DrumBlockFx | undefined {
  for (const lane of lanes) {
    const fx = fxForRange(blocks, lane, startBeat, endBeat);
    if (fx) return fx;
  }
  return undefined;
}

/** Drop exact-range `inherit` CARRIERS for these lanes — called when a mode
 *  write adopts their fx into the new blocks (or when fx is cleared). */
export function stripFxCarriers(
  blocks: readonly DrumBlock[] | undefined,
  lanes: readonly DrumLaneId[],
  startBeat: number,
  endBeat: number,
): DrumBlock[] {
  const laneSet = new Set(lanes);
  return (blocks ?? []).filter(
    (b) => !(b.mode === "inherit" && laneSet.has(b.lane) && isExactRange(b, startBeat, endBeat)),
  );
}

/** A MODE write (euclid ring / motion pad / step flatten) that keeps range
 *  FX alive: each touched lane's fx (from any exact-range block — including
 *  an `inherit` carrier) is adopted onto the new blocks, and the carriers
 *  it absorbed are dropped so the fx can never apply twice. */
export function upsertModeBlocks(
  blocks: DrumBlock[] | undefined,
  startBeat: number,
  endBeat: number,
  changes: DrumBlock[],
): DrumBlock[] {
  const adopted = changes.map((c) => {
    const fx = fxForRange(blocks, c.lane, startBeat, endBeat);
    return fx ? { ...c, fx } : c;
  });
  return upsertBlocks(
    stripFxCarriers(blocks, changes.map((c) => c.lane), startBeat, endBeat),
    adopted,
  );
}

/** Strip a block's fx field (immutably). */
function withoutFx(b: DrumBlock): DrumBlock {
  if (!b.fx) return b;
  const copy = { ...b };
  delete copy.fx;
  return copy;
}

/**
 * The RANGE FX write — swing / humanize / quantize / velCurve for every
 * selected lane over the exact selection range:
 *  - a lane WITH an exact-range block gets the fx ON that block, so a later
 *    euclid/motion/step rewrite adopts it back (and motion's bake applies it
 *    to the gesture it synthesizes);
 *  - a lane with nothing there gets an `inherit` CARRIER — the compiler's
 *    inherit semantics apply the fx to the base groove's notes in range;
 *  - clearing (all-zero fx) strips the field and drops the carrier, so
 *    "no effect" leaves no orphan blocks behind.
 *
 * Blocks overlapping the range without matching it exactly are untouched —
 * the same exact-range identity every selection writer upserts by. */
export function fxBlocksFor(
  blocks: readonly DrumBlock[] | undefined,
  lanes: readonly DrumLaneId[],
  startBeat: number,
  endBeat: number,
  fxIn: DrumBlockFx,
): DrumBlock[] {
  const fx = normalizeFx(fxIn);
  const laneSet = new Set(lanes);
  const out: DrumBlock[] = [];
  const covered = new Set<string>();
  for (const b of blocks ?? []) {
    if (!laneSet.has(b.lane) || !isExactRange(b, startBeat, endBeat)) {
      out.push(b);
      continue;
    }
    if (b.mode === "inherit") continue; // carriers are rebuilt below
    out.push(fx ? { ...b, fx } : withoutFx(b));
    covered.add(b.lane);
  }
  if (fx) {
    for (const lane of lanes) {
      if (covered.has(lane)) continue;
      out.push({
        id: `blk-${lane}-${startBeat}-${endBeat}-fx`,
        lane,
        startBeat,
        endBeat,
        mode: "inherit",
        fx,
      });
    }
  }
  return out;
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
