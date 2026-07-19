import { describe, expect, it } from "vitest";
import { tileGrooveVaried } from "../src/vary.js";
import { tileGroove } from "../src/resolve.js";
import type { DrumNote } from "../src/types.js";

const groove: DrumNote[] = [
  { beat: 0, pitch: 36, velocity: 110 },
  { beat: 1, pitch: 38, velocity: 100 },
  { beat: 0.5, pitch: 42, velocity: 70 },
  { beat: 1.5, pitch: 42, velocity: 68 },
  { beat: 2, pitch: 36, velocity: 108 },
  { beat: 3, pitch: 38, velocity: 102 },
  { beat: 2.5, pitch: 42, velocity: 71 },
  { beat: 3.5, pitch: 42, velocity: 69 },
];

describe("tileGrooveVaried", () => {
  it("is deterministic for the same seed", () => {
    const a = tileGrooveVaried(groove, 4, 32, { seed: "verse-1" });
    const b = tileGrooveVaried(groove, 4, 32, { seed: "verse-1" });
    expect(a).toEqual(b);
  });

  it("differs between seeds and between repeats", () => {
    const a = tileGrooveVaried(groove, 4, 32, { seed: "verse-1" });
    const b = tileGrooveVaried(groove, 4, 32, { seed: "chorus-1" });
    expect(a).not.toEqual(b);

    // Repeats of the same tile should not be carbon copies of tile 0.
    const tile0 = a.filter((n) => n.beat < 4);
    const tile3 = a.filter((n) => n.beat >= 12 && n.beat < 16).map((n) => ({ ...n, beat: n.beat - 12 }));
    expect(tile3).not.toEqual(tile0);
  });

  it("leaves the first tile exactly as written", () => {
    const varied = tileGrooveVaried(groove, 4, 32, { seed: "s" });
    const plain = tileGroove(groove, 4, 4);
    expect(varied.filter((n) => n.beat < 4)).toEqual(plain);
  });

  it("never drops kick or snare, only hats", () => {
    const varied = tileGrooveVaried(groove, 4, 64, { seed: "s", amount: 1 });
    const kicksAndSnares = varied.filter((n) => n.pitch === 36 || n.pitch === 38);
    expect(kicksAndSnares.length).toBe((64 / 4) * 4); // 4 per tile, every tile intact
  });

  it("keeps velocities in MIDI range and near the written level", () => {
    const varied = tileGrooveVaried(groove, 4, 64, { seed: "s", amount: 1 });
    for (const note of varied) {
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      const written = groove.find((g) => g.beat === note.beat % 4 && g.pitch === note.pitch);
      if (written) expect(Math.abs(note.velocity - written.velocity)).toBeLessThanOrEqual(10);
    }
  });

  it("amount 0 degrades to plain tiling", () => {
    expect(tileGrooveVaried(groove, 4, 16, { seed: "s", amount: 0 })).toEqual(tileGroove(groove, 4, 16));
  });

  it("never overshoots the section, matching tileGroove's contract", () => {
    const varied = tileGrooveVaried(groove, 4, 10, { seed: "s" });
    for (const note of varied) expect(note.beat).toBeLessThan(10);
  });
});
