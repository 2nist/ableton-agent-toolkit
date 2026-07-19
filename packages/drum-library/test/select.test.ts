import { describe, expect, it } from "vitest";
import { buildIndex, timeSignatureOf } from "../src/library-index.js";
import { selectGroove } from "../src/select.js";
import { grooveLengthBars, grooveLengthBeats, resolveGrooveNotes, tileGroove } from "../src/resolve.js";
import type { DrumNote, FeelFeatures, Limb, Segment, Take } from "../src/types.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;

const NEUTRAL_FEEL: FeelFeatures = {
  push: 0,
  looseness: 0,
  dynamics: 0,
  density: 0,
  syncopation: 0,
  swing: 0.5,
  weight: 0,
  brightness: 0,
  motion: 0,
};

function take(id: string, notes: DrumNote[], overrides: Partial<Take> = {}): Take {
  return {
    id,
    drummer: "drummer1",
    session: "drummer1/session1",
    style: "rock",
    bpm: 120,
    beatType: "beat",
    timeSignature: { numerator: 4, denominator: 4 },
    kitName: "Acoustic Kit",
    beatsPerBar: 4,
    notes,
    ...overrides,
  };
}

function segment(takeId: string, limb: Limb, feel: Partial<FeelFeatures>, lengthBars = 1, noteCount = 4): Segment {
  return {
    takeId,
    limb,
    startBar: 0,
    lengthBars,
    noteCount,
    features: { ...NEUTRAL_FEEL, ...feel },
    rhythmKey: `${takeId}:${limb}`,
  };
}

/** A small, varied fixture corpus: sparse/dense feet+snare+cymbals across several takes. */
function fixtureCorpus() {
  const takes: Take[] = [
    take("sparse-a", [{ beat: 0, pitch: KICK, velocity: 90 }]),
    // A different drummer/style/bpm than the rest of the fixture, so the
    // feet limb has more than one *family* to draw from — topKCandidates
    // keeps only the closest segment per family (drummer+style+bpm), so a
    // fixture where every take shares the defaults would always collapse to
    // one candidate regardless of how many takes exist, the same failure
    // mode a real E-GMD take numbered "_2", "_5", "_22" produces.
    take("sparse-b", [{ beat: 0, pitch: KICK, velocity: 80 }], { drummer: "drummer2", style: "funk", bpm: 95 }),
    take("dense-a", [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 1, pitch: KICK, velocity: 100 },
      { beat: 2, pitch: KICK, velocity: 100 },
      { beat: 3, pitch: KICK, velocity: 100 },
    ]),
    take("dense-b", [
      { beat: 0, pitch: SNARE, velocity: 100 },
      { beat: 1, pitch: SNARE, velocity: 100 },
      { beat: 2, pitch: SNARE, velocity: 100 },
    ]),
    take("hats-a", [
      { beat: 0, pitch: HAT, velocity: 70 },
      { beat: 0.5, pitch: HAT, velocity: 70 },
    ]),
    take("six-eight", [{ beat: 0, pitch: KICK, velocity: 90 }], {
      timeSignature: { numerator: 6, denominator: 8 },
      beatsPerBar: 3,
    }),
  ];

  const segments: Segment[] = [
    segment("sparse-a", "feet", { density: 1 }),
    segment("sparse-b", "feet", { density: 1 }),
    segment("dense-a", "feet", { density: 8 }),
    segment("dense-b", "snare", { density: 6 }),
    segment("hats-a", "cymbals", { density: 4, brightness: 0.5 }),
    segment("six-eight", "feet", { density: 1 }),
  ];

  return buildIndex(takes, segments);
}

describe("buildIndex", () => {
  it("groups segments by limb", () => {
    const index = fixtureCorpus();
    expect(index.byLimb.get("feet")).toHaveLength(4);
    expect(index.byLimb.get("snare")).toHaveLength(1);
    expect(index.byLimb.get("cymbals")).toHaveLength(1);
    expect(index.byLimb.get("toms")).toBeUndefined();
  });

  it("resolves a segment's time signature via its take", () => {
    const index = fixtureCorpus();
    const sixEight = index.byLimb.get("feet")!.find((s) => s.takeId === "six-eight")!;
    expect(timeSignatureOf(index, sixEight)).toEqual({ numerator: 6, denominator: 8 });
  });
});

