/**
 * Laying several sections out on one bar grid.
 *
 * The drums view solved this first: the selection becomes one continuous
 * timeline, sized by the bars it actually holds, and scrolls when it doesn't
 * fit. Harmony needs the same shape — the join between one chorus and the
 * next is the thing you are looking at — so the maths lives here, away from
 * the JSX, and can be tested without a DOM.
 *
 * The rule that matters: every band gets the SAME px-per-bar. A band that
 * scaled itself to its own width would put the same bar at a different x than
 * its neighbour, which is exactly what makes a comparison view useless.
 */

export interface StripInput {
  id: string;
  /** Bars as authored — rounded like the drums view rounds them. */
  bars: number;
}

export interface StripBand extends StripInput {
  /** Left edge inside the strip, in px. */
  x: number;
  widthPx: number;
}

export interface StripLayout {
  bands: StripBand[];
  totalBars: number;
  pxPerBar: number;
  /** Width the bands actually need — larger than the container means scroll. */
  contentWidth: number;
}

/** Enough room to read a chord block, few enough that a long section still
 *  fits on a laptop. */
const MIN_PX_PER_BAR = 44;
/** Past this the strip stops stretching and leaves the rest of the row empty,
 *  so three short sections don't turn into giant blocks. */
const MAX_PX_PER_BAR = 140;

export function stripLayout(
  sections: readonly StripInput[],
  containerWidth: number,
  limits: { min?: number; max?: number } = {},
): StripLayout {
  const min = limits.min ?? MIN_PX_PER_BAR;
  const max = limits.max ?? MAX_PX_PER_BAR;
  const bars = sections.map((section) => ({
    ...section,
    bars: Math.max(1, Math.round(section.bars) || 1),
  }));
  const totalBars = bars.reduce((sum, section) => sum + section.bars, 0);
  const usable = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  const pxPerBar = totalBars === 0 ? min : Math.min(max, Math.max(min, usable / totalBars));

  let x = 0;
  const bands = bars.map((section) => {
    const widthPx = section.bars * pxPerBar;
    const band = { ...section, x, widthPx };
    x += widthPx;
    return band;
  });

  return { bands, totalBars, pxPerBar, contentWidth: x };
}
