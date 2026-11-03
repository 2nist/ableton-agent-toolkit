import { create } from "zustand";
import {
  clampCamera,
  DEFAULT_CAMERA,
  type PolyCamera,
} from "../lib/poly/camera";
import {
  isPlaced,
  snapPlacement,
  type Placements,
} from "../lib/poly/placements";
import type { PolyFrame } from "../lib/poly/frames";
import {
  DEFAULT_LANE_ORDER,
  LEGACY_SHELF_DY,
  lanesOnSide,
  normaliseLaneOrder,
  type PolyLaneId,
  type PolyLaneOrder,
} from "../lib/poly/layout";
import { STORAGE_KEYS } from "../lib/persistence/keys";
import { createDebouncedWriter, readStorage } from "./storage";

/**
 * The poly canvas's camera, one per song.
 *
 * Deliberately the ONLY thing this store persists. P0 is a read-only
 * projection of `sectionSpans()`, so there is no authored layout to lose —
 * authored stage positions arrive later, in their own sidecar, and must
 * never be smuggled into `BlueprintSong` while this is still an experiment.
 *
 * Scope is `ui` (see lib/persistence/keys.ts): losing the camera is an
 * annoyance, never data loss.
 */

export interface PersistedPolyCamera {
  cameras?: Record<string, Partial<PolyCamera>>;
}

/** How a chord cell is labelled: the analysis's numeral, or the chord's name. */
export type PolyChordLabels = "roman" | "letter";

/** The canvas's reading preferences — device-global, never part of the song. */
export interface PolyPrefs {
  laneOrder: PolyLaneOrder;
  chordLabels: PolyChordLabels;
}

export const DEFAULT_POLY_PREFS: PolyPrefs = {
  laneOrder: DEFAULT_LANE_ORDER,
  chordLabels: "roman",
};

export interface PersistedPolyPrefs {
  laneOrder?: Partial<PolyLaneOrder>;
  chordLabels?: PolyChordLabels;
}

/** Defensive read: a hand-edited order still has to be a total order. */
export function parsePrefs(
  raw: PersistedPolyPrefs | null | undefined,
): PolyPrefs {
  return {
    laneOrder: normaliseLaneOrder(raw?.laneOrder),
    chordLabels: raw?.chordLabels === "letter" ? "letter" : "roman",
  };
}

export function serializePrefs(prefs: PolyPrefs): PersistedPolyPrefs {
  return { laneOrder: prefs.laneOrder, chordLabels: prefs.chordLabels };
}

/** Stage placements and frames, per song. */
export interface PersistedPolyStage {
  stage?: Record<string, Placements>;
  frames?: Record<string, PolyFrame[]>;
  /** Node keys parked in the docked shelf — a place OFF the canvas (§0.16). */
  parked?: Record<string, string[]>;
}

/** Defensive read for frames: a rect that is not a rect is not a frame. */
export function parseFrames(
  raw: PersistedPolyStage | null | undefined,
): Record<string, PolyFrame[]> {
  const frames: Record<string, PolyFrame[]> = {};
  for (const [songId, list] of Object.entries(raw?.frames ?? {})) {
    if (!Array.isArray(list)) continue;
    const clean = list.filter((frame): frame is PolyFrame => {
      if (!frame || typeof frame.id !== "string") return false;
      return [frame.x, frame.y, frame.w, frame.h].every((value) =>
        Number.isFinite(value),
      );
    });
    if (clean.length > 0) frames[songId] = clean;
  }
  return frames;
}

/**
 * Defensive read: one malformed entry must not blank every placement.
 *
 * Also the **migration**: until §0.16 the shelf was a band of canvas, and a
 * parked column was a placement whose `dy` put it there. Those entries become
 * "parked" here and leave the stage, so a saved shelf survives the shelf
 * becoming chrome — and, because the loading `dy` for every node was the same
 * constant, the test is exact rather than heuristic.
 */
export function parseStage(
  raw: PersistedPolyStage | null | undefined,
): Record<string, Placements> {
  const stage: Record<string, Placements> = {};
  for (const [songId, placements] of Object.entries(raw?.stage ?? {})) {
    if (!placements || typeof placements !== "object") continue;
    const clean: Placements = {};
    for (const [sectionId, placement] of Object.entries(placements)) {
      if (!placement) continue;
      const dx = Number(placement.dx);
      const dy = Number(placement.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      if (dy >= LEGACY_SHELF_DY - 1) continue;
      if (isPlaced({ dx, dy })) clean[sectionId] = { dx, dy };
    }
    if (Object.keys(clean).length > 0) stage[songId] = clean;
  }
  return stage;
}

/** The node keys a saved stage had on the old world-space shelf. */
export function migrateShelfPlacements(
  raw: PersistedPolyStage | null | undefined,
): Record<string, string[]> {
  const parked: Record<string, string[]> = {};
  for (const [songId, placements] of Object.entries(raw?.stage ?? {})) {
    if (!placements || typeof placements !== "object") continue;
    const keys = Object.entries(placements)
      .filter(([, placement]) => {
        const dy = Number(placement?.dy);
        return Number.isFinite(dy) && dy >= LEGACY_SHELF_DY - 1;
      })
      .map(([key]) => key);
    if (keys.length > 0) parked[songId] = keys;
  }
  return parked;
}

/** Defensive read for the parked list: keys only, de-duplicated. */
export function parseParked(
  raw: PersistedPolyStage | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...migrateShelfPlacements(raw) };
  for (const [songId, keys] of Object.entries(raw?.parked ?? {})) {
    if (!Array.isArray(keys)) continue;
    const clean = [...new Set(keys.filter((key) => typeof key === "string"))];
    if (clean.length === 0) continue;
    const merged = new Set([...(out[songId] ?? []), ...clean]);
    out[songId] = [...merged];
  }
  return out;
}

