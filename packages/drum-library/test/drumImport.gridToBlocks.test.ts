import { describe, expect, it } from "vitest";
import { gridToBlocks, transitionVector, type DrumGrid, type GridBar } from "../src/drumImport/gridToBlocks.js";
import { nearestVelocityPreset, toSectionPatch } from "../src/drumImport/sectionPatch.js";

const v = (s: string, vel = 100): number[] => [...s].map((c) => (c === "x" ? vel : 0));

// generic rock verse: kick 1&3, snare 2&4, straight 8th hats
const verse: GridBar = { lanes: { kick: v("x.......x......."), snare: v("....x.......x..."), hat: v("x.x.x.x.x.x.x.x.") } };
// last verse bar: kick drops after beat 2, snare rolls off beat 3
const verseFill: GridBar = { lanes: { kick: v("x..............."), snare: v("....x.....xxxxxx"), hat: v("x.x.x.x.x.x.x.x.") } };
// chorus: four-on-the-floor kick + same backbeat/hats (denser)
const chorus: GridBar = { lanes: { kick: v("x...x...x...x..."), snare: v("....x.......x..."), hat: v("x.x.x.x.x.x.x.x.") } };

const grid: DrumGrid = {
  beatsPerBar: 4,
  stepsPerBar: 16,
  bars: [verse, verse, verse, verseFill, chorus, chorus, chorus, chorus],
};
const sections = [
  { id: "verse", role: "verse", startBar: 0, bars: 4 },
  { id: "chorus", role: "chorus", startBar: 4, bars: 4 },
];

