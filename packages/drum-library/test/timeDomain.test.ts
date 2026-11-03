import { describe, expect, it } from "vitest";
import {
  applyTimeDomain,
  domainLabel,
  MAX_CYCLE_COPIES,
  mapDomainBeat,
  normaliseTimeDomain,
  rateLabel,
  swingOffset,
  toLocalBeats,
  toSongBeats,
} from "../src/timeDomain.js";

const half = { rate: 0.5 };
const double = { rate: 2 };
const normalHalf = normaliseTimeDomain(half)!;
const normalDouble = normaliseTimeDomain(double)!;

describe("normaliseTimeDomain", () => {
  it("treats an absent or inert domain as the song's own time", () => {
    expect(normaliseTimeDomain(undefined)).toBeNull();
    expect(normaliseTimeDomain(null)).toBeNull();
    expect(normaliseTimeDomain({ rate: 1 })).toBeNull();
    expect(normaliseTimeDomain({ rate: 1, phase: 0, swing: 0 })).toBeNull();
  });

  it("keeps a domain that changes something", () => {
    expect(normaliseTimeDomain({ rate: 2 })).toEqual({
      rate: 2,
      phase: 0,
      swing: 0,
      quantizeTo: 0,
      cycle: 0,
    });
  });

  it("clamps a rate that no one could mean", () => {
    expect(normaliseTimeDomain({ rate: 1000 })!.rate).toBe(8);
    expect(normaliseTimeDomain({ rate: 0 })!.rate).toBe(1 / 8);
    // A rate that is not a number is not a clock at all.
    expect(normaliseTimeDomain({ rate: Number.NaN })).toBeNull();
  });

  it("clamps swing into 0..1 and ignores a negative quantise", () => {
    expect(normaliseTimeDomain({ rate: 2, swing: 4 })!.swing).toBe(1);
    expect(normaliseTimeDomain({ rate: 2, swing: -1 })!.swing).toBe(0);
    expect(normaliseTimeDomain({ rate: 2, quantizeTo: -0.5 })!.quantizeTo).toBe(
      0,
    );
  });
});

describe("mapDomainBeat", () => {
  it("leaves beats alone without a domain", () => {
    expect(mapDomainBeat(3.5, null)).toBe(3.5);
  });

  it("compresses the material at double time", () => {
    expect(mapDomainBeat(0, normalDouble)).toBe(0);
    expect(mapDomainBeat(4, normalDouble)).toBe(2);
    expect(mapDomainBeat(8, normalDouble)).toBe(4);
  });

  it("stretches it at half time", () => {
    expect(mapDomainBeat(1, normalHalf)).toBe(2);
    expect(mapDomainBeat(2, normalHalf)).toBe(4);
  });

  it("applies phase after the rate", () => {
    const late = normaliseTimeDomain({ rate: 2, phase: 1 })!;
    expect(mapDomainBeat(4, late)).toBe(3);
  });

  it("snaps to the grid when asked", () => {
    const snapped = normaliseTimeDomain({ rate: 3, quantizeTo: 0.25 })!;
    // 1 / 3 = 0.333… → the nearest quarter.
    expect(mapDomainBeat(1, snapped)).toBe(0.25);
  });
});

describe("swingOffset", () => {
  it("moves only the second eighth", () => {
    expect(swingOffset(0, 1)).toBe(0);
    expect(swingOffset(1, 1)).toBe(0);
    expect(swingOffset(0.5, 1)).toBeCloseTo(0.25, 6);
    expect(swingOffset(1.5, 1)).toBeCloseTo(0.25, 6);
  });

  it("is proportional to the amount", () => {
    expect(swingOffset(0.5, 0.5)).toBeCloseTo(0.125, 6);
    expect(swingOffset(0.5, 0)).toBe(0);
  });

  it("gives a triplet feel at full swing", () => {
    const swung = normaliseTimeDomain({ rate: 1, swing: 1 })!;
    // The off-eighth lands on the last third of the beat.
    expect(mapDomainBeat(0.5, swung)).toBeCloseTo(0.75, 6);
  });
});

