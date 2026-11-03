import type { PolyRect } from "./camera";

/**
 * The Stage plane's first real field: where a section sits when you lift it
 * off the spine.
 *
 * The law from the plan holds exactly here — *Stage never changes Score*. A
 * placement is an offset in canvas units stored beside the song, never in it.
 * Playback, export and the Ableton bridge cannot see it: a placed section
 * still plays in its sequenced position, it just is not drawn there. That is
 * the whole point of the experiment: position stops being duration, and the
 * way home is one key.
 */

export interface PolyPlacement {
  /** World units from the section's home column. */
  dx: number;
  dy: number;
}

export type Placements = Record<string, PolyPlacement>;

/** Placement grid, in world units — roughly a bar's sixteenth, so a hand-
 *  placed section still lands somewhere tidy. */
export const PLACEMENT_SNAP = 12;

/** A drag shorter than this is not a placement, it is a wobble. */
export const PLACEMENT_THRESHOLD = 16;

/**
 * Which way a section may be lifted.
 *
 * Downward only. The lanes fill the canvas's vertical space, so a lift upward
 * puts the band (and its frame's label) above the top edge — under the ruler,
 * out of the viewport, and unreachable. Below the melody lane there is open
 * canvas, which is exactly where an alternate wants to sit.
 */
export const PLACEMENT_MIN_DY = 0;

export function snapPlacement(dx: number, dy: number): PolyPlacement {
  const snap = (value: number) => {
    const snapped = Math.round(value / PLACEMENT_SNAP) * PLACEMENT_SNAP;
    // `-0` would fail a strict comparison against a zero offset, and a
    // placement of -0 is not a placement.
    return snapped === 0 ? 0 : snapped;
  };
  return { dx: snap(dx), dy: Math.max(PLACEMENT_MIN_DY, snap(dy)) };
}

/** The stage key for a node: one pass of one section. */
export function placementKey(node: { key: string }): string {
  return node.key;
}

/**
 * Which placement a node shows.
 *
 * Two keys are meaningful: the node's own (`section#2` — lift *this* chorus)
 * and the bare section id (`chorus` — lift every pass of it). The node key
 * wins, so "unlift the whole section, then place one pass somewhere" behaves
 * the way it reads. The section-wide form is also the shape the first version
 * of this shipped with, so old saved stages keep working.
 */
export function resolvePlacement(
  placements: Placements,
  node: { key: string; sectionId: string },
): PolyPlacement | undefined {
  return placements[node.key] ?? placements[node.sectionId];
}

/**
 * A placement may not leave the canvas.
 *
 * The canvas's extent is the song (§0.13) and the lane stack is its whole
 * height (§0.16 — the shelf is chrome now), so a lift is bounded by the lanes:
 * `dx` keeps the column inside the arrangement's width, `dy` inside the stack.
 */
export function clampPlacement(
  node: PolyRect,
  placement: PolyPlacement,
  world: PolyRect,
): PolyPlacement {
  const dxMin = Math.min(0, world.x - node.x);
  const dxMax = Math.max(dxMin, world.x + world.w - (node.x + node.w));
  const dyMax = Math.max(
    PLACEMENT_MIN_DY,
    world.y + world.h - (node.y + node.h),
  );
  const dx = Math.max(dxMin, Math.min(dxMax, placement.dx));
  const dy = Math.max(PLACEMENT_MIN_DY, Math.min(dyMax, placement.dy));
  if (dx === placement.dx && dy === placement.dy) return placement;
  return { dx, dy };
}

export function isPlaced(placement: PolyPlacement | undefined): boolean {
  return Boolean(placement && (placement.dx !== 0 || placement.dy !== 0));
}

/** Where the node is DRAWN. `node` is the home column from the Score. */
export function placedRect(
  node: PolyRect,
  placement: PolyPlacement | undefined,
): PolyRect {
  if (!isPlaced(placement) || !placement) return node;
  return { ...node, x: node.x + placement.dx, y: node.y + placement.dy };
}

/**
 * The tether: a dashed line from the home column's spine point to the placed
 * column's. It is the "this still plays there" cue — the thing that keeps a
 * free canvas honest.
 */
export function tetherLine(
  home: PolyRect,
  placed: PolyRect,
  spineY: number,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: home.x + home.w / 2,
    y1: spineY,
    x2: placed.x + placed.w / 2,
    y2: placed.y + placed.h / 2,
  };
}
