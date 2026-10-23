import type { SectionSpan } from "../arrangement";

/**
 * The whole-song timeline's mapping between canvas pixels and musical
 * position — the first *inverse* (x → beat) mapping in the app, needed by
 * the Drum Blocks view's marquee selection and its XY pad gestures
 * (the classic DrumsView only ever maps beats → x for rendering).
 *
 * Geometry constants are the SEQUENCER's own scale (bigger than the classic
 * DrumsView's local 40/36/40 set on purpose — cells must be playable, not
 * squinted at). DrumsView keeps its private copies; if it ever migrates,
 * it should decide whether to adopt this scale or keep its denser one.
 */

export const X0 = 104; // left gutter for lane labels
/** Clearance between the frozen gutter and the first cell of a lane. A cell is
 *  centred on its beat, so its left edge falls `r` px BEFORE the first bar
 *  line — without this the first cell is cut in half behind the gutter. */
export const GUTTER_INSET = 18;
/** One 4/4 bar at zoom 1 — 56px is the sequencer's starting scale: 14px
 *  per beat, so the default cells read as real sequencer steps (a step
 *  sequencer that needs zooming-in to be usable is a step sequencer that
 *  failed). The classic DrumsView keeps its own, denser 40px scale. */
export const BAR_PX = 56;
export const TRACK_H = 46;
export const TOP_PAD = 44;

/** Bar position → canvas x (bar 0 starts at the label gutter). */
export function barX(bar: number, zoom = 1): number {
  return X0 + bar * BAR_PX * zoom;
}

/** A span's beats per bar — 4 for 4/4, 3.5 for a 7/8 section (the
 *  quarter-note convention every other module uses). */
export function beatsPerBarOf(span: SectionSpan): number {
  return span.bars > 0 ? span.durationBeats / span.bars : 4;
}

/** Section-relative beat → canvas x. */
export function spanBeatToX(span: SectionSpan, beat: number, zoom = 1): number {
  const bpb = beatsPerBarOf(span);
  return barX(span.startBar, zoom) + (beat / bpb) * BAR_PX * zoom;
}

/** Canvas x → section-relative beat, clamped to the span's own bounds —
 *  the marquee's building block (never leaks past a section edge). */
export function spanXToBeat(span: SectionSpan, x: number, zoom = 1): number {
  const bpb = beatsPerBarOf(span);
  const beat = ((x - barX(span.startBar, zoom)) / (BAR_PX * zoom)) * bpb;
  return Math.max(0, Math.min(span.durationBeats, beat));
}

export interface SpanBeatHit {
  span: SectionSpan;
  /** Section-relative beat (0..durationBeats). */
  beat: number;
}

/** Which span (section occurrence) sits under a canvas x, and at what
 *  section-relative beat. Returns null outside every span. */
export function xToSpanBeat(spans: SectionSpan[], x: number, zoom = 1): SpanBeatHit | null {
  for (const span of spans) {
    const x1 = barX(span.startBar, zoom);
    if (x < x1) continue;
    const x2 = barX(span.startBar + span.bars, zoom);
    if (x >= x2) continue;
    return { span, beat: ((x - x1) / (BAR_PX * zoom)) * beatsPerBarOf(span) };
  }
  return null;
}

/** Snap a beat position to a grid (0.25/0.5/1 beats) without float noise. */
export function snapBeat(beat: number, grid: number): number {
  return round4(Math.round(beat / grid) * grid);
}

/**
 * The step grid the Drum Blocks sequencer edits at, by zoom — the
 * zoom-adaptive subdivision the demo's card 9 promised. Thresholds are
 * deliberately HIGH so that zooming grows the cells (up to ~28px wide)
 * instead of instantly replacing them with more, smaller ones: the grid
 * only subdivides once the cells are fat and would start colliding.
 *
 *   0.5× – 2.4× → quarter-note steps (the default "snap to beat")
 *   2.4× – 4.6× → 8th-note steps
 *   4.6×+       → 16th-note steps
 */
export function gridStepForZoom(zoom: number): number {
  if (zoom >= 4.6) return 0.25;
  if (zoom >= 2.4) return 0.5;
  return 1;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
