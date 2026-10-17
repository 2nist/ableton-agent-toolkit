/**
 * Shared time geometry for every editing surface.
 *
 * Scale is expressed in **pixels per bar**, not pixels per beat, because the
 * spine's axis is deliberately bar-linear: a 7/8 bar must occupy the same
 * width as a 4/4 bar so "this section is 8 bars, that one is 16" stays
 * readable at arrangement scale. Section editors derive their beat spacing
 * locally (`pxPerBar / beatsPerBar`).
 */
export type TimeDepth = "song" | "section";

/** The spine's ladder — preserved from the original BAR_PX_STEPS so zoom
 *  feels identical. */
export const SONG_BAR_PX_STEPS = [4, 6, 8, 10, 14, 20, 28, 40, 56, 80] as const;

/** Section-depth scales. 56 is the sequencer's base (BAR_PX), 78 its
 *  previous default (×1.4), 336 the old maximum (×6). */
export const SECTION_BAR_PX_STEPS = [14, 20, 28, 40, 56, 78, 110, 155, 220, 310] as const;

export const DEFAULT_SONG_BAR_PX = 10;
export const DEFAULT_SECTION_BAR_PX = 78;

export const MIN_SONG_BAR_PX = 2;
export const MAX_SONG_BAR_PX = 160;
export const MIN_SECTION_BAR_PX = 20;
export const MAX_SECTION_BAR_PX = 400;

export function clampBarPx(depth: TimeDepth, px: number): number {
  if (!Number.isFinite(px)) return depth === "song" ? DEFAULT_SONG_BAR_PX : DEFAULT_SECTION_BAR_PX;
  return depth === "song"
    ? Math.max(MIN_SONG_BAR_PX, Math.min(MAX_SONG_BAR_PX, px))
    : Math.max(MIN_SECTION_BAR_PX, Math.min(MAX_SECTION_BAR_PX, px));
}

/** Nearest ladder value in the requested direction; stays put at the ends. */
export function nextBarPx(
  steps: readonly number[],
  current: number,
  direction: 1 | -1,
): number {
  if (direction > 0) {
    return steps.find((value) => value > current + 0.01) ?? current;
  }
  return [...steps].reverse().find((value) => value < current - 0.01) ?? current;
}

/**
 * The scroll offset that keeps the bar under `anchorPx` fixed while the
 * scale changes. Used by wheel and pinch zoom so the musical position under
 * the pointer never slides away.
 */
export function anchoredScrollLeft(
  scrollLeft: number,
  anchorPx: number,
  prevBarPx: number,
  nextBarPxValue: number,
): number {
  if (prevBarPx <= 0 || nextBarPxValue <= 0) return Math.max(0, scrollLeft);
  const barAtAnchor = (scrollLeft + anchorPx) / prevBarPx;
  return Math.max(0, barAtAnchor * nextBarPxValue - anchorPx);
}

/** Scroll position in bars — the unit persisted across views, because pixels
 *  change with scale. */
export function scrollBarFromLeft(scrollLeft: number, barPx: number): number {
  return barPx > 0 ? Math.max(0, scrollLeft / barPx) : 0;
}

export function scrollLeftFromBar(scrollBar: number, barPx: number): number {
  return Math.max(0, scrollBar * barPx);
}

/** The scale that fits `bars` into `viewportPx`, clamped to the depth range. */
export function fitBarPx(depth: TimeDepth, viewportPx: number, bars: number): number {
  if (viewportPx <= 0 || bars <= 0) return depth === "song" ? DEFAULT_SONG_BAR_PX : DEFAULT_SECTION_BAR_PX;
  return clampBarPx(depth, viewportPx / bars);
}
