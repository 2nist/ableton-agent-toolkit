import { describe, expect, it } from "vitest";
import {
  buildMeterOutline,
  canonicalGroupings,
  composeMeter,
  numerator,
  outlineBeatsPerBar,
  outlineToClickPattern,
  outlineToGroovePattern,
  synthesizeOutlineFill,
  type MeterOutline,
} from "../src/meter.js";

describe("canonicalGroupings / buildMeterOutline", () => {
  it("gives 5 as apple-galloping (2+3) by default, with galloping-apple as an alternative", () => {
    const groupings = canonicalGroupings(5);
    expect(groupings).toEqual([[2, 3], [3, 2]]);
    expect(buildMeterOutline(5, 8).cells).toEqual([2, 3]);
    expect(buildMeterOutline(5, 8, 1).cells).toEqual([3, 2]);
  });

  it("gives 7 as apple-apple-galloping (2+2+3), with rupak's galloping-apple-apple as an alternative", () => {
    const groupings = canonicalGroupings(7);
    expect(groupings).toEqual([[2, 2, 3], [3, 2, 2]]);
  });

  it("gives 9 both the Macedonian syncopated and the even Western groupings", () => {
    expect(canonicalGroupings(9)).toEqual([[2, 2, 2, 3], [3, 3, 3]]);
  });

  it("gives jhaptal's 2+3+3+2 for 10", () => {
    expect(canonicalGroupings(10)).toEqual([[2, 3, 3, 2]]);
  });

  it("gives Revisko Oro's 2+2+3+2+2 for 11", () => {
    expect(canonicalGroupings(11)).toEqual([[2, 2, 3, 2, 2]]);
  });

  it("every cell in every curated grouping is a 2 or a 3, summing to the numerator", () => {
    for (const n of [5, 7, 9, 10, 11, 12]) {
      for (const cells of canonicalGroupings(n)) {
        expect(cells.every((cell) => cell === 2 || cell === 3)).toBe(true);
        expect(cells.reduce((sum, cell) => sum + cell, 0)).toBe(n);
      }
    }
  });

  it("falls back to a generated 2s/3s decomposition for an uncurated numerator", () => {
    for (const n of [2, 3, 4, 6, 13, 17, 22]) {
      const cells = canonicalGroupings(n)[0]!;
      expect(cells.reduce((sum, cell) => sum + cell, 0)).toBe(n);
      expect(cells.every((cell) => cell === 2 || cell === 3)).toBe(true);
    }
  });

  it("clamps an out-of-range variant to the last option instead of throwing", () => {
    const options = canonicalGroupings(7);
    expect(buildMeterOutline(7, 16, 99).cells).toEqual(options[options.length - 1]);
  });

  it("throws for a numerator below 2", () => {
    expect(() => canonicalGroupings(1)).toThrow();
    expect(() => canonicalGroupings(0)).toThrow();
  });
});

describe("numerator / beatsPerBar", () => {
  it("sums an outline's cells for numerator", () => {
    expect(numerator(buildMeterOutline(7, 16))).toBe(7);
    expect(numerator(buildMeterOutline(11, 16))).toBe(11);
  });

  it("computes quarter-note beats per bar for x/8 and x/16 meters", () => {
    // 5/8: cellBeats = 4/8 = 0.5, numerator 5 → 2.5 quarter-note beats.
    expect(outlineBeatsPerBar(buildMeterOutline(5, 8))).toBe(2.5);
    // 7/16: cellBeats = 4/16 = 0.25, numerator 7 → 1.75 quarter-note beats.
    expect(outlineBeatsPerBar(buildMeterOutline(7, 16))).toBeCloseTo(1.75);
    // 7/8 (the "3.5 beats, not 7" case the bridge's sectionSpans documents).
    expect(outlineBeatsPerBar(buildMeterOutline(7, 8))).toBe(3.5);
  });
});

describe("composeMeter", () => {
  it("builds 25/16 as 7+11+7 (the PDF's own opening example)", () => {
    const outline = composeMeter(
      buildMeterOutline(7, 16),
      buildMeterOutline(11, 16),
      buildMeterOutline(7, 16),
    );
    expect(numerator(outline)).toBe(25);
    expect(outline.cells).toEqual([2, 2, 3, 2, 2, 3, 2, 2, 2, 2, 3]);
  });

  it("builds 27/16 as 7+9+11 (Mayday Macedonia)", () => {
    const outline = composeMeter(buildMeterOutline(7, 16), buildMeterOutline(9, 16), buildMeterOutline(11, 16));
    expect(numerator(outline)).toBe(27);
    expect(outlineBeatsPerBar(outline)).toBeCloseTo(6.75);
  });

  it("throws when composing parts with different cellBeats", () => {
    expect(() => composeMeter(buildMeterOutline(7, 16), buildMeterOutline(5, 8))).toThrow();
  });

  it("throws with no parts", () => {
    expect(() => composeMeter()).toThrow();
  });
});

