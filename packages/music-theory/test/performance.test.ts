/**
 * Parity suite for `planChordNotes` — the single function that decides
 * "what notes does this chord make" for the MIDI export, the Ableton
 * bridge, and the in-app preview. If these three ever diverge, an audition
 * stops matching what lands in the DAW, so the block-vs-effect contract is
 * pinned down here.
 */

import { describe, expect, it } from "vitest";
import { applyPerformanceEffect, planChordNotes } from "../src/performance";

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
});
