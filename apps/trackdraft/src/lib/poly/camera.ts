/**
 * The poly canvas camera — the spatial counterpart of the timeline's scroll
 * position.
 *
 * Convention: `x`/`y` are the WORLD point sitting at the CENTRE of the
 * viewport. Centring makes zoom-at-cursor and fit symmetric, and it means a
 * resize does not slide the content sideways the way a top-left pan offset
 * would.
 *
 * Everything here is pure and viewport-explicit, so it can be tested without
 * a DOM (and reused by the minimap, which is a second projection of the same
 * camera).
 */

export interface PolyCamera {
  /** World x at the viewport centre. */
  x: number;
  /** World y at the viewport centre. */
  y: number;
  zoom: number;
}

export interface PolyViewport {
  width: number;
  height: number;
}

export interface PolyPoint {
  x: number;
  y: number;
}

export interface PolyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Below this the canvas is a map (chips and rails only); above ~4 it is a
 *  desk. The range is deliberately wider than a timeline's: an arrangement
 *  needs to be seen whole, and a voice-leading detail needs to be big. */
export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;

export const DEFAULT_CAMERA: PolyCamera = { x: 0, y: 0, zoom: 1 };

/** One ladder step for `[` / `]` — same "feel" as the spine, different axis. */
export const ZOOM_STEP = 1.25;

/** The working zoom — one section's full lane stack readable in a normal
 *  window. `F` still fits the whole song; this is where the canvas opens. */
export const STANDARD_ZOOM = 0.5;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function clampCamera(camera: PolyCamera): PolyCamera {
  return {
    x: Number.isFinite(camera.x) ? camera.x : 0,
    y: Number.isFinite(camera.y) ? camera.y : 0,
    zoom: clampZoom(camera.zoom),
  };
}

export function worldToScreen(
  camera: PolyCamera,
  viewport: PolyViewport,
  world: PolyPoint,
): PolyPoint {
  return {
    x: (world.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (world.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function screenToWorld(
  camera: PolyCamera,
  viewport: PolyViewport,
  screen: PolyPoint,
): PolyPoint {
  return {
    x: (screen.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (screen.y - viewport.height / 2) / camera.zoom + camera.y,
  };
}

/**
 * Zoom by `factor` while the world point under `focal` (viewport-local
 * pixels) stays exactly where it is. At the clamp limits this returns the
 * camera unchanged rather than sliding the content.
 */
export function zoomAt(
  camera: PolyCamera,
  viewport: PolyViewport,
  focal: PolyPoint,
  factor: number,
): PolyCamera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const anchor = screenToWorld(camera, viewport, focal);
  return {
    zoom,
    x: anchor.x - (focal.x - viewport.width / 2) / zoom,
    y: anchor.y - (focal.y - viewport.height / 2) / zoom,
  };
}

/** Drag panning: the world follows the pointer, so the camera moves opposite. */
export function panByPixels(
  camera: PolyCamera,
  dxPixels: number,
  dyPixels: number,
): PolyCamera {
  return {
    ...camera,
    x: camera.x - dxPixels / camera.zoom,
    y: camera.y - dyPixels / camera.zoom,
  };
}

/** Place `rect` in the middle of the viewport at the largest zoom that fits,
 *  leaving `padding` screen pixels of breathing room. */
export function fitRect(
  rect: PolyRect,
  viewport: PolyViewport,
  padding = 56,
): PolyCamera {
  if (
    !(rect.w > 0) ||
    !(rect.h > 0) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return DEFAULT_CAMERA;
  }
  const usableW = Math.max(1, viewport.width - padding * 2);
  const usableH = Math.max(1, viewport.height - padding * 2);
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    zoom: clampZoom(Math.min(usableW / rect.w, usableH / rect.h)),
  };
}

/** Bring a world point to the centre, keeping the zoom. */
export function centreOn(camera: PolyCamera, point: PolyPoint): PolyCamera {
  return { ...camera, x: point.x, y: point.y };
}

/**
 * Keep the camera inside the song.
 *
 * This replaces the earlier `insetToContent`, which was a partial version of
 * the same rule: it only corrected a *visible* overlap with the gutter and left
 * everything else free, so the canvas could be panned into an empty plane and
 * left there. The canvas is a document whose extent comes from the song
 * (§0.13), so panning stops at its edges — and, when the song is smaller than
 * the window at the current zoom, it is centred and locked, which is what stops
 * a zoomed-out song becoming a speck in a void.
 *
 * `gutter` and `topInset` are the strips of chrome that overlay the canvas —
 * the frozen lane labels on the left, the whole-song ruler at the top — so the
 * song's first bar stops beside them rather than underneath.
 */
export function clampToWorld(
  camera: PolyCamera,
  world: PolyRect,
  viewport: PolyViewport,
  gutter = 0,
  topInset = 0,
): PolyCamera {
  if (!(world.w >= 0) || !(world.h >= 0)) return camera;
  if (viewport.width <= 0 || viewport.height <= 0) return camera;
  const zoom = clampZoom(camera.zoom);
  const halfW = viewport.width / 2 / zoom;
  const halfH = viewport.height / 2 / zoom;
  const inset = Math.max(0, Math.min(gutter, viewport.width));

  const axis = (
    value: number,
    start: number,
    size: number,
    half: number,
    leadingInset: number,
  ) => {
    // The visible window, in world units, is [value - half, value + half], and
    // `leadingInset` of overlay covers the near edge. So the camera may show
    // the world's start at the inset and its end at the far edge, and nothing
    // beyond either.
    const min = start + half - leadingInset / zoom;
    const max = start + size - half;
    if (min > max) return start + size / 2 - leadingInset / 2 / zoom;
    return Math.max(min, Math.min(max, value));
  };

  const x = axis(camera.x, world.x, world.w, halfW, inset);
  const y = axis(camera.y, world.y, world.h, halfH, topInset);
  if (x === camera.x && y === camera.y) return camera;
  return { ...camera, x, y };
}

/** The world rect currently on screen — the minimap's viewport bracket and
 *  the renderer's culling test both read this. */
export function visibleWorldRect(
  camera: PolyCamera,
  viewport: PolyViewport,
): PolyRect {
  const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: viewport.width / camera.zoom,
    h: viewport.height / camera.zoom,
  };
}

export function rectsIntersect(a: PolyRect, b: PolyRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
