import { describe, expect, it } from "vitest";
import { planDrumClips } from "../src/drumClips.js";
import { makeSection, makeSong } from "./helpers.js";

function noteAt(notes: ReturnType<typeof planDrumClips>[number]["notes"], startTime: number) {
  return notes.filter((n) => n.startTime === startTime);
}

describe("planDrumClips", () => {
  it("puts kick on beats 1&3 and snare on 2&4 for a plain verse", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Verse 1", bars: 2, timeSignatureNumerator: 4, role: "verse" })],
    });
    const [clip] = planDrumClips(song);
    expect(clip.durationBeats).toBe(8);

    for (const beat of [0, 2, 4, 6]) {
      const hit = noteAt(clip.notes, beat).find((n) => n.pitch === 36);
      expect(hit, `expected kick at beat ${beat}`).toBeTruthy();
    }
    for (const beat of [1, 3, 5, 7]) {
      const hit = noteAt(clip.notes, beat).find((n) => n.pitch === 38);
      expect(hit, `expected snare at beat ${beat}`).toBeTruthy();
    }
  });

  it("uses 16th-note hats (4 per beat) outside bridge/chorus", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Verse 1", bars: 1, timeSignatureNumerator: 4, role: "verse" })],
    });
    const [clip] = planDrumClips(song);
    const hats = clip.notes.filter((n) => n.pitch === 42);
    expect(hats).toHaveLength(16); // 4 beats * 4 hats/beat
  });

  it("thins hats to 8th notes on a bridge", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Bridge", bars: 1, timeSignatureNumerator: 4, role: "bridge" })],
    });
    const [clip] = planDrumClips(song);
    const hats = clip.notes.filter((n) => n.pitch === 42);
    expect(hats).toHaveLength(8); // 4 beats * 2 hats/beat
  });

  it("doubles hats to 32nd notes on a chorus", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Chorus", bars: 1, timeSignatureNumerator: 4, role: "chorus" })],
    });
    const [clip] = planDrumClips(song);
    const hats = clip.notes.filter((n) => n.pitch === 42);
    expect(hats).toHaveLength(32); // 4 beats * 8 hats/beat
  });

  it("still produces a clip for a section with no chord data (drums don't need chords)", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Intro", bars: 1, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song);
    expect(clip.notes.length).toBeGreaterThan(0);
  });
});