export function serializeStage(
  stage: Record<string, Placements>,
  frames: Record<string, PolyFrame[]> = {},
  parked: Record<string, string[]> = {},
): PersistedPolyStage {
  return { stage, frames, parked };
}

/** Defensive read: a hand-edited or half-written key must not put NaN into
 *  the camera and blank the canvas. */
export function parseCameras(
  raw: PersistedPolyCamera | null | undefined,
): Record<string, PolyCamera> {
  const cameras: Record<string, PolyCamera> = {};
  for (const [songId, camera] of Object.entries(raw?.cameras ?? {})) {
    if (!camera) continue;
    cameras[songId] = clampCamera({
      x: Number(camera.x ?? DEFAULT_CAMERA.x),
      y: Number(camera.y ?? DEFAULT_CAMERA.y),
      zoom: Number(camera.zoom ?? DEFAULT_CAMERA.zoom),
    });
  }
  return cameras;
}

export function serializeCameras(
  cameras: Record<string, PolyCamera>,
): PersistedPolyCamera {
  return { cameras };
}

const persist = createDebouncedWriter<PersistedPolyCamera>(
  STORAGE_KEYS.polyCamera.key,
  300,
);
const persistStage = createDebouncedWriter<PersistedPolyStage>(
  STORAGE_KEYS.polyStage.key,
  300,
);
const persistPrefs = createDebouncedWriter<PersistedPolyPrefs>(
  STORAGE_KEYS.polyPrefs.key,
  300,
);

interface PolyState {
  cameras: Record<string, PolyCamera>;
  cameraFor: (songId: string | undefined) => PolyCamera;
  setCamera: (songId: string, camera: PolyCamera) => void;
  /** Stage plane: where a section has been lifted to, keyed by section id. */
  stage: Record<string, Placements>;
  frames: Record<string, PolyFrame[]>;
  placementsFor: (songId: string | undefined) => Placements;
  placeSection: (
    songId: string,
    sectionId: string,
    dx: number,
    dy: number,
  ) => void;
  clearPlacement: (songId: string, sectionId: string) => void;
  clearStage: (songId: string) => void;
  /** Drop every placement belonging to one section — the section-wide key AND
   *  any per-pass keys, so "lift all passes" cannot leave one pass behind. */
  clearSectionPlacements: (songId: string, sectionId: string) => void;
  /** Sections parked in the docked shelf — off the canvas, still in the song. */
  parked: Record<string, string[]>;
  parkedFor: (songId: string | undefined) => string[];
  isParked: (songId: string, key: string) => boolean;
  parkSection: (songId: string, key: string) => void;
  unparkSection: (songId: string, key: string) => void;
  framesFor: (songId: string | undefined) => PolyFrame[];
  addFrame: (songId: string, frame: PolyFrame) => void;
  removeFrame: (songId: string, frameId: string) => void;
  /** Reading preferences: device-global, not per song. */
  prefs: PolyPrefs;
  /** Move a lane one place within its own side. Crossing the spine is not
   *  offered: it changes the canvas height, and every saved placement with it. */
  moveLane: (lane: PolyLaneId, direction: -1 | 1) => void;
  setLaneOrder: (order: PolyLaneOrder) => void;
  setChordLabels: (mode: PolyChordLabels) => void;
  resetPrefs: () => void;
}

