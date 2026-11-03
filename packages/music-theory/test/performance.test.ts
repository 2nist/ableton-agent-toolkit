/**
 * Parity suite for `planChordNotes` — the single function that decides
 * "what notes does this chord make" for the MIDI export, the Ableton
 * bridge, and the in-app preview. If these three ever diverge, an audition
 * stops matching what lands in the DAW, so the block-vs-effect contract is
 * pinned down here.
 */

import { describe, expect, it } from "vitest";
import {
  applyPerformanceEffect,
  isRhythmGrid,
  parseRhythmGrid,
  planChordNotes,
} from "../src/performance";

const MAJ = [0, 4, 7]; // C major triad, semitone offsets

describe("planChordNotes", () => {
  it("returns a plain block chord when no performance effect is set", () => {
    const notes = planChordNotes(60, MAJ, 0, 4, 96);
    expect(notes).toEqual([
      { pitch: 60, startTime: 0, duration: 4, velocity: 96 },
      { pitch: 64, startTime: 0, duration: 4, velocity: 96 },
      { pitch: 67, startTime: 0, duration: 4, velocity: 96 },
    ]);
  });

  it("matches block-build + applyPerformanceEffect for a strum", () => {
    const viaPlan = planChordNotes(60, MAJ, 0, 4, 96, { style: "strum" });
    const viaTwoStep = applyPerformanceEffect(
      MAJ.map((i) => ({ pitch: 60 + i, startTime: 0, duration: 4, velocity: 96 })),
      { style: "strum" },
    );
    expect(viaPlan).toEqual(viaTwoStep);
  });

  it("strum staggers onsets from low to high and keeps the first note at the start", () => {
    const notes = planChordNotes(60, MAJ, 8, 4, 96, { style: "strum" });
    expect(notes[0].startTime).toBe(8); // lowest note lands on the downbeat
    expect(notes[1].startTime).toBeGreaterThan(8);
    expect(notes[2].startTime).toBeGreaterThan(notes[1].startTime);
    // all notes still belong to the same chord span (none start after it ends)
    for (const n of notes) expect(n.startTime).toBeLessThanOrEqual(12);
  });

  it("pulse re-triggers the chord across its span", () => {
    const notes = planChordNotes(60, MAJ, 0, 4, 96, { style: "pulse" });
    // default subdivision 4 → each of the 3 pitches appears 4 times
    expect(notes.length).toBe(12);
    const onsets = new Set(notes.map((n) => n.startTime));
    expect(onsets.size).toBeGreaterThan(1); // actually spread out, not stacked
  });

  it("arp produces one note per step, ascending by default", () => {
    const notes = planChordNotes(60, MAJ, 0, 4, 96, { style: "arp" });
    expect(notes.length).toBeGreaterThanOrEqual(MAJ.length);
    // first hit is the chord root at the start
    expect(notes[0].pitch).toBe(60);
    expect(notes[0].startTime).toBe(0);
    // steps are sequential in time, not simultaneous
    const onsets = notes.map((n) => n.startTime);
    expect(new Set(onsets).size).toBe(onsets.length);
  });

  it("honors the velocity argument on the block", () => {
    const notes = planChordNotes(60, MAJ, 0, 4, 100);
    for (const n of notes) expect(n.velocity).toBe(100);
  });

  it("plays a rhythm grid on its own sixteenths, tiled and trimmed", () => {
    const grid = "3001200030002000";

    const onsets = (notes: { startTime: number }[]) =>
      [...new Set(notes.map((n) => n.startTime))].sort((a, b) => a - b);

    // Steps 0, 3, 4, 8 and 12 of a sixteenth grid.
    expect(onsets(planChordNotes(60, MAJ, 0, 4, 100, undefined, grid))).toEqual([
      0, 0.75, 1, 2, 3,
    ]);

    // Levels are velocities under the chord's: accent is the chord's own.
    const levels = new Set(planChordNotes(60, MAJ, 0, 4, 100, undefined, grid).map((n) => n.velocity));
    expect([...levels].sort((a, b) => a - b)).toEqual([55, 80, 100]);

    // A grid is one bar and tiles over a longer chord...
    expect(onsets(planChordNotes(60, MAJ, 0, 8, 100, undefined, grid))).toEqual([
      0, 0.75, 1, 2, 3, 4, 4.75, 5, 6, 7,
    ]);

    // ...and a shorter chord uses only the steps that fit inside it.
    expect(onsets(planChordNotes(60, MAJ, 0, 2, 100, undefined, grid))).toEqual([0, 0.75, 1]);
  });

  it("applies the effect to each hit rather than to the whole chord", () => {
    const grid = "3001200030002000";
    const hits = [0, 0.75, 1, 2, 3];
    const notes = planChordNotes(60, MAJ, 0, 4, 100, { style: "arp" }, grid);

    // Every arpeggiated note belongs to one of the grid's sixteenths: the
    // effect runs inside the hit, not across the chord.
    for (const note of notes) {
      const hit = hits.find((start) => note.startTime >= start && note.startTime < start + 0.25);
      expect(hit, `${note.startTime} is inside a hit`).toBeDefined();
    }

    // And it really did subdivide: more onsets than the block would have had.
    const block = planChordNotes(60, MAJ, 0, 4, 100, undefined, grid);
    expect(new Set(notes.map((n) => n.startTime)).size).toBeGreaterThan(
      new Set(block.map((n) => n.startTime)).size,
    );
  });

  it("refuses anything that is not sixteen digits of 0-3", () => {
    expect(parseRhythmGrid("3001200030002000")).toHaveLength(16);
    expect(parseRhythmGrid("3001")).toBeNull();
    expect(parseRhythmGrid("3001200030002004")).toBeNull();
    expect(parseRhythmGrid(undefined)).toBeNull();
    expect(isRhythmGrid("3001200030002000")).toBe(true);

    // A bad grid is not a grid: the chord plays as one block, not silence.
    expect(planChordNotes(60, MAJ, 0, 4, 100, undefined, "3001")).toHaveLength(3);
  });
});
