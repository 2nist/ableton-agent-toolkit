/**
 * Depth (Z = time) projection for the honeycomb wheel.
 *
 * The wheel's XY plane is a scale-degree lattice; a progression drawn on it
 * has to reuse cells whenever it returns to a degree, which is why repeated
 * chords reported as "×2" instead of moving, and why a run doubles back on
 * itself. Giving each step a depth — its position in the sequence — and
 * shearing the projection by that depth fixes both at once:
 *
 *   x' = hexX(q, r) + z·dx
 *   y' = hexY(q, r) + z·dy
 *
 * Every step now has a unique screen position (z increases by one each step,
 * and the shear vector is deliberately NOT a lattice direction, so a step in
 * time can never be exactly cancelled by a step in the lattice), and the path
 * is monotone along the depth axis — it reads as a ribbon that always
 * advances. Repeats become the next hex deeper; a run becomes a slope; a
 * modulation is a lattice step taken at a new depth.
 */

import { hexToPixel, type Vec2 } from "./honeycombWalk";

export interface DepthShear {
  /** Pixels of x per step (positive: the ribbon leans right). */
  dx: number;
  /** Pixels of y per step (negative: the ribbon rises as it recedes). */
  dy: number;
}

/**
 * One hex diameter per step, at 30° above horizontal — deliberately NOT a
 * lattice direction (the lattice's six axes sit at 0°/60°/120°…), so a step
 * in time can never be exactly cancelled by a step in the lattice. At this
 * size the ribbon visibly advances instead of bunching up.
 */
export const DEFAULT_SHEAR: DepthShear = { dx: 52, dy: -30 };

/**
 * Depth mode draws smaller hexes than the flat lattice: the lattice spacing
 * shrinks with the cell size, so the ribbon stays compact enough to read while
 * the shear (which is in absolute pixels) keeps consecutive steps apart.
 */
export const DEPTH_CELL_SCALE = 0.6;

/** Project a lattice cell at sequence depth `z` into screen space. */
export function projectDepth(
  q: number,
  r: number,
  z: number,
  size: number,
  shear: DepthShear = DEFAULT_SHEAR,
): Vec2 {
  const base = hexToPixel(q, r, size);
  return { x: base.x + z * shear.dx, y: base.y + z * shear.dy };
}

/** Oldest step's opacity — enough to read the path, faint enough to recede. */
export const MIN_DEPTH_OPACITY = 0.35;
/** A progression this short is drawn at full strength: nothing is "history" yet. */
export const FULL_STRENGTH_STEPS = 8;

/**
 * Opacity ramp: the newest step is fully lit and older steps fade linearly to
 * `MIN_DEPTH_OPACITY`, so a long progression reads as receding into history
 * rather than as a tangle of overlapping hexes. Short progressions don't fade
 * at all — a four-chord line shouldn't look like a relic.
 */
export function depthOpacity(index: number, total: number): number {
  if (total <= FULL_STRENGTH_STEPS) return 1;
  const t = Math.min(1, Math.max(0, index / (total - 1)));
  return MIN_DEPTH_OPACITY + (1 - MIN_DEPTH_OPACITY) * t;
}

/**
 * True when the shear stays out of every lattice direction it could be
 * cancelled by — the guarantee that distinct (q, r, z) triples never collide
 * on screen. Checked in the tests; exported so callers swapping in a custom
 * shear can assert the same thing.
 */
export function shearIsSafe(
  shear: DepthShear,
  size: number,
  reach: { lattice: number; depth: number } = { lattice: 8, depth: 64 },
): boolean {
  const seen = new Set<string>();
  for (let z = 0; z <= reach.depth; z += 1) {
    for (let a = -reach.lattice; a <= reach.lattice; a += 1) {
      for (let b = -reach.lattice; b <= reach.lattice; b += 1) {
        const point = projectDepth(a, b, z, size, shear);
        const key = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
    }
  }
  return true;
}
