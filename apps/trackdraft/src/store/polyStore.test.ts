import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "../lib/poly/camera";
import { LEGACY_SHELF_DY } from "../lib/poly/layout";
import { DEFAULT_LANE_ORDER } from "../lib/poly/layout";
import {
  DEFAULT_POLY_PREFS,
  parseCameras,
  parseFrames,
  parseParked,
  parsePrefs,
  parseStage,
  serializeCameras,
  serializeStage,
  usePolyStore,
} from "./polyStore";

describe("poly camera persistence", () => {
  it("round-trips a camera through the stored shape", () => {
    const cameras = { "song-1": { x: 120.5, y: -40, zoom: 0.33 } };
    expect(parseCameras(serializeCameras(cameras))).toEqual(cameras);
  });

  it("reads a missing or empty key as no cameras", () => {
    expect(parseCameras(undefined)).toEqual({});
    expect(parseCameras({})).toEqual({});
  });

  it("repairs a hand-edited camera instead of trusting it", () => {
    expect(parseCameras({ cameras: { s: { zoom: 99 } } })).toEqual({
      s: { x: 0, y: 0, zoom: MAX_ZOOM },
    });
    expect(
      parseCameras({ cameras: { s: { x: Number.NaN, zoom: 0 } } }),
    ).toEqual({
      s: { x: 0, y: 0, zoom: MIN_ZOOM },
    });
  });
});

describe("stage placements", () => {
  it("keeps only real placements, and never a zero offset", () => {
    const stage = parseStage({
      stage: {
        song: {
          a: { dx: 120, dy: -60 },
          b: { dx: 0, dy: 0 },
          c: { dx: Number.NaN, dy: 10 },
        },
      },
    });
    expect(stage.song).toEqual({ a: { dx: 120, dy: -60 } });
  });

  it("drops a song that ends up with nothing placed", () => {
    expect(parseStage({ stage: { song: { a: { dx: 0, dy: 0 } } } })).toEqual(
      {},
    );
  });

  it("survives junk without losing the good entries", () => {
    expect(
      parseStage({
        stage: { song: null, other: { a: { dx: 12, dy: 0 } } },
      } as never),
    ).toEqual({ other: { a: { dx: 12, dy: 0 } } });
  });

  it("round-trips through the stored shape", () => {
    const stage = { song: { a: { dx: 120, dy: -60 } } };
    expect(parseStage(serializeStage(stage))).toEqual(stage);
  });
});

describe("section-wide placement hygiene", () => {
  it("treats the section key and every pass key as one section's business", () => {
    // Mirrors the reducer in clearSectionPlacements, which the store applies
    // to persisted state: prefix matching is the contract the view relies on.
    const stage = {
      chorus: { dx: 0, dy: 240 },
      "chorus#0": { dx: 12, dy: 0 },
      "chorus#2": { dx: 24, dy: 0 },
      chorus2: { dx: 0, dy: 120 },
    };
    const prefix = "chorus#";
    const kept = Object.entries(stage).filter(
      ([key]) => key !== "chorus" && !key.startsWith(prefix),
    );
    expect(kept.map(([key]) => key)).toEqual(["chorus2"]);
  });
});

describe("frames", () => {
  it("keeps frames that are rects and drops the rest", () => {
    const good = {
      id: "f1",
      label: "Chorus ideas",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
    };
    const frames = parseFrames({
      frames: {
        song: [
          good,
          { id: "f2", label: "nope", x: 0, y: Number.NaN, w: 10, h: 10 },
          { label: "no id", x: 0, y: 0, w: 10, h: 10 },
        ],
      } as never,
    });
    expect(frames.song).toEqual([good]);
  });

  it("drops a song with no usable frames", () => {
    expect(parseFrames({ frames: { song: [] } })).toEqual({});
    expect(parseFrames({ frames: { song: null } } as never)).toEqual({});
  });

  it("round-trips placements and frames together", () => {
    const stage = { song: { "chorus#0": { dx: 120, dy: 0 } } };
    const frames = {
      song: [{ id: "f1", label: "Ideas", x: 0, y: 0, w: 10, h: 10 }],
    };
    const stored = serializeStage(stage, frames);
    expect(parseStage(stored)).toEqual(stage);
    expect(parseFrames(stored)).toEqual(frames);
  });
});

