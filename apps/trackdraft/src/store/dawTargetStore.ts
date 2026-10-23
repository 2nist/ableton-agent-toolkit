import { create } from "zustand";
import { readRawStorage, writeRawStorage } from "./storage";

/**
 * What TrackDraft is playing *into*. One setting, not two.
 *
 * This replaces the old `clockSource` in `songStore` ("internal" | "ableton")
 * because a clock source is a *consequence* of a target, not a peer of it:
 * choosing "Ableton" and choosing "app clock" separately let the two disagree
 * — exactly the drift `transportControl.ts` exists to prevent. Everything
 * downstream (clock, whether live MIDI out runs at all, which action is
 * primary in the export menu) now derives from this one value.
 */
export type DawTarget = "live" | "other" | "file";

export const DAW_TARGET_LABELS: Record<DawTarget, string> = {
  live: "Ableton Live",
  other: "Other DAW",
  file: "File only",
};

export const DAW_TARGET_DESCRIPTIONS: Record<DawTarget, string> = {
  live: "Follow Live's transport over osc-bridge — streamed parts land on Live's grid.",
  other: "TrackDraft keeps its own clock and streams the stems over MIDI — point any DAW at the port. Live's tempo is matched to the song's so the stream lands on its grid.",
  file: "Silent playhead. Export MIDI or JSON and work entirely in the other app.",
};

export const DAW_TARGETS: DawTarget[] = ["live", "other", "file"];

/** Compact labels for the transport bar, where "Ableton Live" doesn't fit. */
export const DAW_TARGET_SHORT: Record<DawTarget, string> = {
  live: "Live",
  other: "Other DAW",
  file: "File",
};

interface DawTargetState {
  target: DawTarget;
  setTarget: (target: DawTarget) => void;
}

const STORAGE_KEY = "trackdraft-daw-target";
/** What the clock source used to be stored under, so an existing choice
 *  survives the upgrade instead of snapping back to a default. */
const LEGACY_CLOCK_SOURCE_KEY = "trackdraft-clock-source";

function initialTarget(): DawTarget {
  const saved = readRawStorage(STORAGE_KEY);
  if (saved === "live" || saved === "other" || saved === "file") return saved;
  // "ableton" meant following Live; "internal" meant the app's own clock
  // with live MIDI out — which is what "other" is now.
  return readRawStorage(LEGACY_CLOCK_SOURCE_KEY) === "ableton" ? "live" : "other";
}

export const useDawTargetStore = create<DawTargetState>((set) => ({
  target: initialTarget(),
  setTarget: (target) => {
    set({ target });
    writeRawStorage(STORAGE_KEY, target);
  },
}));

/** True when the target can receive live MIDI. "File only" deliberately
 *  doesn't: a silent playhead is the whole point of it. */
export function targetStreamsMidi(target: DawTarget): boolean {
  return target !== "file";
}

/** True when the app's own clock is the master (everything but Live). */
export function targetUsesAppClock(target: DawTarget): boolean {
  return target !== "live";
}
