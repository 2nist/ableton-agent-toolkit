import { create } from "zustand";
import { readStorage, writeStorage } from "./storage";

/** Which desk of the Harmony workspace is open. A desk is a *place* — it
 *  changes what the canvas is for, not which page you are on. */
export type HarmonyDesk = "compose" | "rehearse" | "study";

/** Display-only transforms. None of these touch the song until the author
 *  explicitly commits them. */
export interface HarmonyDisplay {
  transpose: number;
  capo: number;
  simplify: boolean;
  nashville: boolean;
}

/** Rehearsal transport preferences — remembered across desks and sessions,
 *  because "I always count in" is a habit, not a per-song choice. */
export interface HarmonyTransport {
  countIn: boolean;
  click: boolean;
  loop: boolean;
}

/** How the chart is laid out. Four bars a line is the chart convention; eight
 *  fits a wide screen and halves the page turns. */
export interface HarmonyChartLayout {
  barsPerSystem: 4 | 8;
  /** Draw the beat grid (a column per beat, slashes where the chord holds). */
  beats: boolean;
}

interface HarmonyWorkspaceState {
  desk: HarmonyDesk;
  display: HarmonyDisplay;
  transport: HarmonyTransport;
  chartLayout: HarmonyChartLayout;
  setTransportToggle: (key: keyof HarmonyTransport) => void;
  setChartLayout: (patch: Partial<HarmonyChartLayout>) => void;
  setDesk: (desk: HarmonyDesk) => void;
  setTranspose: (semitones: number) => void;
  setCapo: (fret: number) => void;
  toggleSimplify: () => void;
  toggleNashville: () => void;
  resetDisplay: () => void;
}

const STORAGE_KEY = "trackdraft-harmony-workspace";

interface StoredShape {
  /** Bumped when a default changed in a way a stale value would contradict. */
  v?: number;
  desk?: HarmonyDesk;
  transport?: Partial<HarmonyTransport>;
  chartLayout?: Partial<HarmonyChartLayout>;
}

const STORED_VERSION = 2;

function readStored(): StoredShape {
  try {
    return readStorage<StoredShape>(STORAGE_KEY, {});
  } catch {
    return {};
  }
}

function persist(desk: HarmonyDesk, transport: HarmonyTransport, chartLayout: HarmonyChartLayout) {
  try {
    writeStorage(STORAGE_KEY, { v: STORED_VERSION, desk, transport, chartLayout });
  } catch {
    /* a preference is never worth breaking the workspace over */
  }
}

const stored = readStored();
// v1 shipped with `loop` on by default, which made "play" repeat the focused
// section forever — the chart's cursor never left the first bar. Anyone still
// on v1 gets the corrected default; every other preference is kept.
const storedTransport = stored.v === STORED_VERSION ? stored.transport : { ...stored.transport, loop: false };

export const useHarmonyWorkspaceStore = create<HarmonyWorkspaceState>((set) => ({
  desk: stored.desk ?? "compose",
  display: { transpose: 0, capo: 0, simplify: false, nashville: false },
  transport: { countIn: true, click: false, loop: false, ...storedTransport },
  chartLayout: { barsPerSystem: 4, beats: true, ...stored.chartLayout },

  setDesk: (desk) => {
    set((state) => {
      persist(desk, state.transport, state.chartLayout);
      return { desk };
    });
  },
  setTransportToggle: (key) =>
    set((state) => {
      const transport = { ...state.transport, [key]: !state.transport[key] };
      persist(state.desk, transport, state.chartLayout);
      return { transport };
    }),
  setChartLayout: (patch) =>
    set((state) => {
      const chartLayout = { ...state.chartLayout, ...patch };
      persist(state.desk, state.transport, chartLayout);
      return { chartLayout };
    }),
  setTranspose: (semitones) =>
    set((state) => ({
      display: { ...state.display, transpose: Math.max(-11, Math.min(11, semitones)) },
    })),
  setCapo: (fret) =>
    set((state) => ({ display: { ...state.display, capo: Math.max(0, Math.min(11, fret)) } })),
  toggleSimplify: () =>
    set((state) => ({ display: { ...state.display, simplify: !state.display.simplify } })),
  toggleNashville: () =>
    set((state) => ({ display: { ...state.display, nashville: !state.display.nashville } })),
  resetDisplay: () => set({ display: { transpose: 0, capo: 0, simplify: false, nashville: false } }),
}));
