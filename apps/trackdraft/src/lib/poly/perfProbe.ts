/**
 * The measurement half of spike S3 (canvas perf at scale).
 *
 * Two pure functions, so the number in the ledger is reproducible and the
 * arithmetic behind it is tested rather than eyeballed:
 *
 *  - `summariseFrames` — a list of frame deltas in, percentiles and a
 *    dropped-frame count out.
 *  - `sweepCamera` — the scripted camera move: pan the whole song, zoom out,
 *    pan back. Deterministic in `t`, so two runs measure the same thing.
 */

import { clampToWorld, type PolyCamera, type PolyViewport } from "./camera";

/** 60 fps. */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * A frame is "late" when it misses its vsync by a margin, not when it is a
 * fraction over 16.66: at 60fps the delta *is* the budget, so a strict `>`
 * marks every single good frame as a dropped one. 1.25× is 20.8ms — past that
 * the browser has genuinely skipped a frame.
 */
export const LATE_FRAME_FACTOR = 1.25;

export interface FrameSummary {
  frames: number;
  /** Median frame time, in ms. */
  p50: number;
  p90: number;
  p95: number;
  /** The worst frame — the stutter you actually notice. */
  max: number;
  /** Frames that missed their vsync by more than `LATE_FRAME_FACTOR`. */
  overBudget: number;
  overBudgetShare: number;
  /** Average frames per second over the run. */
  fps: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[index];
}

/**
 * Frame deltas worth measuring — everything after a warm-up window (§S1.11).
 *
 * `samples` are the `requestAnimationFrame` timestamps in order. The delta
 * between the first two is always dropped: it spans the gap between the click
 * that started the run and the first painted frame, which is the mount.
 *
 * The warm-up exists because a 5 s window that starts on the click which mounts
 * 64 columns measures the MOUNT — React inserting tens of thousands of nodes, the
 * first style/layout pass, JIT warm-up — and reports it as the canvas's frame
 * time. That is exactly how a 1.4 fps reading was recorded for a canvas whose
 * steady state is 17 ms.
 */
export function frameDeltas(
  samples: readonly number[],
  warmupMs = 0,
): number[] {
  if (samples.length < 2) return [];
  const start = samples[0];
  // Only frames that BEGAN after the window count, and only deltas between two
  // of those — so the first kept delta is measured from the last warm-up frame,
  // never from the click. A warm-up of 0 therefore measures the mount too,
  // which is why the lab always passes one.
  const kept = samples.filter(
    (at, index) => index > 0 && at - start > warmupMs,
  );
  const out: number[] = [];
  for (let i = 1; i < kept.length; i++) out.push(kept[i] - kept[i - 1]);
  return out;
}

export function summariseFrames(
  deltas: readonly number[],
  budgetMs: number = FRAME_BUDGET_MS,
): FrameSummary {
  if (deltas.length === 0) {
    return {
      frames: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      max: 0,
      overBudget: 0,
      overBudgetShare: 0,
      fps: 0,
    };
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const total = deltas.reduce((sum, delta) => sum + delta, 0);
  const late = budgetMs * LATE_FRAME_FACTOR;
  const overBudget = deltas.filter((delta) => delta > late).length;
  return {
    frames: deltas.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    overBudget,
    overBudgetShare: overBudget / deltas.length,
    fps: total > 0 ? (deltas.length / total) * 1000 : 0,
  };
}

/**
 * The scripted move, `t` running 0 → 1 across the whole run:
 *
 *   0.00–0.45  pan left to right across the song at the standard 50%
 *   0.45–0.70  zoom out to the overview, staying parked at the end
 *   0.70–1.00  pan back to the start at the overview zoom
 *
 * Clamped with the canvas's own `clampToWorld`, so the sweep measures the real
 * camera writes rather than positions the app would never allow.
 */
export function sweepCamera(
  t: number,
  world: { x: number; y: number; w: number; h: number },
  viewport: PolyViewport,
  options: { gutter?: number; topInset?: number; wideZoom?: number } = {},
): PolyCamera {
  const gutter = options.gutter ?? 56;
  const topInset = options.topInset ?? 14;
  const wideZoom = options.wideZoom ?? 0.5;
  // Zoom out to a bit under half, but never past the point where the lanes
  // fill less than most of the window — below that the clamp starts centring
  // and the sweep would be measuring an idle camera.
  const fitZoom = (viewport.height * 0.9) / Math.max(1, world.h);
  const narrowZoom = Math.max(0.08, Math.min(wideZoom * 0.45, fitZoom));
  const phase = Math.min(1, Math.max(0, t));
  const left = world.x + gutter / wideZoom;
  const right = world.x + world.w - gutter / wideZoom;

  let camera: PolyCamera;
  if (phase <= 0.45) {
    const p = phase / 0.45;
    camera = { x: left + (right - left) * p, y: 0, zoom: wideZoom };
  } else if (phase <= 0.7) {
    const p = (phase - 0.45) / 0.25;
    camera = {
      x: right,
      y: 0,
      zoom: wideZoom + (narrowZoom - wideZoom) * p,
    };
  } else {
    const p = (phase - 0.7) / 0.3;
    camera = { x: right + (left - right) * p, y: 0, zoom: narrowZoom };
  }
  return clampToWorld(camera, world, viewport, gutter, topInset);
}
