/**
 * Level-of-detail policy for canvas nodes, kept apart from React so the
 * thresholds can be tested as arithmetic rather than by mounting components.
 *
 * A canvas whose text merely scales turns to mush at arrangement zoom, so
 * content is DROPPED as you zoom out rather than shrunk. The tiers are named
 * for what a node looks like, not for a number.
 */
export type PolyLod = "dot" | "compact" | "full" | "detail";

export const LOD_TIERS: readonly PolyLod[] = [
  "dot",
  "compact",
  "full",
  "detail",
];

/** Zoom at which each tier starts.
 *
 *  Tuned to the lane geometry (a column is ~550 world units tall) and to the
 *  standard view: 0.5 is the zoom the canvas opens at, so it has to sit well
 *  inside `full` rather than a hair above the threshold. */
export const LOD_THRESHOLDS = [0.16, 0.4, 0.9] as const;

/** How far past a threshold the zoom must go before the face changes.
 *  Without a dead band a node resting on a boundary flickers while the user
 *  nudges the zoom. */
export const LOD_HYSTERESIS = 0.08;

function tierIndex(zoom: number): number {
  for (let index = 0; index < LOD_THRESHOLDS.length; index += 1) {
    if (zoom < LOD_THRESHOLDS[index]) return index;
  }
  return LOD_THRESHOLDS.length;
}

/**
 * The next tier, given where the zoom is and where the face already is.
 * Crossing into a tier requires `1 + hysteresis` past the threshold; crossing
 * back requires `1 - hysteresis`, so the two boundaries never coincide.
 */
export function stickyLodIndex(zoom: number, current: number): number {
  const raw = tierIndex(zoom);
  if (raw === current) return current;

  if (raw > current) {
    let next = current;
    while (next < raw && zoom > LOD_THRESHOLDS[next] * (1 + LOD_HYSTERESIS))
      next += 1;
    return next;
  }

  let next = current;
  while (next > raw && zoom < LOD_THRESHOLDS[next - 1] * (1 - LOD_HYSTERESIS))
    next -= 1;
  return next;
}

export function lodFor(zoom: number): PolyLod {
  return LOD_TIERS[tierIndex(zoom)];
}

export function clockLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
