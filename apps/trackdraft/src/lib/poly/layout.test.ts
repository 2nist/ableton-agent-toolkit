import { describe, expect, it } from "vitest";
import type { BlueprintSection } from "../../types/blueprint";
import type { SectionSpan } from "../arrangement";
import type { PolyLaneId } from "./layout";
import {
  CONTENT_BASE_PX,
  CONTENT_SCALE_MAX,
  LEGACY_SHELF_DY,
  PLACEMENT_ROOM,
  DEFAULT_LANE_ORDER,
  POLY_BAR_W,
  POLY_COL_GAP,
  POLY_HEIGHT,
  POLY_LANES,
  POLY_LANE_BY_ID,
  POLY_MIN_COL_W,
  POLY_BOTTOM,
  POLY_SPINE_H,
  POLY_TOP,
  arrangeSections,
  laneGeometry,
  normaliseLaneOrder,
  nodesInView,
  nodeAtBeat,
  polyContentScale,
  resizeToBars,
  worldBounds,
} from "./layout";

type SpanOverrides = Partial<BlueprintSection> & {
  occurrenceIndex?: number;
  startBeat?: number;
  startBar?: number;
};

function span(overrides: SpanOverrides = {}): SectionSpan {
  const {
    occurrenceIndex = 0,
    startBeat = 0,
    startBar = 0,
    ...sectionOverrides
  } = overrides;
  const section: BlueprintSection = {
    id: "s1",
    name: "Verse 1",
    role: "verse",
    bars: 8,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...sectionOverrides,
  };
  return {
    sectionId: section.id,
    section,
    occurrenceIndex,
    startBeat,
    durationBeats: section.bars * 4,
    startBar,
    bars: section.bars,
  };
}

describe("arrangeSections", () => {
  it("encodes duration as width", () => {
    const layout = arrangeSections([
      span({ bars: 8 }),
      span({ id: "s2", bars: 16, startBeat: 32, startBar: 8 }),
    ]);
    expect(layout.nodes[0].w).toBe(8 * POLY_BAR_W);
    expect(layout.nodes[1].w).toBe(16 * POLY_BAR_W);
  });

  it("keeps a one-bar section clickable", () => {
    const layout = arrangeSections([span({ bars: 1 })]);
    expect(layout.nodes[0].w).toBe(POLY_MIN_COL_W);
  });

  it("places columns in play order with a gap", () => {
    const layout = arrangeSections([
      span({ id: "a", bars: 4 }),
      span({
        id: "b",
        name: "Chorus",
        role: "chorus",
        bars: 8,
        startBeat: 16,
        startBar: 4,
        occurrenceIndex: 0,
      }),
    ]);
    expect(layout.nodes.map((n) => n.ordinal)).toEqual([1, 2]);
    expect(layout.nodes[1].x).toBe(
      layout.nodes[0].x + layout.nodes[0].w + POLY_COL_GAP,
    );
  });

  it("gives every repeat pass a unique, stable key", () => {
    const layout = arrangeSections([
      span({ id: "chorus", name: "Chorus", bars: 8, occurrenceIndex: 0 }),
      span({
        id: "chorus",
        name: "Chorus",
        bars: 8,
        occurrenceIndex: 1,
        startBeat: 32,
        startBar: 8,
      }),
    ]);
    expect(layout.nodes.map((n) => n.key)).toEqual(["chorus#0", "chorus#1"]);
    expect(new Set(layout.nodes.map((n) => n.key)).size).toBe(2);
  });

  it("summarises what material each section holds", () => {
    const layout = arrangeSections([
      span({
        bars: 4,
        timeSignatureNumerator: 7,
        timeSignatureDenPower: 2,
        drumPattern: "standard",
        lyrics: "when the night comes",
      }),
    ]);
    expect(layout.nodes[0].facts).toEqual({
      chords: 0,
      drums: true,
      melody: false,
      lyrics: true,
      meter: "7/4",
    });
  });

  it("reports bounds over the whole arrangement", () => {
    const layout = arrangeSections([
      span({ bars: 4 }),
      span({ id: "b", bars: 8, startBeat: 16, startBar: 4 }),
    ]);
    expect(layout.bounds.x).toBe(0);
    expect(layout.bounds.w).toBe(layout.nodes[1].x + layout.nodes[1].w);
    expect(layout.totalBars).toBe(12);
  });

  it("labels each column in seconds when a tempo is known", () => {
    const layout = arrangeSections([span({ startBeat: 64 })], { bpm: 120 });
    expect(layout.nodes[0].startSeconds).toBeCloseTo(32, 10);
  });

  it("emits one bar tick per whole bar, numbered from the arrangement", () => {
    const layout = arrangeSections([
      span({ bars: 2, startBar: 0 }),
      span({ id: "b", bars: 3, startBar: 2, startBeat: 8 }),
    ]);
    expect(layout.barTicks.map((t) => t.bar)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.barTicks[0].x).toBe(0);
    expect(layout.barTicks[1].x).toBeCloseTo(layout.nodes[0].w / 2, 10);
  });
});

