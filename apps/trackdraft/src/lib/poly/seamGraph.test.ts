import { describe, expect, it } from "vitest";
import {
  clockFingerprint,
  describeClock,
  keyFingerprint,
  seamCables,
  seamFacts,
  seamsAround,
} from "./seamGraph";

const song = { key: "C", scale: "ionian" };

describe("clockFingerprint", () => {
  it("treats an absent clock as song time", () => {
    expect(clockFingerprint({})).toBe("1");
  });

  it("counts swing as a clock change", () => {
    // Swing is micro-timing for conduction but it moves every off-8th, so a seam
    // where it starts is a seam you can hear. The ladder can step to it, so the
    // fingerprint has to see it.
    expect(clockFingerprint({ timeDomain: { swing: 0.25 } })).toBe(
      "1|0|0|0.25",
    );
    expect(
      seamFacts({ timeDomain: { swing: 0.25 } }, {}, {}).map((f) => f.kind),
    ).toEqual(["clock"]);
  });

  it("treats an explicit 1x as song time too", () => {
    // A clock cycled back to 1× must not read as a seam against one that never
    // had a clock — that is the §S1.8 "default is the absent case" rule.
    expect(clockFingerprint({ timeDomain: { rate: 1 } })).toBe("1");
  });

  it("separates rate, cycle and phase", () => {
    expect(clockFingerprint({ timeDomain: { rate: 0.5 } })).toBe("0.5|0|0|0");
    expect(clockFingerprint({ timeDomain: { cycle: 8 } })).toBe("1|8|0|0");
    expect(
      clockFingerprint({ timeDomain: { rate: 2, cycle: 4, phase: 0.5 } }),
    ).toBe("2|4|0.5|0");
  });
});

describe("keyFingerprint", () => {
  it("inherits the song's key when the section has none", () => {
    expect(keyFingerprint({}, song)).toBe("C/ionian");
  });

  it("prefers the section's own", () => {
    expect(keyFingerprint({ key: "G", scale: "dorian" }, song)).toBe(
      "G/dorian",
    );
  });
});

