import { create } from "zustand";
import { readStorage, createDebouncedWriter } from "./storage";
import { STORAGE_KEYS } from "../lib/persistence/keys";
import {
  DEFAULT_SECTION_BAR_PX,
  DEFAULT_SONG_BAR_PX,
  clampBarPx,
  nextBarPx,
  SECTION_BAR_PX_STEPS,
  SONG_BAR_PX_STEPS,
  type TimeDepth,
} from "../lib/time/timeMath";

export const TIME_VIEWPORT_KEY = STORAGE_KEYS.timeViewport.key;

interface PersistedViewport {
  scales?: Partial<Record<TimeDepth, number>>;
  snap?: number;
}

const VALID_SNAP = [0, 0.25, 0.5, 1] as const;

function loadViewport(): { scales: Record<TimeDepth, number>; snap: number } {
  const raw = readStorage<PersistedViewport>(TIME_VIEWPORT_KEY, {});
  return {
    scales: {
      song: clampBarPx("song", raw.scales?.song ?? DEFAULT_SONG_BAR_PX),
      section: clampBarPx("section", raw.scales?.section ?? DEFAULT_SECTION_BAR_PX),
    },
    snap: VALID_SNAP.includes((raw.snap ?? 0.25) as (typeof VALID_SNAP)[number]) ? (raw.snap ?? 0.25) : 0.25,
  };
}

const persist = createDebouncedWriter<{ scales: Record<TimeDepth, number>; snap: number }>(
  TIME_VIEWPORT_KEY,
  300,
);

interface TimeViewportState {
  /** Pixels per bar, per depth, shared by every surface at that depth. */
  scales: Record<TimeDepth, number>;
  /** Last scroll position in bars, per depth — restored when a view remounts. */
  scrollBars: Record<TimeDepth, number>;
  /** Selection snap in beats; 0 = free. */
  snap: number;
  setScale: (depth: TimeDepth, barPx: number) => void;
  zoomStep: (depth: TimeDepth, direction: 1 | -1) => void;
  setScrollBar: (depth: TimeDepth, bar: number) => void;
  setSnap: (beats: number) => void;
}

const initial = loadViewport();

export const useTimeViewportStore = create<TimeViewportState>((set, get) => {
  const persistNow = () => persist.write({ scales: get().scales, snap: get().snap });

  return {
    scales: initial.scales,
    scrollBars: { song: 0, section: 0 },
    snap: initial.snap,

    setScale: (depth, barPx) => {
      const next = clampBarPx(depth, barPx);
      if (Math.abs(next - get().scales[depth]) < 1e-6) return;
      set({ scales: { ...get().scales, [depth]: next } });
      persistNow();
    },

    zoomStep: (depth, direction) => {
      const steps = depth === "song" ? SONG_BAR_PX_STEPS : SECTION_BAR_PX_STEPS;
      const next = nextBarPx(steps, get().scales[depth], direction);
      get().setScale(depth, next);
    },

    setScrollBar: (depth, bar) => {
      const next = Number.isFinite(bar) ? Math.max(0, bar) : 0;
      if (Math.abs(next - get().scrollBars[depth]) < 1e-6) return;
      set({ scrollBars: { ...get().scrollBars, [depth]: next } });
    },

    setSnap: (beats) => {
      if (!VALID_SNAP.includes(beats as (typeof VALID_SNAP)[number])) return;
      if (get().snap === beats) return;
      set({ snap: beats });
      persistNow();
    },
  };
});

/** Test helper — restores the in-memory store without touching storage. */
export function resetTimeViewportForTests(): void {
  useTimeViewportStore.setState({
    scales: { song: DEFAULT_SONG_BAR_PX, section: DEFAULT_SECTION_BAR_PX },
    scrollBars: { song: 0, section: 0 },
    snap: 0.25,
  });
}

/** Exposed for tests that need to assert persistence. */
export function flushTimeViewportPersistence(): void {
  const { scales, snap } = useTimeViewportStore.getState();
  persist.flush({ scales, snap });
}
