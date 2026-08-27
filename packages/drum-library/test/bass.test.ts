import { describe, expect, it } from "vitest";
import {
  planSectionBass,
  DEFAULT_BASS_PROFILE,
  DEFAULT_BASS_OCTAVE,
  DEFAULT_BASS_VELOCITY,
  type BassOccurrence,
} from "../src/bass.js";

// E / D / C / B roots, 4 beats each — the same progression the bridge's
// bassLine test uses, so the shared generator's default matches the
// historical app/bridge output (octave 3: E=40, D=38, C=36, B=47).
const verse: BassOccurrence[] = [
  { rootPc: 4, startTime: 0, duration: 4 },
  { rootPc: 2, startTime: 4, duration: 4 },
  { rootPc: 0, startTime: 8, duration: 4 },
  { rootPc: 11, startTime: 12, duration: 4 },
];

describe("planSectionBass defaults", () => {
  it("reproduces the historical root-sustain line when no profile is given", () => {
    const notes = planSectionBass(verse);
    expect(notes).toHaveLength(4);
    expect(notes[0]).toMatchObject({ pitch: 40, startTime: 0, duration: 4 });
    expect(notes[1]).toMatchObject({ pitch: 38, startTime: 4, duration: 4 });
    expect(notes[2]).toMatchObject({ pitch: 36, startTime: 8, duration: 4 });
    expect(notes[3]).toMatchObject({ pitch: 47, startTime: 12, duration: 4 });
  });

  it("defaults to octave 3, locked rhythm, root motion, velocity 100", () => {
    expect(DEFAULT_BASS_PROFILE).toEqual({
      octave: DEFAULT_BASS_OCTAVE,
      motion: "root",
      rhythm: "locked",
      velocity: DEFAULT_BASS_VELOCITY,
    });
    expect(planSectionBass([{ rootPc: 0, startTime: 0, duration: 2 }])[0].velocity).toBe(100);
  });

  it("is legato — each note's end exactly meets the next note's start", () => {
    const notes = planSectionBass(verse);
    for (let i = 0; i < notes.length - 1; i++) {
      expect(notes[i].startTime + notes[i].duration).toBe(notes[i + 1].startTime);
    }
    expect(notes[notes.length - 1].startTime + notes[notes.length - 1].duration).toBe(16);
  });
});

describe("planSectionBass octave", () => {
  it("transposes the whole line by an octave", () => {
    const low = planSectionBass(verse, { octave: 3 });
    const high = planSectionBass(verse, { octave: 4 });
    expect(high[0].pitch).toBe(low[0].pitch + 12);
    expect(high[3].pitch).toBe(low[3].pitch + 12);
  });
});

describe("planSectionBass rhythm", () => {
  it("halves each chord's span into two notes", () => {
    const notes = planSectionBass(verse.slice(0, 1), { rhythm: "half" });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ startTime: 0, duration: 2 });
    expect(notes[1]).toMatchObject({ startTime: 2, duration: 2 });
  });

  it("splits each chord's span into four eighth notes", () => {
    const notes = planSectionBass(verse.slice(0, 1), { rhythm: "eighth" });
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => n.startTime)).toEqual([0, 1, 2, 3]);
    expect(notes.map((n) => n.duration)).toEqual([1, 1, 1, 1]);
  });
});

describe("planSectionBass motion", () => {
  it("alternates root and fifth across the subdivision with root_fifth", () => {
    // C root (pc 0) → fifth is G (pc 7); E root (pc 4) → fifth is B (pc 11).
    const notes = planSectionBass(
      [
        { rootPc: 0, startTime: 0, duration: 4 },
        { rootPc: 4, startTime: 4, duration: 4 },
      ],
      { rhythm: "half", motion: "root_fifth" },
    );
    expect(notes[0].pitch).toBe(DEFAULT_BASS_OCTAVE * 12 + 0); // C
    expect(notes[1].pitch).toBe(DEFAULT_BASS_OCTAVE * 12 + 7); // G
    expect(notes[2].pitch).toBe(DEFAULT_BASS_OCTAVE * 12 + 4); // E
    expect(notes[3].pitch).toBe(DEFAULT_BASS_OCTAVE * 12 + 11); // B
  });

  it("walks up into the next chord with a leading tone on the last subdivision", () => {
    // C (pc 0) → E (pc 4): the last 8th of the C chord approaches E from
    // one semitone below — D#/Eb = pc 3.
    const notes = planSectionBass(
      [
        { rootPc: 0, startTime: 0, duration: 4 },
        { rootPc: 4, startTime: 4, duration: 4 },
      ],
      { rhythm: "eighth", motion: "walking" },
    );
    expect(notes.slice(0, 3).map((n) => n.pitch)).toEqual([
      DEFAULT_BASS_OCTAVE * 12 + 0,
      DEFAULT_BASS_OCTAVE * 12 + 0,
      DEFAULT_BASS_OCTAVE * 12 + 0,
    ]);
    expect(notes[3].pitch).toBe(DEFAULT_BASS_OCTAVE * 12 + 3);
  });

  it("holds the root when the next chord shares the same root (walking)", () => {
    const notes = planSectionBass(
      [
        { rootPc: 0, startTime: 0, duration: 4 },
        { rootPc: 0, startTime: 4, duration: 4 },
      ],
      { rhythm: "half", motion: "walking" },
    );
    expect(notes.map((n) => n.pitch)).toEqual([
      DEFAULT_BASS_OCTAVE * 12 + 0,
      DEFAULT_BASS_OCTAVE * 12 + 0,
      DEFAULT_BASS_OCTAVE * 12 + 0,
      DEFAULT_BASS_OCTAVE * 12 + 0,
    ]);
  });

  it("walks but never approaches beyond the final chord (no next root)", () => {
    const notes = planSectionBass(verse.slice(-1), { rhythm: "half", motion: "walking" });
    expect(notes.map((n) => n.pitch)).toEqual([DEFAULT_BASS_OCTAVE * 12 + 11, DEFAULT_BASS_OCTAVE * 12 + 11]);
  });

  it("walking with locked rhythm is just roots (no subdivision to walk on)", () => {
    const notes = planSectionBass(verse, { motion: "walking" });
    expect(notes.map((n) => n.pitch)).toEqual([40, 38, 36, 47]);
  });
});

describe("planSectionBass velocity", () => {
  it("applies the profile velocity to every note", () => {
    const notes = planSectionBass(verse, { velocity: 60, rhythm: "half" });
    expect(notes.every((n) => n.velocity === 60)).toBe(true);
  });

  it("handles empty occurrences gracefully", () => {
    expect(planSectionBass([])).toEqual([]);
  });
});
