import { describe, expect, it } from "vitest";
import { applyGroove, drumPocket, extractGroove, glueToPocket, pocketSummary } from "../src/groove.js";
import type { DrumNote } from "../src/types.js";

describe("extractGroove", () => {
  it("measures per-slot timing offsets", () => {
    // Hats consistently 0.02 behind the offbeat 8ths, kick dead on the grid.
    const notes: DrumNote[] = [
      { beat: 0, pitch: 36, velocity: 110 },
      { beat: 0.52, pitch: 42, velocity: 70 },
      { beat: 1.52, pitch: 42, velocity: 70 },
      { beat: 2, pitch: 36, velocity: 110 },
      { beat: 2.52, pitch: 42, velocity: 70 },
      { beat: 3.52, pitch: 42, velocity: 70 },
    ];
    const groove = extractGroove(notes, 4, 0.5);

    const kickSlot = groove.points.find((p) => p.gridBeat === 0)!;
    expect(kickSlot.offset).toBeCloseTo(0, 5);

    const hatSlot = groove.points.find((p) => p.gridBeat === 0.5)!;
    expect(hatSlot.offset).toBeCloseTo(0.02, 5);
  });

  it("measures velocity emphasis relative to the mean", () => {
    const notes: DrumNote[] = [
      { beat: 0, pitch: 36, velocity: 120 },
      { beat: 1, pitch: 42, velocity: 60 },
      { beat: 2, pitch: 36, velocity: 120 },
      { beat: 3, pitch: 42, velocity: 60 },
    ];
    const groove = extractGroove(notes, 4, 1);
    expect(groove.points.find((p) => p.gridBeat === 0)!.velocityFactor).toBeGreaterThan(1);
    expect(groove.points.find((p) => p.gridBeat === 1)!.velocityFactor).toBeLessThan(1);
  });

  it("folds tiled clips onto one loop", () => {
    const oneBar: DrumNote[] = [{ beat: 0.51, pitch: 42, velocity: 70 }];
    const twoBars: DrumNote[] = [
      { beat: 0.51, pitch: 42, velocity: 70 },
      { beat: 4.51, pitch: 42, velocity: 70 },
    ];
    expect(extractGroove(twoBars, 4, 0.5).points).toEqual(extractGroove(oneBar, 4, 0.5).points);
  });

  it("assigns hits just before the loop seam to slot 0, not the last slot", () => {
    const notes: DrumNote[] = [{ beat: 3.99, pitch: 36, velocity: 100 }];
    const groove = extractGroove(notes, 4, 0.5);
    const slot0 = groove.points.find((p) => p.gridBeat === 0)!;
    expect(slot0).toBeDefined();
    expect(slot0.offset).toBeCloseTo(-0.01, 5);
  });
});

describe("applyGroove", () => {
  const groove = extractGroove(
    [
      { beat: 0, pitch: 36, velocity: 120 },
      { beat: 0.53, pitch: 42, velocity: 60 },
      { beat: 1, pitch: 38, velocity: 100 },
      { beat: 1.53, pitch: 42, velocity: 60 },
    ],
    2,
    0.5,
  );

  it("moves grid notes onto the measured pocket", () => {
    const bass: DrumNote[] = [
      { beat: 0.5, pitch: 40, velocity: 90 },
      { beat: 2.5, pitch: 40, velocity: 90 }, // same slot, next loop
    ];
    const grooved = applyGroove(bass, groove);
    expect(grooved[0].beat).toBeCloseTo(0.53, 4);
    expect(grooved[1].beat).toBeCloseTo(2.53, 4);
  });

  it("scales with strength", () => {
    const bass: DrumNote[] = [{ beat: 0.5, pitch: 40, velocity: 90 }];
    expect(applyGroove(bass, groove, { strength: 0.5 })[0].beat).toBeCloseTo(0.515, 4);
    expect(applyGroove(bass, groove, { strength: 0 })[0]).toEqual(bass[0]);
  });

  it("leaves notes on slots the drums never hit untouched", () => {
    const sparse = extractGroove([{ beat: 0, pitch: 36, velocity: 100 }], 4, 0.25);
    const grooved = applyGroove([{ beat: 1.75, pitch: 40, velocity: 90 }], sparse);
    expect(grooved[0]).toEqual({ beat: 1.75, pitch: 40, velocity: 90 });
  });

  it("applies velocity emphasis and can be told not to", () => {
    const stab: DrumNote[] = [{ beat: 0, pitch: 40, velocity: 80 }];
    expect(applyGroove(stab, groove)[0].velocity).toBeGreaterThan(80);
    expect(applyGroove(stab, groove, { applyVelocity: false })[0].velocity).toBe(80);
  });
});

describe("groove-as-glue — the pocket imposed on other parts", () => {
  // A four-on-the-floor kick that drags 18 ms late on every beat, plus a
  // hot off-beat hat — a pocket you can hear.
  const drums = [
    { beat: 0, velocity: 110 },
    { beat: 0.5, velocity: 70 },
    { beat: 1, velocity: 110 },
    { beat: 1.5, velocity: 70 },
  ];

  it("measures a one-bar pocket at 16ths", () => {
    const pocket = drumPocket(drums, 4);
    expect(pocket.lengthBeats).toBe(4);
    expect(pocket.grid).toBe(0.25);
    expect(pocket.points.map((p) => p.gridBeat)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("moves grid notes onto the drums' slot and keeps pitch + duration", () => {
    const pocket = drumPocket([{ beat: 0, velocity: 110 }, { beat: 0.5, velocity: 60 }], 4);
    const bass = [{ startTime: 0, duration: 1, velocity: 100, pitch: 36 }];
    const glued = glueToPocket(bass, pocket, { strength: 1 });
    // both drum slots sit on the grid here, so the note does not move…
    expect(glued[0].startTime).toBeCloseTo(0, 6);
    // …but its velocity takes the slot's emphasis (110 vs the 85 mean)
    expect(glued[0].velocity).toBeGreaterThan(100);
    expect(glued[0].duration).toBe(1);
    expect(glued[0].pitch).toBe(36);
  });

  it("is a no-op at strength 0 and leaves unplayed slots alone", () => {
    const pocket = drumPocket(drums, 4);
    const bass = [{ startTime: 0.25, duration: 0.5, velocity: 90 }];
    expect(glueToPocket(bass, pocket, { strength: 0 })[0].startTime).toBe(0.25);
    // 0.25 is not a slot the drums play → untouched
    expect(glueToPocket(bass, pocket, { strength: 1 })[0].startTime).toBe(0.25);
  });

  it("never pushes a note before the section start", () => {
    const pocket = drumPocket([{ beat: 0, velocity: 100 }], 4);
    const late = [{ startTime: 0.6, duration: 0.4, velocity: 100 }];
    const glued = glueToPocket(late, pocket, { strength: 1 });
    expect(glued[0].startTime).toBeGreaterThanOrEqual(0);
  });

  it("summarises the pocket for the UI", () => {
    const pocket = drumPocket(drums, 4);
    const s = pocketSummary(pocket);
    expect(s.slots).toBe(4);
    expect(Number.isFinite(s.meanOffsetMs)).toBe(true);
  });
});
