import { describe, expect, it } from "vitest";
import type { DrumPattern, PackedPreset } from "@drum/library";
import { planDrumClips } from "../src/drumClips.js";
import { makeSection, makeSong } from "./helpers.js";

const KICK = 36;
const SNARE = 38;

/**
 * A tiny fixture preset set standing in for the real, corpus-derived
 * `PRESET_DATA` — see the note on `planDrumClips`'s `presetData` parameter
 * for why tests don't assert against actual E-GMD content.
 */
function fixturePresets(overrides: Partial<Record<DrumPattern, PackedPreset>> = {}) {
  const standard: PackedPreset = {
    lengthBeats: 4,
    variants: [
      [
        [0, KICK, 100],
        [1, SNARE, 90],
        [2, KICK, 100],
        [3, SNARE, 90],
      ],
      [
        [0, KICK, 110],
        [1.5, SNARE, 60],
        [2, KICK, 110],
        [3.5, SNARE, 60],
      ],
    ],
  };
  return { standard, ...overrides };
}

describe("planDrumClips", () => {
  it("tiles the selected variant to fill the section", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Verse 1", bars: 2, timeSignatureNumerator: 4, drumPattern: "standard" }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    expect(clip.durationBeats).toBe(8);
    // A 4-beat groove tiled to fill 8 beats repeats exactly once — both
    // repeats' kicks should be present.
    const kicks = clip.notes.filter((n) => n.pitch === KICK).map((n) => n.startTime);
    expect(kicks).toEqual(expect.arrayContaining([0, 2, 4, 6]));
  });

  it("selects a groove deterministically by section id", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "same-id", name: "Verse 1", bars: 1, timeSignatureNumerator: 4, drumPattern: "standard" }),
      ],
    });
    const a = planDrumClips(song, fixturePresets());
    const b = planDrumClips(song, fixturePresets());
    expect(a[0].notes).toEqual(b[0].notes);
  });

  it("produces an empty clip rather than throwing for a pattern with no preset data", () => {
    // Covers both "none" (no target by design) and any pattern whose
    // variants list happens to be empty — same outcome either way.
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Intro", bars: 1, timeSignatureNumerator: 4, drumPattern: "none" })],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    expect(clip.notes).toHaveLength(0);
    expect(clip.durationBeats).toBe(4);
  });

  it("produces an empty clip for '78' specifically, since the corpus has no 7/8 material", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Odd", bars: 1, timeSignatureNumerator: 7, drumPattern: "78" })],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    expect(clip.notes).toHaveLength(0);
  });

  it("scales a groove's peak velocity to the section's velocity preset without flattening its dynamics", () => {
    // The two source notes are 90 and 100 — a real spread. Scaling to `ff`
    // (120) must move the ceiling without collapsing that spread to a flat
    // value, which was the exact bug this library fixed earlier: replacing
    // every velocity with one flat number destroys ghost notes.
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({
          id: "1",
          name: "Chorus",
          bars: 1,
          timeSignatureNumerator: 4,
          drumPattern: "standard",
          velocity: "ff",
        }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    const velocities = new Set(clip.notes.map((n) => n.velocity));
    expect(velocities.size).toBeGreaterThan(1);
    expect(Math.max(...clip.notes.map((n) => n.velocity ?? 0))).toBe(120);
  });

  it("scales down for a quiet section rather than leaving loud source velocities untouched", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({
          id: "1",
          name: "Intro",
          bars: 1,
          timeSignatureNumerator: 4,
          drumPattern: "standard",
          velocity: "pp",
        }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    expect(Math.max(...clip.notes.map((n) => n.velocity ?? 0))).toBeLessThanOrEqual(48);
  });

  it("gives every note a short, un-sustained duration regardless of groove density", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Verse 1", bars: 1, timeSignatureNumerator: 4, drumPattern: "standard" }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets());
    expect(clip.notes.every((n) => n.duration === 0.25)).toBe(true);
  });

  it("still produces one clip per section even when a section has no chord data", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Verse 1", bars: 1, timeSignatureNumerator: 4, drumPattern: "standard" }),
        makeSection({ id: "2", name: "Chorus", bars: 1, timeSignatureNumerator: 4, drumPattern: "none" }),
      ],
    });
    const clips = planDrumClips(song, fixturePresets());
    expect(clips).toHaveLength(2);
  });
});
