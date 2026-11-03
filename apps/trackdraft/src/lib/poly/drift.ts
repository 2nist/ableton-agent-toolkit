/**
 * Drift: how far a section's material has been pushed off the song's grid.
 *
 * A local clock is allowed to move a note anywhere — that is the point of it.
 * What is *not* allowed is for that to happen invisibly: a swung hat that sits
 * a 24th of a beat late is a real musical choice when you made it, and a
 * mistake when you did not. So every lane that maps through `applyTimeDomain`
 * also reports how much it moved off the grid, and the canvas offers the one
 * gesture that undoes it (`snapTo`, which sets the domain's `quantizeTo`).
 */

/** The canvas edits on sixteenths, so that is the grid drift is measured against. */
export const DRIFT_GRID = 0.25;

/**
 * How far off a line a hit has to be before it counts as drift — a fifth of a
 * grid step. Real grooves carry micro-timing (the corpus' pools are a few
 * thousandths of a beat off, and that is feel, not error), so a strict test
 * flagged 44 of 61 hits on an untouched section. A fifth is beyond feel.
 */
export const DRIFT_TOLERANCE_SHARE = 0.2;

export interface DriftReport {
  /** Hits that do not sit on a grid line. */
  offGrid: number;
  /** The largest distance from a grid line, in beats. */
  worst: number;
  /** Grid line each off-grid hit would snap to, deduplicated, ascending. */
  lines: number[];
}

export function driftOf(
  beats: readonly number[],
  grid: number = DRIFT_GRID,
): DriftReport {
  if (grid <= 0) return { offGrid: 0, worst: 0, lines: [] };
  const tolerance = grid * DRIFT_TOLERANCE_SHARE;
  let offGrid = 0;
  let worst = 0;
  const lines = new Set<number>();
  for (const beat of beats) {
    const nearest = Math.round(beat / grid) * grid;
    const distance = Math.abs(beat - nearest);
    if (distance <= tolerance) continue;
    offGrid += 1;
    worst = Math.max(worst, distance);
    lines.add(Number(nearest.toFixed(4)));
  }
  return {
    offGrid,
    worst,
    lines: [...lines].sort((a, b) => a - b),
  };
}

/** "3 off-grid · up to 0.09 beat" — the phrase a badge can carry. */
export function driftLabel(
  report: Pick<DriftReport, "offGrid" | "worst">,
  dropped = 0,
): string {
  if (report.offGrid === 0 && dropped === 0) return "";
  const parts: string[] = [];
  if (report.offGrid > 0) {
    parts.push(
      `${report.offGrid} off-grid${report.worst > 0 ? ` (up to ${report.worst.toFixed(2)} beat)` : ""}`,
    );
  }
  if (dropped > 0) parts.push(`${dropped} past the end`);
  return parts.join(" · ");
}