describe("applyTimeDomain", () => {
  const notes = [
    { beat: 0, pitch: 36 },
    { beat: 2, pitch: 38 },
    { beat: 6, pitch: 42 },
  ];

  it("returns the notes untouched without a domain", () => {
    expect(applyTimeDomain(notes, null, 8)).toEqual(notes);
  });

  it("maps every note, in order, and repeats to fill the section", () => {
    // Double time compresses the material into the first half — and then the
    // section repeats, because running out of notes halfway through a section
    // would leave the kit silent while the (tiled) harmony kept going. P4.1
    // made this visible: two passes of one section at different rates.
    expect(applyTimeDomain(notes, normalDouble, 8)).toEqual([
      { beat: 0, pitch: 36 },
      { beat: 1, pitch: 38 },
      { beat: 3, pitch: 42 },
      { beat: 4, pitch: 36 },
      { beat: 5, pitch: 38 },
      { beat: 7, pitch: 42 },
    ]);
  });

  it("drops notes that fall outside the section rather than leaking them", () => {
    // Half time: beat 6 lands on 12, past the section's 8 beats.
    expect(applyTimeDomain(notes, normalHalf, 8)).toEqual([
      { beat: 0, pitch: 36 },
      { beat: 4, pitch: 38 },
    ]);
  });

  it("does not mutate the caller's notes", () => {
    applyTimeDomain(notes, normalDouble, 8);
    expect(notes[1].beat).toBe(2);
  });
});

describe("labels", () => {
  it("says a rate the way a musician would", () => {
    expect(rateLabel(0.5)).toBe("½");
    expect(rateLabel(2)).toBe("×2");
    expect(rateLabel(1.5)).toBe("3:2");
    expect(rateLabel(1 / 3)).toBe("⅓");
  });

  it("falls back to a decimal for an odd rate", () => {
    expect(rateLabel(1.37)).toBe("1.37×");
  });

  it("summarises the whole domain on one line", () => {
    expect(domainLabel(undefined)).toBe("song time");
    expect(domainLabel({ rate: 0.5 })).toBe("½");
    expect(domainLabel({ rate: 2, swing: 0.5 })).toBe("×2 · swing 50%");
    expect(domainLabel({ rate: 1, phase: 0.5, quantizeTo: 0.25 })).toBe(
      "late 0.5 · snap 0.25",
    );
  });
});

describe("cycles (folding)", () => {
  const loop = (cycle: number, rate = 1) =>
    normaliseTimeDomain({ rate, cycle })!;
  const notes = [
    { beat: 0, pitch: 36 },
    { beat: 2, pitch: 38 },
    { beat: 6, pitch: 40 },
  ];

  it("repeats the loop until the section ends", () => {
    // Four-beat loop over eight beats: two copies of the first two notes,
    // and the third note (beat 6, outside the loop) never plays.
    const out = applyTimeDomain(notes, loop(4), 8);
    expect(out.map((n) => [n.beat, n.pitch])).toEqual([
      [0, 36],
      [2, 38],
      [4, 36],
      [6, 38],
    ]);
  });

  it("takes the rate into account — a half-time loop is twice as long", () => {
    const out = applyTimeDomain(notes, loop(4, 0.5), 16);
    expect(out.map((n) => n.beat)).toEqual([0, 4, 8, 12]);
  });

  it("fills exactly to the end without overshooting", () => {
    const out = applyTimeDomain(notes, loop(3), 10);
    expect(Math.max(...out.map((n) => n.beat))).toBeLessThanOrEqual(10);
  });

  it("says nothing extra for a loop longer than the section", () => {
    const out = applyTimeDomain(notes, loop(32), 8);
    expect(out.map((n) => n.beat)).toEqual([0, 2, 6]);
  });

  it("caps a loop so short it would explode", () => {
    const out = applyTimeDomain([{ beat: 0, pitch: 36 }], loop(0.01), 1_000);
    expect(out.length).toBe(MAX_CYCLE_COPIES);
  });

  it("carries the loop in the label", () => {
    expect(domainLabel({ rate: 1, cycle: 4 })).toBe("loop 4");
    expect(domainLabel({ rate: 0.5, cycle: 4 })).toBe("½ · loop 4");
  });

  it("is a normalised field like any other", () => {
    expect(normaliseTimeDomain({ rate: 1, cycle: 0 })).toBeNull();
    expect(normaliseTimeDomain({ rate: 1, cycle: -2 })).toBeNull();
  });
});

