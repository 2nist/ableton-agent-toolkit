import type { PolyRect } from "./camera";

/**
 * Frames: the shelf for lifted alternates.
 *
 * The plan's §6.4 asked how a free canvas groups things without inventing a
 * container widget. The answer here is deliberately blunt — **a frame is a
 * region, and membership is whatever is inside it.** No membership list means
 * no invalidation: drag a section out and it leaves the group, drag one in and
 * it joins, and neither operation can leave a dangling id behind.
 *
 * That also keeps the whole feature on the Stage plane: a frame is a rectangle
 * someone drew round some drawings, and the song has never heard of it.
 */

export interface PolyFrame {
  id: string;
  label: string;
  /** World rect of the frame itself. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room a frame leaves around what it holds, in world units. */
export const FRAME_PADDING = 40;

export function frameRect(frame: PolyFrame): PolyRect {
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
}

/**
 * The smallest frame that holds every rect, with padding. `null` for nothing
 * to frame — an empty group is a rectangle that means "I forgot to select".
 */
export function frameAround(
  rects: readonly PolyRect[],
  padding = FRAME_PADDING,
): PolyRect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

/** Which nodes lie inside a frame. Containment is by centre, so a column that
 *  straddles the edge belongs to whichever side holds most of it. */
export function nodesInFrame(
  frame: PolyFrame,
  nodes: readonly (PolyRect & { key: string })[],
): string[] {
  const box = frameRect(frame);
  return nodes
    .filter((node) => {
      const cx = node.x + node.w / 2;
      const cy = node.y + node.h / 2;
      return (
        cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
      );
    })
    .map((node) => node.key);
}

/**
 * A frame's label sits INSIDE its top-left corner, not above it.
 *
 * Above is prettier, but it is also the one place a label can end up off the
 * canvas — a frame around content near the top edge would have its name (and
 * its delete button) outside the viewport, which is a trap rather than a
 * style. Inside, the label is wherever the frame is.
 */
export function frameLabel(
  frame: PolyFrame,
  zoom: number,
): { x: number; y: number; size: number } {
  const size = 10 / Math.max(zoom, 0.0001);
  const inset = 6 / Math.max(zoom, 0.0001);
  return { x: frame.x + inset, y: frame.y + inset, size };
}
