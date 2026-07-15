import { describe, expect, it } from "vitest";
import { buildProgression, DEFAULT_OCTAVE, DEFAULT_PRESET } from "../src/build-progression.js";

describe("buildProgression", () => {
  it("defaults to the pop progression in C, at octave 5 (MIDI 60 = middle C in this library's numbering)", () => {
    const { notes, totalBeats, name } = buildProgression();

    expect(name).toBe("Pop Progression");
    expect(totalBeats).toBe(16); // 4 chords * 4 beats, the preset's default beatsPerChord
    // First chord is I (C major) — root note lands at octave*12+0 = 60 at octave 5.
    expect(notes[0]).toMatchObject({ pitch: 60, startTime: 0, duration: 4 });
  });

  it("offsets each successive chord's notes by the cumulative beat count", () => {
    const { notes } = buildProgression("jazz_turnaround", "C");
    // ii - V - I, each 4 beats by default.
    const startTimes = [...new Set(notes.map((n) => n.startTime))].sort((a, b) => a - b);
    expect(startTimes).toEqual([0, 4, 8]);
  });

  it("respects a different key", () => {
    const { notes } = buildProgression(DEFAULT_PRESET, "G");
    // I in G major → root pitch class 7, at octave 5 → 60 + 7 = 67.
    expect(notes[0]!.pitch).toBe(67);
  });

  it("respects a different octave, per this library's octave*12+pc convention", () => {
    const { notes: octave4 } = buildProgression("pop_progression", "C", 4);
    const { notes: octave5 } = buildProgression("pop_progression", "C", DEFAULT_OCTAVE);
    expect(octave5[0]!.pitch - octave4[0]!.pitch).toBe(12);
  });

  it("throws for an unknown preset, same as the underlying resolveProgression", () => {
    expect(() => buildProgression("not_a_real_preset")).toThrow();
  });
});