describe("delta conversion (editing a clocked lane)", () => {
  const half = normaliseTimeDomain({ rate: 0.5 });
  const fast = normaliseTimeDomain({ rate: 2 });

  it("leaves a delta alone without a clock", () => {
    expect(toLocalBeats(1.5, null)).toBe(1.5);
    expect(toSongBeats(1.5, null)).toBe(1.5);
  });

  it("turns a song-beat drag into the local beats it writes", () => {
    // At half time one local beat occupies two song beats, so a two-beat drag
    // writes one; at double time it writes four.
    expect(toLocalBeats(2, half)).toBe(1);
    expect(toLocalBeats(2, fast)).toBe(4);
  });

  it("round-trips", () => {
    expect(toSongBeats(toLocalBeats(3, half), half)).toBeCloseTo(3, 9);
    expect(toSongBeats(toLocalBeats(0.75, fast), fast)).toBeCloseTo(0.75, 9);
  });

  it("is not affected by swing or a snap", () => {
    // Swing moves where a note sits, never how far apart two notes are.
    expect(toLocalBeats(2, normaliseTimeDomain({ rate: 1, swing: 0.5 }))).toBe(
      2,
    );
    expect(
      toLocalBeats(2, normaliseTimeDomain({ rate: 1, quantizeTo: 0.25 })),
    ).toBe(2);
  });
});

describe("applyTimeDomain — a note may not ring past the section", () => {
  // S2 found this on the corpus: a half-time phrase's last note doubled in
  // length and ended two beats into the next section, and a loop's final copy
  // started before the end and rang over the boundary.
  it("clips a stretched note to the space left", () => {
    const stretched = applyTimeDomain(
      [{ beat: 6, duration: 2 }],
      normaliseTimeDomain({ rate: 0.5 }),
      8,
    );
    // Onset 6 maps to 12 — past an 8-beat section, so it is dropped entirely.
    expect(stretched).toEqual([]);
    const inside = applyTimeDomain(
      [{ beat: 2, duration: 2 }],
      normaliseTimeDomain({ rate: 0.5 }),
      8,
    );
    expect(inside).toEqual([{ beat: 4, duration: 2 }]);
    const tail = applyTimeDomain(
      [{ beat: 3, duration: 3 }],
      normaliseTimeDomain({ rate: 0.5 }),
      8,
    );
    // 3 → 6, and a three-beat tail would end at 9 — so it is cut to the edge.
    expect(tail).toEqual([{ beat: 6, duration: 2 }]);
  });

  it("clips the last copy of a folded pattern", () => {
    const folded = applyTimeDomain(
      [{ beat: 3, duration: 1 }],
      normaliseTimeDomain({ rate: 1, cycle: 4 }),
      8,
    );
    // Copies at 3 and 7; the second one only has a beat of room.
    expect(folded).toEqual([
      { beat: 3, duration: 1 },
      { beat: 7, duration: 1 },
    ]);
    const tight = applyTimeDomain(
      [{ beat: 3, duration: 2 }],
      normaliseTimeDomain({ rate: 1, cycle: 4 }),
      8,
    );
    expect(tight.map((note) => note.duration)).toEqual([2, 1]);
  });
});
