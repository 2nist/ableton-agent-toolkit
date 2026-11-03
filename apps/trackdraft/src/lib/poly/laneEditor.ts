/**
 * Which editor owns each canvas lane (§S1.2).
 *
 * The canvas has a lane gutter — Lyric, Bass, Drums, Chords, Color, Melody —
 * and the shell has a view rail with neighbouring names. Two lists of the same
 * thing is how a workspace starts contradicting itself: rename one and the
 * other lies.
 *
 * So the mapping lives here once, and **the gutter points at the rail's own
 * routes** rather than inventing its own. Where a lane has no editor of its own
 * that is written down explicitly (`Bass` and `Color` are authored inside
 * Harmony; `Melody` has a route but the lane's controls are its own chips), so
 * "nothing happens" is a decision with a reason instead of an oversight.
 *
 * The gutter's *primary* click stays in the canvas — focus the lane and open
 * its tools. Opening the editor is the **second** verb, on the arrow. A header
 * is a stronger promise of "this row" than of "leave this screen", and a
 * navigation trap under the most-clicked label in the workspace is worse than
 * one extra pixel of arrow.
 */

import type { PolyLaneId } from "./layout";

export interface LaneEditor {
  /** Route suffix under `/song/:id/` — the SAME path the view rail uses. */
  path: string;
  /** What that screen is called in the rail, so the tooltip agrees with it. */
  label: string;
  /** Why this lane lives there. The tooltip's second half. */
  reason: string;
}

export const LANE_EDITOR: Record<PolyLaneId, LaneEditor> = {
  lyric: {
    path: "lyrics",
    label: "Lyrics",
    reason: "the words and their timing are edited there",
  },
  bass: {
    path: "harmony",
    label: "Harmony",
    reason: "the bass is a voice of the progression, so it is edited with one",
  },
  drums: {
    path: "drums",
    label: "Drums",
    reason: "the kit, the groove and the patterns live there",
  },
  chords: {
    path: "harmony",
    label: "Harmony",
    reason: "the progression is built and analysed there",
  },
  color: {
    path: "harmony",
    label: "Harmony",
    reason: "the colour chord is a layer of the progression",
  },
  melody: {
    path: "melody",
    label: "Melody",
    reason: "the captured line is edited there",
  },
};

/** `[/song/:id]/harmony` — the editor this lane belongs to. */
export function laneEditorPath(songId: string, lane: PolyLaneId): string {
  return `/song/${songId}/${LANE_EDITOR[lane].path}`;
}

/** The tooltip on the arrow: "Open Drums — the kit, the groove and the patterns
 *  live there". */
export function laneEditorTitle(lane: PolyLaneId): string {
  const editor = LANE_EDITOR[lane];
  return `Open ${editor.label} — ${editor.reason}`;
}

/** The rail's own view names, so a mismatch between the two surfaces is a test
 *  rather than a discovery. Kept as a list (not a set) because the rail's order
 *  is deliberate: Harmony, Drums, Lyrics, Melody. */
export const VIEW_RAIL_PATHS: readonly string[] = [
  "structure",
  "harmony",
  "drums",
  "lyrics",
  "melody",
];
