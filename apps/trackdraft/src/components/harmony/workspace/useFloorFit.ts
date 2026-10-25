import type { Vec3 } from "../../../lib/harmony/scene3d";
import { projectPoint, type SceneCamera } from "../../../lib/harmony/scene3d";

/**
 * Where the floor's grid and boxes land on the plate.
 *
 * Pulled out of the component for two reasons: it is the one piece of the
 * floor with real arithmetic in it (and now has tests), and the floor itself
 * was carrying the fit, the gestures, two menus and the scene in one file.
 *
 * The invariants it keeps:
 *  - in the locked front view the TIME axis decides the zoom and `scaleY`
 *    decides how tall the rows are, so the twelve rows stay readable while a
 *    long window compresses (see checkpoints 005);
 *  - a window shorter than the plate grows drop-room bars instead of drawing
 *    mountains, up to MIN_BARS_ACROSS bars minimum;
 *  - nothing that has to be read (labels included) ends up outside the plate.
 */

/** World spacing of one SEMITONE — the ladder has twelve of them. The seven
 *  scale steps are wider apart only in the sense that chromatic ones are
 *  drawn dimmer; the grid itself is even. */
export const STEP_W = 40;
/** Steps in an octave: the chromatic ladder the pitch axis shows. */
export const LADDER_STEPS = 12;
export const BEAT_Z = 26;
export const BOX_X = 30;
/** Height of the tension strip pinned inside the plate's foot. */
export const TENSION_H = 46;
/** Breathing room at the plate's left and right edges, in pixels. */
export const PAD = 26;
/** The bar ruler across the top of the plate. */
export const RULER_H = 20;
/** A plate never shows fewer bars than this, however short the window. */
export const MIN_BARS_ACROSS = 4;
/** Share of the band the twelve ladder rows claim once `scaleY` has its say. */
export const ROW_SHARE = 0.94;
/** How many bars of drop room the grid may grow to reach the plate's edge. */
export const MAX_DROP_BARS = 8;

export interface FitNode {
  start: number;
  beats: number;
  center: Vec3;
  size: Vec3;
}

export interface FloorFitInput {
  camera: SceneCamera;
  /** Plate width in pixels. */
  width: number;
  windowBeats: number;
  windowStart: number;
  nodes: readonly FitNode[];
  /** Plate height in pixels. */
  stageH: number;
  /** True in the locked front view (the anisotropic one). */
  locked: boolean;
  barsShown: number;
  beatsPerBar: number;
}

export interface FloorFit {
  zoom: number;
  /** Vertical scale relative to `zoom` — 1 outside the locked front view. */
  scaleY: number;
  height: number;
  gridBars: number;
  origin: { x: number; y: number };
}