export const usePolyStore = create<PolyState>((set, get) => ({
  prefs: parsePrefs(
    readStorage<PersistedPolyPrefs>(STORAGE_KEYS.polyPrefs.key, {}),
  ),

  setLaneOrder: (order) => {
    const laneOrder = normaliseLaneOrder(order);
    const prefs = { ...get().prefs, laneOrder };
    set({ prefs });
    persistPrefs.write(serializePrefs(prefs));
  },

  moveLane: (lane, direction) => {
    const { laneOrder } = get().prefs;
    const side = lanesOnSide("above").includes(lane) ? "above" : "below";
    const list = [...laneOrder[side]];
    const from = list.indexOf(lane);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, ...list.splice(from, 1));
    get().setLaneOrder({ ...laneOrder, [side]: list });
  },

  setChordLabels: (mode) => {
    const prefs = { ...get().prefs, chordLabels: mode };
    set({ prefs });
    persistPrefs.write(serializePrefs(prefs));
  },

  resetPrefs: () => {
    set({ prefs: DEFAULT_POLY_PREFS });
    persistPrefs.write(serializePrefs(DEFAULT_POLY_PREFS));
  },

  cameras: parseCameras(
    readStorage<PersistedPolyCamera>(STORAGE_KEYS.polyCamera.key, {}),
  ),

  cameraFor: (songId) =>
    songId ? (get().cameras[songId] ?? DEFAULT_CAMERA) : DEFAULT_CAMERA,

  setCamera: (songId, camera) => {
    const next = clampCamera(camera);
    const current = get().cameras[songId];
    if (
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.zoom === next.zoom
    )
      return;
    const cameras = { ...get().cameras, [songId]: next };
    set({ cameras });
    persist.write(serializeCameras(cameras));
  },

  stage: parseStage(
    readStorage<PersistedPolyStage>(STORAGE_KEYS.polyStage.key, {}),
  ),

  frames: parseFrames(
    readStorage<PersistedPolyStage>(STORAGE_KEYS.polyStage.key, {}),
  ),

  parked: parseParked(
    readStorage<PersistedPolyStage>(STORAGE_KEYS.polyStage.key, {}),
  ),

  parkedFor: (songId) => (songId ? (get().parked[songId] ?? []) : []),

  isParked: (songId, key) => (get().parked[songId] ?? []).includes(key),

  parkSection: (songId, key) => {
    const list = get().parked[songId] ?? [];
    if (list.includes(key)) return;
    const parked = { ...get().parked, [songId]: [...list, key] };
    set({ parked });
    persistStage.write(serializeStage(get().stage, get().frames, parked));
  },

  unparkSection: (songId, key) => {
    const list = get().parked[songId];
    if (!list || !list.includes(key)) return;
    const next = list.filter((entry) => entry !== key);
    const parked = { ...get().parked };
    if (next.length > 0) parked[songId] = next;
    else delete parked[songId];
    set({ parked });
    persistStage.write(serializeStage(get().stage, get().frames, parked));
  },

  framesFor: (songId) => (songId ? (get().frames[songId] ?? []) : []),

  addFrame: (songId, frame) => {
    const list = [...(get().frames[songId] ?? []), frame];
    const frames = { ...get().frames, [songId]: list };
    set({ frames });
    persistStage.write(serializeStage(get().stage, frames, get().parked));
  },

  removeFrame: (songId, frameId) => {
    const list = get().frames[songId];
    if (!list) return;
    const next = list.filter((frame) => frame.id !== frameId);
    const frames = { ...get().frames };
    if (next.length > 0) frames[songId] = next;
    else delete frames[songId];
    set({ frames });
    persistStage.write(serializeStage(get().stage, frames, get().parked));
  },

  placementsFor: (songId) => (songId ? (get().stage[songId] ?? {}) : {}),

  placeSection: (songId, sectionId, dx, dy) => {
    const snapped = snapPlacement(dx, dy);
    const song = { ...(get().stage[songId] ?? {}) };
    if (isPlaced(snapped)) song[sectionId] = snapped;
    else delete song[sectionId];
    const stage = { ...get().stage };
    if (Object.keys(song).length > 0) stage[songId] = song;
    else delete stage[songId];
    set({ stage });
    persistStage.write(serializeStage(stage, get().frames, get().parked));
  },

  clearPlacement: (songId, sectionId) => {
    const song = get().stage[songId];
    if (!song || !song[sectionId]) return;
    const nextSong = { ...song };
    delete nextSong[sectionId];
    const stage = { ...get().stage };
    if (Object.keys(nextSong).length > 0) stage[songId] = nextSong;
    else delete stage[songId];
    set({ stage });
    persistStage.write(serializeStage(stage, get().frames, get().parked));
  },

  clearSectionPlacements: (songId, sectionId) => {
    const song = get().stage[songId];
    if (!song) return;
    const prefix = `${sectionId}#`;
    const nextSong: Placements = {};
    for (const [key, placement] of Object.entries(song)) {
      if (key === sectionId || key.startsWith(prefix)) continue;
      nextSong[key] = placement;
    }
    if (Object.keys(nextSong).length === Object.keys(song).length) return;
    const stage = { ...get().stage };
    if (Object.keys(nextSong).length > 0) stage[songId] = nextSong;
    else delete stage[songId];
    set({ stage });
    persistStage.write(serializeStage(stage, get().frames, get().parked));
  },

  clearStage: (songId) => {
    // Tidy takes the furniture with the placements: a frame with nothing in it
    // is a rectangle that says "I forgot to select", and a shelf with something
    // in it is a section the song is not playing in its place.
    if (!get().stage[songId] && !get().frames[songId] && !get().parked[songId])
      return;
    const stage = { ...get().stage };
    delete stage[songId];
    const frames = { ...get().frames };
    delete frames[songId];
    const parked = { ...get().parked };
    delete parked[songId];
    set({ stage, frames, parked });
    persistStage.write(serializeStage(stage, frames, parked));
  },
}));