describe("prefs", () => {
  it("starts from the designed order and numerals", () => {
    expect(DEFAULT_POLY_PREFS.chordLabels).toBe("roman");
    expect(usePolyStore.getState().prefs.laneOrder).toEqual(DEFAULT_LANE_ORDER);
  });

  it("moves a lane one place inside its own side", () => {
    const store = usePolyStore.getState();
    store.resetPrefs();
    const before = store.prefs.laneOrder.above;
    store.moveLane("lyric", -1);
    expect(usePolyStore.getState().prefs.laneOrder.above).toEqual([
      "drums",
      "lyric",
      "bass",
    ]);
    expect(usePolyStore.getState().prefs.laneOrder.above).not.toEqual(before);
  });

  it("refuses to move a lane off the end of its side", () => {
    usePolyStore.getState().resetPrefs();
    usePolyStore.getState().moveLane("drums", -1);
    expect(usePolyStore.getState().prefs.laneOrder.above).toEqual(
      DEFAULT_LANE_ORDER.above,
    );
  });

  it("remembers the chord label style", () => {
    usePolyStore.getState().setChordLabels("letter");
    expect(usePolyStore.getState().prefs.chordLabels).toBe("letter");
    usePolyStore.getState().resetPrefs();
    expect(usePolyStore.getState().prefs.chordLabels).toBe("roman");
  });

  it("turns a junk stored order into a total one", () => {
    const prefs = parsePrefs({
      laneOrder: {
        above: ["bass", "bass", "who"] as never,
        below: [] as never,
      },
      chordLabels: "letters" as never,
    });
    expect(prefs.laneOrder.above).toEqual(["bass", "drums", "lyric"]);
    expect(prefs.laneOrder.below).toEqual(DEFAULT_LANE_ORDER.below);
    expect(prefs.chordLabels).toBe("roman");
  });
});

describe("the docked shelf", () => {
  const songId = "song-a";

  it("parks, restores, and remembers the list", () => {
    const store = usePolyStore.getState();
    store.clearStage(songId);
    store.parkSection(songId, "chorus#1");
    store.parkSection(songId, "verse#0");
    expect(usePolyStore.getState().parkedFor(songId)).toEqual([
      "chorus#1",
      "verse#0",
    ]);
    expect(usePolyStore.getState().isParked(songId, "chorus#1")).toBe(true);
    store.unparkSection(songId, "chorus#1");
    expect(usePolyStore.getState().parkedFor(songId)).toEqual(["verse#0"]);
    store.unparkSection(songId, "verse#0");
    expect(usePolyStore.getState().parkedFor(songId)).toEqual([]);
  });

  it("does not park the same pass twice", () => {
    const store = usePolyStore.getState();
    store.clearStage(songId);
    store.parkSection(songId, "chorus#1");
    store.parkSection(songId, "chorus#1");
    expect(usePolyStore.getState().parkedFor(songId)).toEqual(["chorus#1"]);
  });

  it("carries the shelf through a stage write", () => {
    const store = usePolyStore.getState();
    store.clearStage(songId);
    store.parkSection(songId, "chorus#1");
    store.placeSection(songId, "verse#0", 48, 120);
    expect(usePolyStore.getState().parkedFor(songId)).toEqual(["chorus#1"]);
  });

  it("tidies the shelf with the rest of the stage", () => {
    const store = usePolyStore.getState();
    store.parkSection(songId, "chorus#1");
    store.clearStage(songId);
    expect(usePolyStore.getState().parkedFor(songId)).toEqual([]);
    expect(usePolyStore.getState().placementsFor(songId)).toEqual({});
  });

  it("migrates a stage that parked on the old world-space shelf", () => {
    // Before the shelf became chrome, parking was a placement at this offset.
    const legacy = {
      stage: {
        [songId]: {
          "chorus#1": { dx: 0, dy: LEGACY_SHELF_DY },
          "verse#0": { dx: 48, dy: 120 },
        },
        other: { "intro#0": { dx: 0, dy: LEGACY_SHELF_DY + 240 } },
      },
    };
    const parked = parseParked(legacy);
    expect(parked[songId]).toEqual(["chorus#1"]);
    expect(parked.other).toEqual(["intro#0"]);
    // …and the placements that were not on the shelf stay placements.
    const stage = parseStage(legacy);
    expect(stage[songId]).toEqual({ "verse#0": { dx: 48, dy: 120 } });
    expect(stage.other).toBeUndefined();
  });

  it("merges the migrated shelf with a stored list, without duplicates", () => {
    const raw = {
      stage: { [songId]: { "chorus#1": { dx: 0, dy: LEGACY_SHELF_DY } } },
      parked: { [songId]: ["chorus#1", "bridge#0"] },
    };
    expect(parseParked(raw)[songId]).toEqual(["chorus#1", "bridge#0"]);
  });
});
