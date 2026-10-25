/**
 * A small hand-rolled 3D projection for the harmony "scene" view.
 *
 * The honeycomb's axial lattice is wonderful for *reading* harmony but it can
 * only ever show two dimensions of a chord (its degree), which is why the flat
 * wheel and its depth variant are still approximations. This module takes the
 * other half of the experiment: a plain rectilinear space where
 *
 *   x = scale degree (I … VII)          the diatonic path
 *   y = chromatic alteration (b / ♮ / #)  borrowed, secondary, modal shifts
 *   z = time (step index)                 the sequence, always advancing
 *
 * Nothing here knows about chords — it rotates, projects and sorts polygons.
 * Orthographic (no perspective) on purpose: parallel edges keep a progression
 * legible, and painter's-order sorting is exact for a set of boxes.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface SceneCamera {
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  /** Tilt towards the viewer, radians (clamped by the caller). */
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Vertical scale relative to `zoom`. 1 is a true orthographic projection;
   *  the locked front view stretches this so the ladder rows keep a readable
   *  height while the time axis compresses to fit the window — the same
   *  anisotropy the drums grid gets for free, because its lanes never scale.
   *  Absent means 1. */
  scaleY?: number;
}

export const DEFAULT_CAMERA: SceneCamera = {
  yaw: (-32 * Math.PI) / 180,
  pitch: (22 * Math.PI) / 180,
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.6;
export const MAX_PITCH = (78 * Math.PI) / 180;

export function clampCamera(camera: SceneCamera): SceneCamera {
  return {
    ...camera,
    yaw: camera.yaw,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.pitch)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)),
    panX: camera.panX,
    panY: camera.panY,
  };
}

/** Yaw about Y, then pitch about X. Larger returned `z` is nearer the viewer. */
export function rotatePoint(point: Vec3, camera: SceneCamera): Vec3 {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const x1 = point.x * cy + point.z * sy;
  const z1 = -point.x * sy + point.z * cy;
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  return {
    x: x1,
    y: point.y * cp - z1 * sp,
    z: point.y * sp + z1 * cp,
  };
}

export interface ProjectedPoint extends Vec2 {
  /** Camera-space depth: larger is nearer. Used only for sorting. */
  depth: number;
}

/** Orthographic projection into screen pixels (y grows downwards). */
export function projectPoint(
  point: Vec3,
  camera: SceneCamera,
  origin: Vec2,
): ProjectedPoint {
  const rotated = rotatePoint(point, camera);
  return {
    x: origin.x + rotated.x * camera.zoom + camera.panX,
    y: origin.y - rotated.y * camera.zoom * (camera.scaleY ?? 1) + camera.panY,
    depth: rotated.z,
  };
}

export type BoxFaceKind = "top" | "bottom" | "front" | "back" | "left" | "right";

export interface SceneFace {
  /** Screen-space polygon. */
  points: Vec2[];
  /** Average camera depth — painter's order paints small first. */
  depth: number;
  /** 0..1 lighting from the face normal: 1 faces the viewer. */
  shade: number;
  /** Which face of the box this is — the top face is the duration handle. */
  kind: BoxFaceKind;
}

/** Corner order for the six box faces (indices into `cubeCorners`). */
const FACES: { indices: [number, number, number, number]; kind: BoxFaceKind }[] = [
  { indices: [0, 1, 3, 2], kind: "bottom" },
  { indices: [4, 5, 7, 6], kind: "top" },
  { indices: [0, 1, 5, 4], kind: "back" },
  { indices: [2, 3, 7, 6], kind: "front" },
  { indices: [0, 2, 6, 4], kind: "left" },
  { indices: [1, 3, 7, 5], kind: "right" },
];

/** The 8 corners of an axis-aligned box, in the FACES winding order. */
function cubeCorners(center: Vec3, size: Vec3): Vec3[] {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  return [
    { x: center.x - hx, y: center.y - hy, z: center.z - hz },
    { x: center.x + hx, y: center.y - hy, z: center.z - hz },
    { x: center.x - hx, y: center.y - hy, z: center.z + hz },
    { x: center.x + hx, y: center.y - hy, z: center.z + hz },
    { x: center.x - hx, y: center.y + hy, z: center.z - hz },
    { x: center.x + hx, y: center.y + hy, z: center.z - hz },
    { x: center.x - hx, y: center.y + hy, z: center.z + hz },
    { x: center.x + hx, y: center.y + hy, z: center.z + hz },
  ];
}

/**
 * Project a box into its six faces, back-to-front, with a simple directional
 * shade so the 2D projection still reads as a solid.
 */