export function computeFloorFit(input: FloorFitInput): FloorFit {
  const {
    camera,
    width,
    windowBeats,
    windowStart,
    nodes,
    stageH,
    locked,
    barsShown,
    beatsPerBar,
  } = input;
  const base: SceneCamera = { ...camera, zoom: 1, panX: 0, panY: 0 };
  const proj = (point: Vec3) => projectPoint(point, base, { x: 0, y: 0 });
  // Grid and content are collected separately so the drop-room pass can
  // rebuild the grid without losing the boxes from the bounds.
  const gridXs: number[] = [];
  const gridYs: number[] = [];
  const contentXs: number[] = [];
  const contentYs: number[] = [];

  // The floor plane (twelve semitones × this window) is the grid. `x` runs
  // from the tonic row to one box past the last step: in the locked front view
  // `x` is SCREEN VERTICAL, so padding it with a label margin on the left
  // would open a panel of dead space under the tonic row.
  // z starts slightly negative: the step labels sit behind the front edge.
  const addGrid = (gridBeats: number) => {
    for (const x of [0, (LADDER_STEPS - 1) * STEP_W + BOX_X]) {
      for (const z of [-BEAT_Z * 2, 0, gridBeats * BEAT_Z]) {
        const point = proj({ x, y: 0, z });
        gridXs.push(point.x);
        gridYs.push(point.y);
      }
    }
  };
  // …and the boxes are the content that must not clip.
  // Only the ones inside the window: a box two bars away must not stretch
  // the fit and leave the visible chords tiny.
  // A chord can outlast the window (a 16-beat `i` in a 4-bar view). Its box is
  // drawn past the edge and clipped by the plate, so the fit clamps to the
  // window instead of chasing it — otherwise one long chord quietly overrides
  // the bars-per-view setting by widening the whole grid.
  const windowZ0 = windowStart * BEAT_Z;
  const windowZ1 = (windowStart + windowBeats) * BEAT_Z;
  for (const node of nodes) {
    if (!(node.start + node.beats > windowStart - 0.001 && node.start < windowStart + windowBeats)) continue;
    const hx = node.size.x / 2;
    const hy = node.size.y / 2;
    const hz = node.size.z / 2;
    const z0 = Math.max(node.center.z - hz, windowZ0);
    const z1 = Math.min(node.center.z + hz, windowZ1);
    for (const sx of [-hx, hx]) {
      for (const sy of [-hy, hy]) {
        for (const sz of [z0, z1]) {
          const point = proj({ x: node.center.x + sx, y: node.center.y + sy, z: sz });
          contentXs.push(point.x);
          contentYs.push(point.y);
        }
      }
    }
  }
  const spans = (extraGridBars = 0) => {
    const xs = gridXs.concat(contentXs);
    const ys = gridYs.concat(contentYs);
    if (extraGridBars > 0) {
      gridXs.length = 0;
      gridYs.length = 0;
      addGrid(extraGridBars * beatsPerBar);
      xs.push(...gridXs);
      ys.push(...gridYs);
    }
    return {
      spanX: Math.max(80, Math.max(...xs) - Math.min(...xs)),
      spanY: Math.max(80, Math.max(...ys) - Math.min(...ys)),
      xs,
      ys,
    };
  };

  addGrid(windowBeats);
  const first = spans();
  const sceneH = Math.max(120, stageH - RULER_H - TENSION_H - 20);
  const zoomFromWidth = (width - PAD * 2) / first.spanX;
  // Never fewer than MIN_BARS_ACROSS bars: past that the grid grows drop
  // room instead of widening the same four.
  const zoomCap = (width - PAD * 2) / (MIN_BARS_ACROSS * Math.max(1, beatsPerBar) * BEAT_Z);
  // In the locked front view the TIME axis alone decides the zoom; the
  // vertical budget belongs to `scaleY` below. That split is the whole
  // point: a 77-bar window compresses time without shrinking the twelve
  // ladder rows into a smear, and a 2-bar window stops drawing 600px bars.
  const zoom = locked
    ? Math.max(0.16, Math.min(3.2, Math.min(zoomFromWidth, zoomCap)))
    : Math.max(0.16, Math.min(3.2, Math.min(zoomFromWidth, sceneH / first.spanY)));

  // Width left over at this zoom becomes drop-room bars (rounded DOWN so the
  // extension can never push the grid past the plate).
  const slack = locked ? Math.max(0, (width - PAD * 2) / zoom - first.spanX) : 0;
  const barWidth = Math.max(1, beatsPerBar * BEAT_Z);
  const extraBars = Math.min(MAX_DROP_BARS, Math.ceil(slack / barWidth));
  const gridBars = barsShown + extraBars;
  const bounds = extraBars > 0 ? spans(gridBars) : first;
  // The whole bars round up, so the zoom comes back down just enough that the
  // final bar ends on the right pad: the grid is flush to both edges instead
  // of leaving a bar's worth of plate hanging off the end.
  const finalZoom =
    extraBars > 0 ? Math.max(0.16, Math.min(zoom, (width - PAD * 2) / bounds.spanX)) : zoom;
  const { xs, ys } = bounds;

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  // Hang the grid off the LEFT pad so any leftover space sits at the end of
  // the window, not as a margin.
  const height = stageH;
  // The vertical scale that keeps the rows readable. It multiplies EVERY
  // vertical quantity — row pitch, box height — by the same factor, so the
  // chart keeps its proportions while the time axis compresses. This is the drums grid's trick (its lanes never scale),
  // done here as an axis scale.
  const scaleY = (() => {
    if (!locked) return 1;
    const rowPitch =
      Math.abs(proj({ x: STEP_W, y: 0, z: 0 }).y - proj({ x: 0, y: 0, z: 0 }).y) * finalZoom;
    if (!(rowPitch > 0.0001)) return 1;
    const target = (sceneH * ROW_SHARE) / LADDER_STEPS;
    // Never past the plate: whatever scale we pick, the content must fit.
    // This wins even when it means squashing below the comfortable floor —
    // a stacked band is short, and clipping the tonic row is worse.
    const fitLimit = Math.max(0.2, sceneH / Math.max(1, (bottom - top) * finalZoom));
    return Math.min(Math.max(target / rowPitch, 0.55), fitLimit);
  })();
  return {
    zoom: finalZoom,
    scaleY,
    height,
    gridBars,
    origin: {
      x: PAD - left * finalZoom,
      y: RULER_H + (height - RULER_H - TENSION_H) / 2 - (((top + bottom) / 2) * finalZoom * scaleY),
    },
  };
}
