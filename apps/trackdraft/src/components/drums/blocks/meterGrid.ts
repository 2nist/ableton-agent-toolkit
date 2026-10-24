import type { SectionSpan } from "../../../lib/arrangement";

/**
 * Zoom in this view is BARS PER VIEW — a musical unit, not a percentage.
 *
 * The step grid follows the meter rather than the pixel scale, so the same
 * zoom level lands on a legible division for every meter:
 *
 *   bars/view   4/4 (bpb 4)   12/8 (bpb 6)   7/8 (bpb 3.5)   5/4 (bpb 5)
 *   1–2         16ths         8ths (12)      8ths (14)       8ths (10)
 *   4–8         8ths          8ths (12)      8ths (7)        8ths (10)
 *   16–ALL      quarters      quarters (6)   8ths (7)        quarters (5)
 *
 * The rule: prefer a subdivision that *divides the bar exactly* and is near
 * the target density. A 12/8 bar therefore gets 12/6/3 (never 8, which
 * would put a step on a dotted-quarter), and an odd bar like 7/8 keeps its
 * 7 eighths rather than rounding to something that drifts against the
 * barline.
 */

export type BarsPerView = 1 | 2 | 4 | 8 | 16 | "all";

export const BARS_PER_VIEW_OPTIONS: BarsPerView[] = [1, 2, 4, 8, 16, "all"];

const isInt = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-6;

export interface StepGrid {
  /** How many steps one bar of THIS meter is divided into. */
  stepsPerBar: number;
  /** Section-relative beats per step. */
  stepBeats: number;
  /** Beats in one bar (4 for 4/4, 6 for 12/8, 3.5 for 7/8). */
  beatsPerBar: number;
}

export function stepGridFor(span: SectionSpan, barsPerView: BarsPerView): StepGrid {
  const bars = Math.max(1, span.bars);
  const bpb = span.durationBeats / bars;
  const sixteenths = bpb * 4;
  const eighths = bpb * 2;
  const quarters = bpb;
  const level = barsPerView === "all" || barsPerView >= 16 ? "wide" : barsPerView >= 4 ? "medium" : "detail";

  let stepsPerBar: number;
  if (level === "detail") {
    stepsPerBar = sixteenths <= 16 + 1e-6 ? sixteenths : eighths;
  } else if (level === "medium") {
    stepsPerBar = eighths <= 12 + 1e-6 ? eighths : quarters;
  } else {
    stepsPerBar = isInt(quarters) ? quarters : eighths;
  }
  stepsPerBar = Math.max(1, Math.round(stepsPerBar));
  return { stepsPerBar, stepBeats: bpb / stepsPerBar, beatsPerBar: bpb };
}