describe("beatToX", () => {
  const layout = arrangeSections([
    span({ bars: 4 }),
    span({ id: "b", bars: 8, startBeat: 16, startBar: 4 }),
  ]);

  it("maps a span's first beat to its left edge", () => {
    expect(layout.beatToX(0)).toBe(layout.nodes[0].x);
    expect(layout.beatToX(16)).toBe(layout.nodes[1].x);
  });

  it("interpolates inside a span", () => {
    expect(layout.beatToX(8)).toBeCloseTo(
      layout.nodes[0].x + layout.nodes[0].w / 2,
      10,
    );
  });

  it("clamps outside the arrangement instead of extrapolating", () => {
    expect(layout.beatToX(-12)).toBe(layout.nodes[0].x);
    const last = layout.nodes[1];
    expect(layout.beatToX(999)).toBe(last.x + last.w);
  });

  it("is monotonic across the whole song", () => {
    let previous = -Infinity;
    for (let beat = 0; beat <= 48; beat += 0.25) {
      const x = layout.beatToX(beat);
      expect(x).toBeGreaterThanOrEqual(previous);
      previous = x;
    }
  });
});

describe("nodeAtBeat", () => {
  const layout = arrangeSections([
    span({ bars: 4 }),
    span({ id: "b", bars: 8, startBeat: 16, startBar: 4 }),
  ]);
  it("finds the sounding node and nothing in a gap", () => {
    expect(nodeAtBeat(layout.nodes, 0)?.sectionId).toBe("s1");
    expect(nodeAtBeat(layout.nodes, 15.9)?.sectionId).toBe("s1");
    expect(nodeAtBeat(layout.nodes, 16)?.sectionId).toBe("b");
    expect(nodeAtBeat(layout.nodes, 48)).toBeNull();
  });
});

describe("the spine and its lanes", () => {
  it("stacks every lane away from a centred spine", () => {
    const half = POLY_SPINE_H / 2;
    for (const lane of POLY_LANES) {
      const rect = POLY_LANE_BY_ID.get(lane.id)!;
      expect(rect).toBeDefined();
      if (lane.side === "above") {
        expect(rect.y + rect.h).toBeLessThanOrEqual(-half + 1e-9);
      } else {
        expect(rect.y).toBeGreaterThanOrEqual(half - 1e-9);
      }
    }
  });

  it("keeps the lanes in the requested reading order", () => {
    const y = (id: Parameters<typeof POLY_LANE_BY_ID.get>[0]) =>
      POLY_LANE_BY_ID.get(id)!.y;
    // Above the spine: drums nearest, then bass, then lyric.
    expect(y("drums")).toBeGreaterThan(y("bass"));
    expect(y("bass")).toBeGreaterThan(y("lyric"));
    // Below: chords nearest, then colour, then melody.
    expect(y("chords")).toBeLessThan(y("color"));
    expect(y("color")).toBeLessThan(y("melody"));
  });

  it("makes every section a band crossing all the lanes", () => {
    const layout = arrangeSections([span({ bars: 4 })]);
    const node = layout.nodes[0];
    expect(node.y).toBe(layout.bounds.y);
    expect(node.h).toBe(POLY_HEIGHT);
    expect(node.h).toBeGreaterThan(POLY_SPINE_H);
  });
});

describe("resizeToBars", () => {
  it("snaps a drag to whole bars at the current zoom", () => {
    // 96 world units per bar at 0.5 → 48px per bar.
    expect(resizeToBars(8, 96, 0.5)).toBe(10);
    expect(resizeToBars(8, 70, 0.5)).toBe(9);
    expect(resizeToBars(8, -40, 0.5)).toBe(7);
  });

  it("never shrinks below one bar and never runs away", () => {
    expect(resizeToBars(8, -10000, 0.5)).toBe(1);
    expect(resizeToBars(8, 100000, 0.5)).toBe(128);
  });

  it("ignores a degenerate zoom", () => {
    expect(resizeToBars(8, 500, 0)).toBe(8);
  });
});

