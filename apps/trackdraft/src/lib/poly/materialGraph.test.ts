import { describe, expect, it } from "vitest";
import {
  feedsText,
  materialCables,
  materialLabel,
  sectionMaterial,
  wireEdges,
} from "./materialGraph";

const chords = [
  { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
  { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
];

function section(overrides: Record<string, unknown> = {}) {
  return { chords, ...overrides } as Parameters<typeof sectionMaterial>[0];
}

describe("sectionMaterial — what a section is made of", () => {
  it("finds the always-derived lanes", () => {
    const graph = sectionMaterial(section(), { hasDrums: false });
    expect(graph.present).toEqual(["chords", "bass", "colour"]);
  });

  it("adds drums, melody and lyrics only when they exist", () => {
    const graph = sectionMaterial(
      section({
        melody: { notes: [{ startTime: 0, pitch: 60, duration: 1 }] },
        lyrics: "  a line  ",
      }),
      { hasDrums: true },
    );
    expect(graph.present).toContain("drums");
    expect(graph.present).toContain("melody");
    expect(graph.present).toContain("lyrics");
    expect(graph.present).not.toContain("clock");
  });

  it("treats blank lyrics as no lyrics", () => {
    expect(
      sectionMaterial(section({ lyrics: "   " }), { hasDrums: false }).present,
    ).not.toContain("lyrics");
  });

  it("puts the clock last, because it is not a lane", () => {
    const graph = sectionMaterial(
      section({
        timeDomain: { rate: 0.5 },
        melody: { notes: [{ startTime: 0, pitch: 60, duration: 1 }] },
      }),
      { hasDrums: true },
    );
    expect(graph.present[graph.present.length - 1]).toBe("clock");
  });

  it("declares drums from any drum field when the caller does not say", () => {
    expect(sectionMaterial(section()).present).not.toContain("drums");
    expect(
      sectionMaterial(section({ drumPattern: "rock/basic" })).present,
    ).toContain("drums");
    expect(
      sectionMaterial(
        section({
          drumBlocks: [
            { id: "b", lane: "kick", startBeat: 0, endBeat: 1, mode: "steps" },
          ],
        }),
      ).present,
    ).toContain("drums");
  });

  it("copes with no chords at all", () => {
    // A real song can have a chordless intro (A Hard Day's Night opens on drums
    // and lyrics). No chords means no bass to derive — the lane is silent, so it
    // is not part of the section's material.
    const graph = sectionMaterial(section({ chords: [] }), { hasDrums: false });
    expect(graph.present).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("keeps an AUTHORED bass in a chordless section", () => {
    const graph = sectionMaterial(
      section({
        chords: [],
        bassNotes: [{ startTime: 0, pitch: 36, duration: 1 }],
      }),
      { hasDrums: false },
    );
    expect(graph.present).toEqual(["bass"]);
  });
});

describe("sectionMaterial — the couplings", () => {
  it("says the bass is DERIVED when it is not authored", () => {
    const edge = sectionMaterial(section()).edges.find(
      (candidate) => candidate.to === "bass",
    );
    expect(edge?.kind).toBe("derives");
  });

  it("says the bass is AUTHORED when it carries notes", () => {
    const edge = sectionMaterial(
      section({ bassNotes: [{ startTime: 0, pitch: 36, duration: 1 }] }),
    ).edges.find((candidate) => candidate.to === "bass");
    expect(edge?.kind).toBe("authored");
    expect(edge?.reason).toContain("replaces");
  });

  it("draws the groove-glue edges the model has always had", () => {
    // The point of this slice: `grooveGlue` is a real drums → bass/chords
    // influence that no surface has ever shown.
    const graph = sectionMaterial(
      section({ grooveGlue: { bass: true, chords: true } }),
      { hasDrums: true },
    );
    const glued = graph.edges.filter((edge) => edge.kind === "glues");
    expect(glued.map((edge) => edge.to).sort()).toEqual(["bass", "chords"]);
    expect(glued.every((edge) => edge.from === "drums")).toBe(true);
  });

  it("draws harmony-follows-drums as the drums DRIVING the chords", () => {
    const graph = sectionMaterial(section({ harmonyFollowsDrums: true }), {
      hasDrums: true,
    });
    expect(
      graph.edges.find(
        (edge) => edge.to === "chords" && edge.kind === "drives",
      ),
    ).toBeDefined();
  });

  it("does not draw a glue edge when there are no drums to glue to", () => {
    const graph = sectionMaterial(section({ grooveGlue: { bass: true } }), {
      hasDrums: false,
    });
    expect(graph.edges.some((edge) => edge.kind === "glues")).toBe(false);
  });

  it("conducts drums and melody but not the derived bass", () => {
    // §P3.5: derived material follows the CONDUCTED chord stream, so a clock
    // edge into it would claim a coupling that does not exist.
    const graph = sectionMaterial(
      section({
        timeDomain: { rate: 0.5 },
        melody: { notes: [{ startTime: 0, pitch: 60, duration: 1 }] },
      }),
      { hasDrums: true },
    );
    const conducted = graph.edges.filter((edge) => edge.kind === "conducts");
    expect(conducted.map((edge) => edge.to).sort()).toEqual([
      "drums",
      "melody",
    ]);
  });

  it("conducts an authored bass, because it carries its own time", () => {
    const graph = sectionMaterial(
      section({
        timeDomain: { cycle: 8 },
        bassNotes: [{ startTime: 0, pitch: 36, duration: 1 }],
      }),
      { hasDrums: false },
    );
    expect(
      graph.edges.some((edge) => edge.from === "clock" && edge.to === "bass"),
    ).toBe(true);
  });

  it("gives every edge a reason", () => {
    const graph = sectionMaterial(
      section({
        timeDomain: { rate: 2 },
        grooveGlue: { bass: true, chords: true },
        harmonyFollowsDrums: true,
        bassNotes: [{ startTime: 0, pitch: 36, duration: 1 }],
        melody: { notes: [{ startTime: 0, pitch: 60, duration: 1 }] },
      }),
      { hasDrums: true },
    );
    expect(graph.edges.length).toBeGreaterThan(4);
    for (const edge of graph.edges) {
      expect(edge.reason.length).toBeGreaterThan(10);
      expect(edge.reason).not.toContain("undefined");
    }
  });
});

describe("wireEdges", () => {
  it("keeps only edges that have a lane at both ends", () => {
    const graph = sectionMaterial(section({ timeDomain: { rate: 2 } }), {
      hasDrums: true,
    });
    const wired = wireEdges(graph);
    expect(wired.length).toBeGreaterThan(0);
    // The clock has no lane of its own, so its edges are readouts, not wires.
    expect(wired.some((edge) => edge.from === "clock")).toBe(false);
  });
});

describe("feedsText", () => {
  it("names what feeds a lane", () => {
    const graph = sectionMaterial(section({ grooveGlue: { bass: true } }), {
      hasDrums: true,
    });
    expect(feedsText(graph, "bass")).toBe("Chords → derives · Drums → glues");
  });

  it("returns null for a root", () => {
    const graph = sectionMaterial(section(), { hasDrums: false });
    expect(feedsText(graph, "chords")).toBeNull();
  });
});

describe("materialLabel", () => {
  it("names every material", () => {
    expect(materialLabel("chords")).toBe("Chords");
    expect(materialLabel("clock")).toBe("Clock");
  });
});

describe("materialCables — the geometry the canvas draws", () => {
  // A lane map in world units: lanes stack downward, 100 tall, 10 apart.
  const lanes = new Map([
    ["lyric", { y: 0, h: 100 }],
    ["bass", { y: 110, h: 100 }],
    ["drums", { y: 220, h: 100 }],
    ["chords", { y: 330, h: 100 }],
  ]);

  it("draws from the source lane's centre to the target's", () => {
    const graph = sectionMaterial(section(), { hasDrums: false });
    const [cable] = materialCables(graph, lanes, 40);
    expect(cable).toMatchObject({
      from: "chords",
      to: "bass",
      kind: "derives",
    });
    expect(cable.x).toBe(40);
    expect(cable.y1).toBe(380);
    expect(cable.y2).toBe(160);
  });

  it("skips an edge whose lane is not on screen", () => {
    // The colour lane is a real material but this map has no `color` rect; an
    // edge drawn to a missing row would land on top of another lane.
    const graph = sectionMaterial(section(), { hasDrums: false });
    const cables = materialCables(graph, lanes, 0);
    expect(cables.some((cable) => cable.to === "colour")).toBe(false);
    expect(cables).toHaveLength(1);
  });

  it("draws the glue cable when both lanes exist", () => {
    const graph = sectionMaterial(section({ grooveGlue: { bass: true } }), {
      hasDrums: true,
    });
    const glued = materialCables(graph, lanes, 0).find(
      (cable) => cable.kind === "glues",
    );
    expect(glued).toMatchObject({ from: "drums", to: "bass" });
    expect(glued?.reason).toContain("pocket");
  });

  it("never draws a clock cable, because the clock has no lane", () => {
    const graph = sectionMaterial(section({ timeDomain: { rate: 0.5 } }), {
      hasDrums: true,
    });
    expect(
      materialCables(graph, lanes, 0).some((cable) => cable.from === "clock"),
    ).toBe(false);
  });

  it("returns nothing for a section with no couplings", () => {
    const graph = sectionMaterial(section({ chords: [] }), { hasDrums: false });
    expect(materialCables(graph, lanes, 0)).toEqual([]);
  });
});