describe("outlineToClickPattern", () => {
  it("emits one note per subdivision, matching the numerator's count", () => {
    const outline = buildMeterOutline(7, 16); // 2+2+3
    const notes = outlineToClickPattern(outline);
    expect(notes).toHaveLength(7);
  });

  it("accents the first subdivision of each cell, matching the PDF's DA-da mnemonic", () => {
    const outline = buildMeterOutline(5, 8); // 2+3, cellBeats 0.5
    const notes = outlineToClickPattern(outline, { accentVelocity: 110, velocity: 80 });
    // Cell starts (accented): beat 0 (first "apple") and beat 1 (start of "galloping").
    const accented = notes.filter((n) => n[2] === 110).map((n) => n[0]);
    expect(accented).toEqual([0, 1]);
    const unaccented = notes.filter((n) => n[2] === 80).map((n) => n[0]);
    expect(unaccented).toEqual([0.5, 1.5, 2]);
  });

  it("spans exactly beatsPerBar", () => {
    const outline = buildMeterOutline(11, 16);
    const notes = outlineToClickPattern(outline);
    const last = notes[notes.length - 1]!;
    expect(last[0] + outline.cellBeats).toBeCloseTo(outlineBeatsPerBar(outline));
  });
});

describe("synthesizeOutlineFill", () => {
  const outline: MeterOutline = buildMeterOutline(11, 16); // 2+2+3+2+2

  it("produces a variant spanning exactly one bar of the outline's meter", () => {
    const fill = synthesizeOutlineFill(outline, 100);
    expect(fill.lengthBeats).toBeCloseTo(outlineBeatsPerBar(outline));
    expect(fill.beatsPerBar).toBeCloseTo(outlineBeatsPerBar(outline));
  });

  it("lands a kick and a snare together on the final cell, at the target velocity", () => {
    const fill = synthesizeOutlineFill(outline, 100);
    const lastCellStart = outlineBeatsPerBar(outline) - outline.cellBeats * outline.cells[outline.cells.length - 1]!;
    const onLastCell = fill.notes.filter((n) => n[0] === lastCellStart);
    expect(onLastCell.some((n) => n[1] === 36 && n[2] === 100)).toBe(true); // kick
    expect(onLastCell.some((n) => n[1] === 38 && n[2] === 100)).toBe(true); // snare
  });

  it("scales down with a lower velocity target", () => {
    const loud = synthesizeOutlineFill(outline, 120);
    const quiet = synthesizeOutlineFill(outline, 40);
    expect(Math.max(...quiet.notes.map((n) => n[2]))).toBeLessThan(Math.max(...loud.notes.map((n) => n[2])));
  });

  it("marks its provenance as synth, not egmd", () => {
    expect(synthesizeOutlineFill(outline, 100).source.origin).toBe("synth");
  });
});

describe("outlineToGroovePattern", () => {
  const outline = buildMeterOutline(7, 16); // 2+2+3

  it("plays each cell's assigned voice on that cell's downbeat", () => {
    const notes = outlineToGroovePattern(outline, ["kick", "snare", "kick"]);
    // Cell starts: 0 (kick), 0.5 (snare), 1 (kick), at cellBeats 0.25.
    const kick = 36, snare = 38;
    expect(notes.find((n) => n[0] === 0)).toEqual([0, kick, 110]);
    expect(notes.find((n) => n[0] === 0.5)).toEqual([0.5, snare, 110]);
    expect(notes.find((n) => n[0] === 1)).toEqual([1, kick, 110]);
  });

  it("fills the rest of each cell with a soft hat pulse", () => {
    const notes = outlineToGroovePattern(outline, ["kick", "snare", "kick"]);
    const closedHat = 42;
    // The 3-cell (starting beat 1) has subdivisions at 1, 1.25, 1.5 — only
    // the first (1) is the kick downbeat; the other two are hat pulses.
    expect(notes.find((n) => n[0] === 1.25)).toEqual([1.25, closedHat, 70]);
    expect(notes.find((n) => n[0] === 1.5)).toEqual([1.5, closedHat, 70]);
  });

  it("treats a missing or 'hat' cell voice as a plain accented hat hit", () => {
    const notes = outlineToGroovePattern(outline, ["hat"]); // only cell 0 assigned; cells 1-2 default too
    const closedHat = 42;
    expect(notes.filter((n) => n[1] === closedHat && n[2] === 110).map((n) => n[0])).toEqual(
      expect.arrayContaining([0, 0.5, 1]),
    );
  });

  it("emits one note per subdivision total, same count as outlineToClickPattern", () => {
    const groove = outlineToGroovePattern(outline, ["kick", "snare", "kick"]);
    const click = outlineToClickPattern(outline);
    expect(groove).toHaveLength(click.length);
  });
});