describe("gridToBlocks", () => {
  const out = gridToBlocks(grid, sections);
  const verseOut = out[0];
  const chorusOut = out[1];

  it("labels the repeats as groove and the deviating bar as a fill starting on beat 3", () => {
    expect(verseOut.bars.map((b) => b.kind)).toEqual(["groove", "groove", "groove", "fill"]);
    expect(verseOut.bars[3].fillStartBeat).toBe(2);
    expect(chorusOut.bars.every((b) => b.kind === "groove")).toBe(true);
  });

  it("encodes a groove bar as one euclid block per lane", () => {
    const bar0 = verseOut.blocks.filter((b) => b.mode === "euclid" && b.startBeat === 0 && b.endBeat === 4);
    expect(bar0.map((b) => b.lane).sort()).toEqual(["hat", "kick", "snare"]);
    const snare = bar0.find((b) => b.lane === "snare")!;
    expect(snare.euclid).toEqual({ k: 2, n: 16, rotation: 4 });
    expect(snare.id).toBe("blk-snare-0-4-euclid");
  });

  it("splits a fill bar at the deviating beat, in section-relative beats", () => {
    const bar3 = verseOut.blocks.filter((b) => b.startBeat >= 12 && b.mode !== "motion");
    const spans = new Set(bar3.map((b) => `${b.startBeat}-${b.endBeat}`));
    expect(spans).toEqual(new Set(["12-14", "14-16"]));
    // the groove half is still clean euclid
    const hat = bar3.find((b) => b.lane === "hat" && b.startBeat === 12)!;
    expect(hat.mode).toBe("euclid");
    // kick is silent in the fill half → an EMPTY steps block, so the base
    // groove can't leak through (euclid k=0 isn't expressible)
    const kickClear = bar3.find((b) => b.lane === "kick" && b.startBeat === 14)!;
    expect(kickClear.mode).toBe("steps");
    expect(kickClear.notes).toEqual([]);
  });

  it("falls back to an exact steps block when no euclid fit is close enough", () => {
    const strict = gridToBlocks(grid, sections, { fillTolerance: 0 });
    const roll = strict[0].blocks.find((b) => b.lane === "snare" && b.startBeat === 14 && b.mode === "steps")!;
    expect(roll.notes!.map((n) => n.beat)).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    expect(roll.notes![0].velocity).toBe(100);
    expect(roll.notes![0].voice).toBe("snare");
  });

  it("plays steps notes on the lane's primary kit voice (hat → closedHat)", () => {
    const odd: GridBar = { lanes: { hat: v("x..x.x...x.x..x.") } };
    const g: DrumGrid = { beatsPerBar: 4, stepsPerBar: 16, bars: [odd, odd] };
    const o = gridToBlocks(g, [{ id: "s", startBar: 0, bars: 2 }], { euclidTolerance: 0 })[0];
    const hat = o.blocks.find((b) => b.lane === "hat" && b.mode === "steps" && (b.notes?.length ?? 0) > 0)!;
    expect(hat.notes![0].voice).toBe("closedHat");
  });

  it("reports the fill as a build transition without writing a motion block", () => {
    expect(verseOut.blocks.some((b) => b.mode === "motion")).toBe(false);
    expect(verseOut.transitions).toHaveLength(1);
    const t = verseOut.transitions[0];
    expect([t.kind, t.gesture, t.startBeat, t.endBeat]).toEqual(["fill", "build", 14, 16]);
    expect(t.x).toBeGreaterThan(0);
    expect(t.y).toBeGreaterThan(0);
  });

  it("emits no transitions for a steady final section", () => {
    expect(chorusOut.transitions).toHaveLength(0);
  });

  it("in motion mode the motion block REPLACES the fill's own blocks", () => {
    const m = gridToBlocks(grid, sections, { fillEncoding: "motion" })[0];
    const inFill = m.blocks.filter((b) => b.startBeat >= 14 && b.endBeat <= 16 && b.lane !== "rim" && b.lane !== "cym" && b.lane !== "tom");
    // nothing but the motion block lives in [14,16) — otherwise motion would
    // win the id-sorted tie and silently erase the fill
    expect(inFill.map((b) => b.id)).toEqual(["blk-snare-14-16-motion"]);
    expect(m.stats.motionBlocks).toBe(1);
    // the groove half of the bar is untouched
    expect(m.blocks.some((b) => b.id === "blk-snare-12-14-euclid")).toBe(true);
  });

  it("is idempotent: unique, deterministic ids", () => {
    const ids = verseOut.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(gridToBlocks(grid, sections)[0].blocks.map((b) => b.id)).toEqual(ids);
  });

  it("sets the velocity from the hits", () => {
    expect(verseOut.velocity).toBe(100);
  });

  it("merges consecutive silent bars into one clear block per lane", () => {
    const silent: GridBar = { lanes: { kick: v("................"), snare: v("................"), hat: v("................") } };
    const g: DrumGrid = { beatsPerBar: 4, stepsPerBar: 16, bars: [verse, silent, silent, verse] };
    const o = gridToBlocks(g, [{ id: "s", startBar: 0, bars: 4 }])[0];
    const kickClears = o.blocks.filter((b) => b.lane === "kick" && b.mode === "steps");
    expect(kickClears.map((b) => `${b.startBeat}-${b.endBeat}`)).toEqual(["4-12"]);
    expect(o.bars.map((b) => b.kind)).toEqual(["groove", "silent", "silent", "groove"]);
  });

  it("clears the three lanes we don't import across the whole section by default", () => {
    const wipes = verseOut.blocks.filter((b) => b.mode === "steps" && b.startBeat === 0 && b.endBeat === 16);
    expect(wipes.map((b) => b.lane).sort()).toEqual(["cym", "rim", "tom"]);
    expect(wipes.every((b) => b.notes!.length === 0)).toBe(true);
  });

  it("clearLanes narrows the wipe and clearBase:false turns clearing off", () => {
    const some = gridToBlocks(grid, sections, { clearLanes: ["tom"] })[0];
    expect(some.blocks.filter((b) => b.startBeat === 0 && b.endBeat === 16).map((b) => b.lane)).toEqual(["tom"]);
    const off = gridToBlocks(grid, sections, { clearBase: false })[0];
    expect(off.stats.clearBlocks).toBe(0);
    expect(off.blocks.some((b) => b.mode === "steps" && (b.notes?.length ?? 0) === 0)).toBe(false);
  });
});

describe("transitionVector", () => {
  it("names the four gestures", () => {
    expect(transitionVector(1.5, 20, true)!.gesture).toBe("build");
    expect(transitionVector(0.5, 8, false)!.gesture).toBe("thin");
    expect(transitionVector(0, 0, true)!.gesture).toBe("break");
    expect(transitionVector(1, 12, true)!.gesture).toBe("crescendo");
    expect(transitionVector(1, 12, false)).toBeNull();
  });
});

describe("sectionPatch", () => {
  it("maps the numeric velocity to the nearest preset", () => {
    expect(nearestVelocityPreset(100)).toBe("mf");
    expect(nearestVelocityPreset(118)).toBe("ff");
    expect(nearestVelocityPreset(125)).toBe("fff");
    expect(nearestVelocityPreset(1)).toBe("ppp");
  });

  it("defaults to a muted base — blocks compile over null since the Sprint A fix", () => {
    const patch = toSectionPatch(gridToBlocks(grid, sections)[0]);
    expect(patch.drumPattern).toBe("none");
    expect(patch.velocity).toBe("mf");
    expect(patch.drumBlocks.length > 0).toBe(true);
    expect(toSectionPatch(gridToBlocks(grid, sections)[0], { basePattern: "68" }).drumPattern).toBe("68");
  });
});
