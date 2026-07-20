import { describe, expect, it } from "vitest";
import { parseBeatlesJcrd } from "./beatlesJcrd.js";

describe("parseBeatlesJcrd", () => {
  it("parses real metadata, key, and mode", () => {
    const raw = parseBeatlesJcrd({
      metadata: { title: "I Am The Walrus", artist: "The Beatles", key: "Key A", tempo: 87 },
      sections: [],
    });
    expect(raw.title).toBe("I Am The Walrus");
    expect(raw.artist).toBe("The Beatles");
    expect(raw.key).toBe("A");
    expect(raw.mode).toBe("ionian");
    expect(raw.bpm).toBe(87);
  });

  it("maps a real minor-key tag to aeolian", () => {
    const raw = parseBeatlesJcrd({ metadata: { key: "Key C#:minor" }, sections: [] });
    expect(raw.key).toBe("C#");
    expect(raw.mode).toBe("aeolian");
  });

  it("maps real modal tags (dorian/mixolydian) directly, not just major/minor", () => {
    expect(parseBeatlesJcrd({ metadata: { key: "Key D:mixolydian" }, sections: [] }).mode).toBe("mixolydian");
    expect(parseBeatlesJcrd({ metadata: { key: "Key F:dorian" }, sections: [] }).mode).toBe("dorian");
  });

  it("falls back to ionian with a warning for an ambiguous 'modal' tag", () => {
    const raw = parseBeatlesJcrd({ metadata: { key: "Key C#:modal" }, sections: [] });
    expect(raw.mode).toBe("ionian");
    expect(raw.warnings.some((w) => w.includes("Ambiguous mode"))).toBe(true);
  });

  it("parses bare chords as major and 'm' suffix as minor", () => {
    const raw = parseBeatlesJcrd({
      metadata: {},
      sections: [
        {
          name: "verse",
          start_time: 0,
          end_time: 8,
          chords: [
            { chord: "A", start_time: 0, end_time: 4 },
            { chord: "Cm", start_time: 4, end_time: 8 },
          ],
        },
      ],
    });
    expect(raw.sections[0].chords).toEqual([
      { startSec: 0, endSec: 4, root: "A", quality: "maj" },
      { startSec: 4, endSec: 8, root: "C", quality: "min" },
    ]);
  });

  it("treats 'N' (no chord) as a rest, not an error", () => {
    const raw = parseBeatlesJcrd({
      metadata: {},
      sections: [{ name: "silence", start_time: 0, end_time: 1, chords: [{ chord: "N", start_time: 0, end_time: 1 }] }],
    });
    expect(raw.sections[0].chords).toEqual([]);
    expect(raw.warnings).toEqual([]);
  });

  it("parses the full real chord vocabulary observed on disk without errors", () => {
    // Sampled from actual Beatles-Chords/*.jcrd.json files this session.
    const realChords = [
      "A",
      "A6",
      "A7",
      "A9",
      "Aaug",
      "Abm",
      "Adim",
      "Adim7",
      "Am",
      "Am6",
      "Am7",
      "Am9",
      "Asus",
      "Bbsus7",
      "Bbsus9",
      "C#",
      "Ddim",
      "Gdim7",
    ];
    const raw = parseBeatlesJcrd({
      metadata: {},
      sections: [
        {
          name: "verse",
          start_time: 0,
          end_time: realChords.length * 4,
          chords: realChords.map((chord, i) => ({ chord, start_time: i * 4, end_time: (i + 1) * 4 })),
        },
      ],
    });
    expect(raw.sections[0].chords).toHaveLength(realChords.length);
    raw.sections[0].chords.forEach((c) => {
      expect(c.root).toMatch(/^[A-G][#b]?$/);
      expect(c.quality).not.toBeNull();
    });
  });

  it("flags simplified extended chords honestly rather than silently", () => {
    const raw = parseBeatlesJcrd({
      metadata: {},
      sections: [{ name: "v", start_time: 0, end_time: 4, chords: [{ chord: "Gdim7", start_time: 0, end_time: 4 }] }],
    });
    expect(raw.sections[0].chords[0]).toEqual({ startSec: 0, endSec: 4, root: "G", quality: "dim" });
    expect(raw.warnings.some((w) => w.includes("simplified"))).toBe(true);
  });

  it("keeps a chords-less silence section rather than dropping it", () => {
    const raw = parseBeatlesJcrd({
      metadata: {},
      sections: [{ name: "silence", start_time: 0, end_time: 0.394, chords: [] }],
    });
    expect(raw.sections).toHaveLength(1);
    expect(raw.sections[0].chords).toEqual([]);
  });
});