export function boxFaces(
  center: Vec3,
  size: Vec3,
  camera: SceneCamera,
  origin: Vec2,
): SceneFace[] {
  const corners = cubeCorners(center, size).map((corner) =>
    projectPoint(corner, camera, origin),
  );
  return FACES.map(({ indices: [a, b, c, d], kind }) => {
    const points = [corners[a], corners[b], corners[c], corners[d]].map(({ x, y }) => ({ x, y }));
    const depth = (corners[a].depth + corners[b].depth + corners[c].depth + corners[d].depth) / 4;
    return {
      points,
      depth,
      shade: 0.55 + 0.45 * viewerFacing(corners[a], corners[b], corners[c]),
      kind,
    };
  }).sort((left, right) => left.depth - right.depth);
}

/** How square-on a face is to the viewer, from its screen-space winding. */
function viewerFacing(a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint): number {
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.min(1, Math.abs(area) / 900);
}

/** Rotate with a pointer drag: horizontal = yaw, vertical = pitch. */
export function orbit(camera: SceneCamera, dxPixels: number, dyPixels: number): SceneCamera {
  return clampCamera({
    ...camera,
    yaw: camera.yaw + dxPixels * 0.01,
    pitch: camera.pitch + dyPixels * 0.008,
  });
}

/** Scroll/pinch zoom, clamped. */
export function zoomBy(camera: SceneCamera, factor: number): SceneCamera {
  return clampCamera({ ...camera, zoom: camera.zoom * factor });
}

/** Drag-pan in screen pixels. */
export function panBy(camera: SceneCamera, dxPixels: number, dyPixels: number): SceneCamera {
  return { ...camera, panX: camera.panX + dxPixels, panY: camera.panY + dyPixels };
}

/** Tallest and shortest box in the scene, in world units. */
export const MIN_BOX_HEIGHT = 7;
export const MAX_BOX_HEIGHT = 34;

/**
 * A chord's box height is its LENGTH in beats, so harmonic rhythm is legible
 * without reading a label: four beats ≈ 16px, eight ≈ 25px, clamped so a
 * single bar-long chord can't dominate the scene.
 */
export function boxHeightForBeats(beats: number): number {
  return Math.min(MAX_BOX_HEIGHT, MIN_BOX_HEIGHT + Math.max(0.5, beats) * 2.4);
}

/** Older chords dim towards the background so a run leaves a visible wake. */
export function trailFade(index: number, total: number): number {
  if (total <= 1) return 1;
  return 0.4 + 0.6 * (index / (total - 1));
}


/* ============================================================
   CAMERA PRESETS
   ------------------------------------------------------------
   Front is the EDITING camera: with yaw 90° the z (time) axis is
   horizontal on screen and the pitch axis is vertical, so a drag is
   nearly 1:1. Three-quarter is for reading the space, Top for the
   flat grid. All three keep the floor plane well away from edge-on,
   which is what makes `unprojectToPlane` numerically stable.
   ============================================================ */

export const CAMERA_PRESETS = {
  front: { yaw: Math.PI / 2, pitch: (58 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 },
  threeQuarter: DEFAULT_CAMERA,
  top: { yaw: 0, pitch: (84 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 },
} satisfies Record<string, SceneCamera>;

/**
 * Where a screen point lands on a horizontal plane (a lane floor), in world
 * x/z. Exact for the orthographic projection, so a drag can be resolved
 * without ray-marching and without the depth ambiguity of 3D picking.
 *
 * Returns null when the camera looks nearly edge-on to the plane (|sin
 * pitch| tiny): there is no stable answer there, and the caller should fall
 * back to dragging along the screen axes.
 */
export interface PlanePoint {
  /** World x (degree column). */
  x: number;
  /** World z (time). */
  z: number;
}

export function unprojectToPlane(
  screenX: number,
  screenY: number,
  planeY: number,
  camera: SceneCamera,
  origin: Vec2,
): PlanePoint | null {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  if (Math.abs(sp) < 0.2) return null;

  const A = (screenX - origin.x) / camera.zoom;
  const B =
    (-(screenY - origin.y) / (camera.zoom * (camera.scaleY ?? 1)) - planeY * cp) / sp;
  return { x: cy * A + sy * B, z: sy * A - cy * B };
}

/** Screen-space direction of one world axis at a point — the axis lock reads
 *  these to decide whether a gesture is "degree" or "time". */
export function screenAxis(
  axis: "x" | "z",
  at: Vec3,
  camera: SceneCamera,
  origin: Vec2,
): Vec2 {
  const step = 10;
  const a = projectPoint(at, camera, origin);
  const b = projectPoint(
    axis === "x" ? { ...at, x: at.x + step } : { ...at, z: at.z + step },
    camera,
    origin,
  );
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}
