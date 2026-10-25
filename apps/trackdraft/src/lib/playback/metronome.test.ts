import { describe, expect, it } from "vitest";
import { planClicks } from "./metronome";

describe("planClicks — the rehearsal click", () => {
  it("puts one click per beat at the tempo's spacing", () => {
    const notes = planClicks({ fromBeat: 0, beats: 4, bpm: 120, beatsPerBar: 4 });
    expect(notes.map((note) => note.atMs)).toEqual([0, 500, 1000, 1500]);
  });

  it("accents the downbeat of every bar", () => {
    const notes = planClicks({ fromBeat: 0, beats: 8, bpm: 60, beatsPerBar: 4 });
    const accents = notes.filter((note) => note.velocity > 100).map((note) => note.atMs);
    expect(accents).toEqual([0, 4000]);
  });

  it("starts a mid-bar plan on the next beat, not before", () => {
    const notes = planClicks({ fromBeat: 2.5, beats: 1.5, bpm: 120, beatsPerBar: 4 });
    // Beat 3 is next; it is not a downbeat, so it is a plain click.
    expect(notes).toHaveLength(1);
    expect(notes[0].atMs).toBeCloseTo(250, 5);
    expect(notes[0].velocity).toBeLessThan(100);
  });

  it("keeps the accent on the real downbeat across a loop restart", () => {
    // A loop that starts at bar 3: beat 8 is a downbeat whatever the loop is.
    const notes = planClicks({ fromBeat: 8, beats: 4, bpm: 120, beatsPerBar: 4 });
    expect(notes[0].velocity).toBeGreaterThan(100);
  });

  it("honours a 3/4 bar", () => {
    const notes = planClicks({ fromBeat: 0, beats: 6, bpm: 120, beatsPerBar: 3 });
    const accents = notes.filter((note) => note.velocity > 100).map((note) => note.atMs);
    expect(accents).toEqual([0, 1500]);
  });

  it("plans nothing for no beats", () => {
    expect(planClicks({ fromBeat: 0, beats: 0, bpm: 120, beatsPerBar: 4 })).toEqual([]);
  });
});