describe("empty songs", () => {
  it("returns a zero-size layout rather than throwing", () => {
    const layout = arrangeSections([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.bounds.w).toBe(0);
    expect(layout.beatToX(4)).toBe(0);
  });
});

describe("a long song", () => {
  /** Forty sections, the size where "just render everything" stops working. */
  const long = arrangeSections(
    Array.from({ length: 40 }, (_, index) =>
      span({
        id: `s${index}`,
        name: `Section ${index + 1}`,
        startBeat: index * 32,
        startBar: index * 8 + 1,
        bars: 8,
        occurrenceIndex: 0,
      }),
    ),
  );

  it("lays forty columns out end to end without overlaps", () => {
    expect(long.nodes).toHaveLength(40);
    for (let index = 1; index < long.nodes.length; index += 1) {
      expect(long.nodes[index].x).toBeGreaterThan(long.nodes[index - 1].x);
      expect(long.nodes[index].x).toBeGreaterThanOrEqual(
        long.nodes[index - 1].x + long.nodes[index - 1].w,
      );
    }
    expect(long.nodes[39].x + long.nodes[39].w).toBeLessThanOrEqual(
      long.bounds.w,
    );
  });

  it("mounts one section at the standard view instead of forty", () => {
    // 50% on a ~470px canvas: one 8-bar column is 384px wide.
    const visible = { x: long.nodes[20].x - 235, y: -345, w: 470, h: 690 };
    const mounted = nodesInView(long.nodes, visible, 0.5);
    expect(mounted.length).toBeLessThanOrEqual(3);
    expect(mounted.map((node) => node.sectionId)).toContain("s20");
  });

  it("mounts everything when the whole song is framed", () => {
    const visible = { x: -50, y: -400, w: long.bounds.w + 100, h: 1200 };
    expect(nodesInView(long.nodes, visible, 0.5)).toHaveLength(40);
  });

  it("keeps a column just off-screen mounted, so panning does not pop", () => {
    const justLeft = {
      x: long.nodes[20].x + long.nodes[20].w,
      y: -345,
      w: 470,
      h: 690,
    };
    const mounted = nodesInView(long.nodes, justLeft, 0.5);
    expect(mounted.map((node) => node.sectionId)).toContain("s20");
  });
});

describe("the world is the song", () => {
  it("stacks lanes without gaps and centres them on the spine", () => {
    const heights = POLY_LANES.map((lane) => lane.height);
    // 1.35x the 554 units these were tuned at: rows that read at 50%.
    expect(heights).toEqual([114, 130, 120, 124, 76, 146]);
    expect(POLY_HEIGHT).toBe(
      heights.reduce((sum, h) => sum + h, 0) + POLY_SPINE_H,
    );
  });

  it("grows in length when the song grows, and not otherwise", () => {
    const short = arrangeSections([span({ id: "a", bars: 4 })]);
    const long = arrangeSections([
      span({ id: "a", bars: 4 }),
      span({ id: "b", bars: 8, occurrenceIndex: 1, startBeat: 16 }),
    ]);
    expect(worldBounds(long).w).toBeGreaterThan(worldBounds(short).w);
    expect(worldBounds(short).w).toBe(short.bounds.w);
    expect(worldBounds(short).h).toBe(worldBounds(long).h);
  });

  it("is the lane stack plus room to set something aside", () => {
    const layout = arrangeSections([span({ id: "a", bars: 4 })]);
    const world = worldBounds(layout);
    expect(world.y).toBe(POLY_TOP);
    expect(world.h).toBe(POLY_HEIGHT + PLACEMENT_ROOM);
    // A shelf's worth of canvas is gone: the world is far shorter than before.
    expect(world.h).toBeLessThan(POLY_HEIGHT * 2);
  });

  it("remembers where the old world-space shelf used to be", () => {
    // The migration in polyStore keys off this: any placement at or past it
    // was parked, before the shelf became chrome.
    expect(LEGACY_SHELF_DY).toBe(POLY_HEIGHT + 64);
  });
});

describe("polyContentScale", () => {
  it("grows content into a taller row, up to the height the rows bought", () => {
    expect(polyContentScale(140)).toBe(1);
    expect(polyContentScale(CONTENT_BASE_PX)).toBeCloseTo(1, 9);
    expect(polyContentScale(320)).toBeCloseTo(320 / CONTENT_BASE_PX, 9);
    expect(polyContentScale(10_000)).toBe(CONTENT_SCALE_MAX);
  });

  it("is monotone in zoom and never shrinks content below its base size", () => {
    const samples = [60, 120, 200, 280, 320, 400, 800];
    const scaled = samples.map((h) => polyContentScale(h));
    for (let i = 1; i < scaled.length; i += 1)
      expect(scaled[i]).toBeGreaterThanOrEqual(scaled[i - 1]);
    expect(Math.min(...scaled)).toBe(1);
  });

  it("survives a viewport that has not been measured", () => {
    expect(polyContentScale(0)).toBe(1);
    expect(polyContentScale(Number.NaN)).toBe(1);
  });
});

describe("laneGeometry", () => {
  const laneAt = (byId: ReadonlyMap<PolyLaneId, { y: number }>, id: string) =>
    byId.get(id as PolyLaneId)?.y ?? Number.NaN;

  it("stacks the default order nearest-the-spine first", () => {
    const { byId } = laneGeometry();
    expect(laneAt(byId, "drums")).toBe(-(POLY_SPINE_H / 2 + 120));
    expect(laneAt(byId, "bass")).toBe(-(POLY_SPINE_H / 2 + 120 + 130));
    expect(laneAt(byId, "chords")).toBe(POLY_SPINE_H / 2);
  });

  it("permutes offsets within a side and nothing else", () => {
    const flipped = laneGeometry({
      above: ["lyric", "bass", "drums"],
      below: ["melody", "color", "chords"],
    });
    const top = Math.min(...flipped.rects.map((rect) => rect.y));
    const bottom = Math.max(...flipped.rects.map((rect) => rect.y + rect.h));
    expect(top).toBe(POLY_TOP);
    expect(bottom).toBe(POLY_BOTTOM);
    // Lyric nearest the spine, drums furthest away — but the same totals.
    expect(laneAt(flipped.byId, "lyric")).toBe(-(POLY_SPINE_H / 2 + 114));
    expect(laneAt(flipped.byId, "bass")).toBe(-(POLY_SPINE_H / 2 + 114 + 130));
    expect(laneAt(flipped.byId, "drums")).toBe(POLY_TOP);
  });

  it("turns junk into a total order", () => {
    const order = normaliseLaneOrder({
      above: ["bass", "bass", "melody", 7, "nope"],
      below: "not an array",
    });
    expect(order.above).toEqual(["bass", "drums", "lyric"]);
    expect(order.below).toEqual(DEFAULT_LANE_ORDER.below);
    expect(normaliseLaneOrder(null)).toEqual(DEFAULT_LANE_ORDER);
  });

  it("never lets a lane land on the wrong side", () => {
    const order = normaliseLaneOrder({ above: ["chords"], below: ["drums"] });
    expect(order.above).toEqual(DEFAULT_LANE_ORDER.above);
    expect(order.below).toEqual(DEFAULT_LANE_ORDER.below);
  });
});

describe("tonality", () => {
  const song = { key: "C" as const, scale: "ionian" as const };

  it("is absent when no song key is supplied", () => {
    const layout = arrangeSections([span()]);
    expect(layout.nodes[0].tonality).toBeUndefined();
  });

  it("reads a section in the song's key by default", () => {
    const layout = arrangeSections([span()], song);
    expect(layout.nodes[0].tonality).toEqual({
      key: "C",
      scale: "ionian",
      own: false,
      modulations: 0,
    });
  });

  it("marks a section that carries its own key", () => {
    const layout = arrangeSections(
      [span({ key: "D", scale: "aeolian" })],
      song,
    );
    expect(layout.nodes[0].tonality).toMatchObject({
      key: "D",
      scale: "aeolian",
      own: true,
    });
  });

  it("counts mid-section modulations and ignores the opening home", () => {
    const layout = arrangeSections(
      [
        span({
          tonicRegions: [
            { startBeat: 0, key: "C", scale: "ionian", source: "authored" },
            { startBeat: 16, key: "D", scale: "dorian", source: "authored" },
            { startBeat: 32, key: "E", scale: "phrygian", source: "inferred" },
          ],
        }),
      ],
      song,
    );
    expect(layout.nodes[0].tonality?.modulations).toBe(2);
    // The opening home is the song's key, so the column is not "own".
    expect(layout.nodes[0].tonality?.own).toBe(false);
  });

  it("calls a scale-only override its own", () => {
    const layout = arrangeSections([span({ scale: "dorian" })], song);
    expect(layout.nodes[0].tonality).toMatchObject({
      key: "C",
      scale: "dorian",
      own: true,
    });
  });
});