describe("selectGroove", () => {
  it("returns null for 'none'", () => {
    expect(selectGroove(fixtureCorpus(), "none", { seed: "verse-1" })).toBeNull();
  });

  it("returns null for '78' — the corpus has no 7/8 material to select from", () => {
    // Not a coverage gap in the fixture: the preset itself has no target,
    // by design, because E-GMD contains no 7/8 takes at all.
    expect(selectGroove(fixtureCorpus(), "78", { seed: "verse-1" })).toBeNull();
  });

  it("restricts kick_only to the feet limb", () => {
    const spec = selectGroove(fixtureCorpus(), "kick_only", { seed: "verse-1" });
    expect(spec).not.toBeNull();
    expect(spec!.feet).toBeDefined();
    expect(spec!.snare).toBeUndefined();
    expect(spec!.cymbals).toBeUndefined();
  });

  it("is deterministic for a given seed", () => {
    const index = fixtureCorpus();
    const a = selectGroove(index, "standard", { seed: "chorus-1" });
    const b = selectGroove(index, "standard", { seed: "chorus-1" });
    expect(a).toEqual(b);
  });

  it("can select different grooves for different seeds", () => {
    const index = fixtureCorpus();
    const seeds = ["verse-1", "verse-2", "chorus-1", "chorus-2", "bridge-1", "outro-1"];
    const specs = seeds.map((seed) => JSON.stringify(selectGroove(index, "standard", { seed })));
    // Not every seed has to land on a different segment, but a selector that
    // always picks the same one regardless of seed has no variety at all.
    expect(new Set(specs).size).toBeGreaterThan(1);
  });

  it("only selects segments matching a required time signature", () => {
    const index = fixtureCorpus();
    const spec = selectGroove(index, "68", { seed: "verse-1" });
    expect(spec).not.toBeNull();
    expect(spec!.feet!.takeId).toBe("six-eight");
  });

  it("returns null when no segment satisfies the preset's constraints", () => {
    // '54' requires 5/4, and the fixture corpus has no 5/4 material at all.
    const spec = selectGroove(fixtureCorpus(), "54", { seed: "verse-1" });
    expect(spec).toBeNull();
  });

  it("prefers low-density segments for bridge_sparse over high-density ones", () => {
    const index = fixtureCorpus();
    const spec = selectGroove(index, "bridge_sparse", { seed: "bridge-1" });
    expect(spec!.feet!.takeId).not.toBe("dense-a");
  });

  it("keeps every limb of one spec in the same time signature, even when a preset doesn't require one", () => {
    // A limb picked purely on feel score, independent of the others, can
    // land in a different meter than its sibling limbs — a 6/8 snare tiled
    // against a 4/4 kick has no consistent bar length at all. This is the
    // "match meter" recombination constraint: the first limb picked pins
    // the meter for the rest of that spec, even for presets (like
    // bridge_sparse) that don't pin a time signature up front.
    const takes: Take[] = [
      take("feet-four-four", [{ beat: 0, pitch: KICK, velocity: 90 }]),
      // Scores best on pure feel distance for bridge_sparse (density 2 is
      // an exact match) but is in 6/8 — must lose to the worse-scoring but
      // meter-consistent candidate once feet has pinned 4/4.
      take("snare-six-eight", [{ beat: 0, pitch: SNARE, velocity: 80 }], {
        timeSignature: { numerator: 6, denominator: 8 },
        beatsPerBar: 3,
      }),
      take("snare-four-four", [{ beat: 0, pitch: SNARE, velocity: 80 }]),
    ];
    const segments: Segment[] = [
      segment("feet-four-four", "feet", { density: 2 }),
      segment("snare-six-eight", "snare", { density: 2 }), // exact feel match
      segment("snare-four-four", "snare", { density: 5 }), // worse feel match, but 4/4
    ];
    const index = buildIndex(takes, segments);

    const spec = selectGroove(index, "bridge_sparse", { seed: "bridge-1", poolSize: 1 });
    expect(spec!.feet!.takeId).toBe("feet-four-four");
    expect(spec!.snare!.takeId).toBe("snare-four-four");
  });
});

