import { describe, expect, it } from "vitest";
import { POLY_LANES, type PolyLaneId } from "./layout";
import {
  LANE_EDITOR,
  laneEditorPath,
  laneEditorTitle,
  VIEW_RAIL_PATHS,
} from "./laneEditor";

/**
 * The gutter and the view rail are two surfaces naming the same screens
 * (§S1.2). These tests are the merge: a lane cannot point at a route the rail
 * does not have, and every lane has an answer — even if the answer is "the
 * harmony screen, because the bass is a voice of the progression".
 */
describe("laneEditor", () => {
  it("gives every canvas lane an editor", () => {
    for (const lane of POLY_LANES) {
      expect(LANE_EDITOR[lane.id]).toBeDefined();
    }
  });

  it("only points at routes the view rail actually has", () => {
    for (const lane of POLY_LANES) {
      expect(VIEW_RAIL_PATHS).toContain(LANE_EDITOR[lane.id].path);
    }
  });

  it("does not invent a lane the canvas does not draw", () => {
    const drawn = new Set(POLY_LANES.map((lane) => lane.id));
    for (const id of Object.keys(LANE_EDITOR) as PolyLaneId[]) {
      expect(drawn.has(id)).toBe(true);
    }
  });

  it("builds the song route the rail uses", () => {
    expect(laneEditorPath("abc", "drums")).toBe("/song/abc/drums");
    expect(laneEditorPath("abc", "chords")).toBe("/song/abc/harmony");
  });

  it("says why, so the arrow is not a mystery", () => {
    // The two lanes that share Harmony have to differ in their tooltip, or the
    // arrow looks like a mistake on one of them.
    expect(laneEditorTitle("bass")).toContain("Harmony");
    expect(laneEditorTitle("chords")).toContain("Harmony");
    expect(laneEditorTitle("bass")).not.toBe(laneEditorTitle("chords"));
    expect(laneEditorTitle("drums")).toContain("Drums");
  });

  it("agrees with the rail's own label for the same screen", () => {
    // "lyrics" the path, "Lyrics" the view — a case difference would read as a
    // different feature to anyone reading both.
    expect(LANE_EDITOR.lyric.label).toBe("Lyrics");
    expect(LANE_EDITOR.melody.label).toBe("Melody");
    expect(LANE_EDITOR.drums.label).toBe("Drums");
  });
});