describe("seamFacts", () => {
  it("says nothing when nothing changes", () => {
    expect(seamFacts({ name: "verse" }, { name: "chorus" }, song)).toEqual([]);
  });

  it("reports a declared transition into the next section", () => {
    const facts = seamFacts(
      { name: "chorus", drumTransitionModel: "build", drumTransitionBars: 2 },
      {},
      song,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe("transition");
    expect(facts[0].reason).toContain("build");
    expect(facts[0].reason).toContain("2 bars");
  });

  it("defaults the transition to one bar", () => {
    const facts = seamFacts({ drumTransitionModel: "cut" }, {}, song);
    expect(facts[0].reason).toContain("1 bar");
    expect(facts[0].reason).not.toContain("1 bars");
  });

  it("reports a clock change, and says what it changed from and to", () => {
    const facts = seamFacts(
      { timeDomain: { rate: 0.5 } },
      { timeDomain: { rate: 1 } },
      song,
    );
    expect(facts.map((fact) => fact.kind)).toEqual(["clock"]);
    expect(facts[0].reason).toContain("×0.5");
    expect(facts[0].reason).toContain("song time");
  });

  it("does not report a clock seam between two identical clocks", () => {
    expect(
      seamFacts({ timeDomain: { rate: 2 } }, { timeDomain: { rate: 2 } }, song),
    ).toEqual([]);
  });

  it("reports a key change once, even when both key and mode move", () => {
    const facts = seamFacts(
      { key: "C", scale: "ionian" },
      { key: "A", scale: "aeolian" },
      song,
    );
    expect(facts.map((fact) => fact.kind)).toEqual(["key"]);
    expect(facts[0].reason).toContain("C ionian");
    expect(facts[0].reason).toContain("A aeolian");
  });

  it("does not report a key seam when a section simply inherits the song's", () => {
    // This is the bug the fingerprint exists to prevent: `{}` → `{key: "C"}`
    // is not a modulation, it is the same harmony written two ways.
    expect(seamFacts({}, { key: "C", scale: "ionian" }, song)).toEqual([]);
  });

  it("reports every fact at a busy seam, transition first", () => {
    const facts = seamFacts(
      { name: "outro", drumTransitionModel: "cut", timeDomain: { rate: 2 } },
      { key: "E" },
      song,
    );
    expect(facts.map((fact) => fact.kind)).toEqual([
      "transition",
      "clock",
      "key",
    ]);
  });
});

describe("describeClock", () => {
  it("reads a fingerprint back as words", () => {
    expect(describeClock("1")).toBe("song time");
    expect(describeClock("0.5|0|0|0")).toBe("×0.5");
    expect(describeClock("1|8|0|0")).toBe("×1 · loop 8");
    expect(describeClock("2|4|0.5|0")).toBe("×2 · loop 4 · phase 0.5");
    expect(describeClock("1|0|0|0.25")).toBe("×1 · swing 25%");
  });
});

describe("seamCables", () => {
  it("spans the gap between two columns at the spine", () => {
    const cables = seamCables(
      [{ kind: "key", reason: "home moves" }],
      100,
      140,
      -3,
    );
    expect(cables).toEqual([
      { kind: "key", reason: "home moves", x1: 100, x2: 140, y: -3 },
    ]);
  });

  it("draws nothing when the columns do not leave a gap", () => {
    // Overlapping or reversed geometry would draw a cable backwards through the
    // arrangement; better to draw nothing than a lie.
    expect(seamCables([{ kind: "key", reason: "x" }], 140, 100, 0)).toEqual([]);
    expect(seamCables([{ kind: "key", reason: "x" }], 100, 100, 0)).toEqual([]);
  });

  it("draws nothing for a seam with no facts", () => {
    expect(seamCables([], 0, 40, 0)).toEqual([]);
  });
});

describe("seamsAround", () => {
  const spans = [
    { sectionId: "a", occurrenceIndex: 0, section: { name: "intro" } },
    {
      sectionId: "b",
      occurrenceIndex: 0,
      section: { name: "verse", timeDomain: { rate: 0.5 } },
    },
    {
      sectionId: "b",
      occurrenceIndex: 1,
      section: { name: "verse", timeDomain: { rate: 0.5 } },
    },
  ];

  it("returns both boundaries of a middle span", () => {
    const seams = seamsAround(spans, 1, song);
    expect(seams.map((seam) => seam.side)).toEqual(["in", "out"]);
    expect(seams[0]).toMatchObject({ fromIndex: 0, toIndex: 1 });
    expect(seams[1]).toMatchObject({ fromIndex: 1, toIndex: 2 });
  });

  it("finds the clock fact on the boundary into a clocked section", () => {
    const [incoming] = seamsAround(spans, 1, song);
    expect(incoming.facts.map((fact) => fact.kind)).toEqual(["clock"]);
  });

  it("finds the clock fact on the boundary OUT of it as well", () => {
    // The same section's other edge is a different boundary: leaving a half-time
    // verse for a pass that is also half-time is NOT a seam, but leaving the
    // verse for the next song-time section is. Getting this backwards is the
    // off-by-one this function exists to prevent.
    const outgoing = seamsAround(spans, 1, song)[1];
    expect(outgoing.facts).toEqual([]);
  });

  it("addresses a repeated section by pass, not just id", () => {
    const seams = seamsAround(spans, 2, song);
    expect(seams.map((seam) => seam.side)).toEqual(["in"]);
    expect(seams[0]).toMatchObject({ fromIndex: 1, toIndex: 2 });
  });

  it("returns one boundary for the first and last spans", () => {
    expect(seamsAround(spans, 0, song).map((seam) => seam.side)).toEqual([
      "out",
    ]);
    expect(seamsAround(spans, 9, song)).toEqual([]);
  });

  it("keeps a boundary with no facts, so the caller can count them", () => {
    const quiet = seamsAround(
      [
        { sectionId: "a", occurrenceIndex: 0, section: {} },
        { sectionId: "b", occurrenceIndex: 0, section: {} },
      ],
      0,
      song,
    );
    expect(quiet).toHaveLength(1);
    expect(quiet[0].facts).toEqual([]);
  });
});