describe("resolveGrooveNotes", () => {
  it("merges limbs from different takes into one sorted note list", () => {
    const index = fixtureCorpus();
    const notes = resolveGrooveNotes(index, {
      feet: { takeId: "dense-a", startBar: 0, lengthBars: 1 },
      snare: { takeId: "dense-b", startBar: 0, lengthBars: 1 },
    });
    expect(notes.map((n) => n.pitch)).toContain(KICK);
    expect(notes.map((n) => n.pitch)).toContain(SNARE);
    for (let i = 1; i < notes.length; i++) expect(notes[i].beat).toBeGreaterThanOrEqual(notes[i - 1].beat);
  });

  it("applies a timing offset across every resolved note", () => {
    const index = fixtureCorpus();
    const notes = resolveGrooveNotes(index, {
      feet: { takeId: "dense-a", startBar: 0, lengthBars: 1 },
      transform: { timingOffset: 0.02 },
    });
    expect(notes[0].beat).toBeCloseTo(0.02, 5);
  });

  it("scales velocity and rounds to an integer", () => {
    const index = fixtureCorpus();
    const notes = resolveGrooveNotes(index, {
      feet: { takeId: "dense-a", startBar: 0, lengthBars: 1 },
      transform: { velocityScale: 0.5 },
    });
    expect(notes[0].velocity).toBe(50);
    expect(Number.isInteger(notes[0].velocity)).toBe(true);
  });

  it("pulls partially toward the grid without fully quantising at 0.5", () => {
    const index = buildIndex(
      [take("off-grid", [{ beat: 0.1, pitch: KICK, velocity: 100 }])],
      [segment("off-grid", "feet", {})],
    );
    const notes = resolveGrooveNotes(index, {
      feet: { takeId: "off-grid", startBar: 0, lengthBars: 1 },
      transform: { quantize: 0.5 },
    });
    // Nearest 16th to 0.1 is 0; halfway from 0.1 toward 0 is 0.05.
    expect(notes[0].beat).toBeCloseTo(0.05, 5);
  });

  it("skips a limb whose referenced take is missing rather than throwing", () => {
    const index = fixtureCorpus();
    const notes = resolveGrooveNotes(index, {
      feet: { takeId: "does-not-exist", startBar: 0, lengthBars: 1 },
      snare: { takeId: "dense-b", startBar: 0, lengthBars: 1 },
    });
    expect(notes.every((n) => n.pitch === SNARE)).toBe(true);
  });
});

describe("grooveLengthBars", () => {
  it("reads the length from whichever limb is present", () => {
    expect(grooveLengthBars({ snare: { takeId: "x", startBar: 0, lengthBars: 2 } })).toBe(2);
  });

  it("is zero for an empty spec", () => {
    expect(grooveLengthBars({})).toBe(0);
  });
});

describe("grooveLengthBeats", () => {
  it("converts bars to quarter-note beats using the take's own time signature", () => {
    const index = fixtureCorpus();
    // "dense-a" is 4/4: 4 beats/bar.
    expect(grooveLengthBeats(index, { feet: { takeId: "dense-a", startBar: 0, lengthBars: 2 } })).toBe(8);
  });

  it("does not treat a 6/8 groove as 6 beats per bar", () => {
    // 6/8 is 3 quarter-note beats per bar. If this used the raw numerator
    // (6) instead of the take's own beatsPerBar, a 2-bar groove would tile
    // at double its real length and silently misalign against the section.
    const index = fixtureCorpus();
    expect(grooveLengthBeats(index, { feet: { takeId: "six-eight", startBar: 0, lengthBars: 2 } })).toBe(6);
  });

  it("is zero for an empty spec or a reference to a missing take", () => {
    const index = fixtureCorpus();
    expect(grooveLengthBeats(index, {})).toBe(0);
    expect(grooveLengthBeats(index, { feet: { takeId: "no-such-take", startBar: 0, lengthBars: 1 } })).toBe(0);
  });
});

describe("tileGroove", () => {
  it("repeats a groove to fill a longer span", () => {
    const notes: DrumNote[] = [{ beat: 0, pitch: KICK, velocity: 100 }];
    const tiled = tileGroove(notes, 4, 12);
    expect(tiled.map((n) => n.beat)).toEqual([0, 4, 8]);
  });

  it("truncates the final repeat instead of overshooting into the next section", () => {
    const notes: DrumNote[] = [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 3, pitch: SNARE, velocity: 100 },
    ];
    const tiled = tileGroove(notes, 4, 7);
    // The second repeat's snare would land at beat 7, which is outside [0,7).
    expect(tiled.map((n) => n.beat)).toEqual([0, 3, 4]);
  });

  it("returns nothing for a zero-length groove or span", () => {
    const notes: DrumNote[] = [{ beat: 0, pitch: KICK, velocity: 100 }];
    expect(tileGroove(notes, 0, 16)).toHaveLength(0);
    expect(tileGroove(notes, 4, 0)).toHaveLength(0);
  });
});
