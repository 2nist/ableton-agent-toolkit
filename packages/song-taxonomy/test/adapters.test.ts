import { describe, expect, it } from "vitest";
import { fromMcgill, fromRockCorpus, fromBlueprintSong } from "../src/adapters.js";

describe("fromMcgill", () => {
  it("normalizes sectionType and carries timing", () => {
    const song = {
      title: "Test",
      artist: "Tester",
      sections: [
        { start_ms: 0, duration_ms: 5000, sectionType: "Intro" },
        { start_ms: 5000, duration_ms: 10000, sectionType: "Verse" },
        { start_ms: 15000, duration_ms: 3000, sectionType: "silence" },
      ],
    };
    const tokens = fromMcgill(song);
    expect(tokens).toHaveLength(2); // silence dropped
    expect(tokens[0]).toMatchObject({ role: "intro", startMs: 0, durationMs: 5000 });
    expect(tokens[1]).toMatchObject({ role: "verse", startMs: 5000, durationMs: 10000 });
  });
});

describe("fromRockCorpus", () => {
  it("expands high-confidence abbreviations and drops markers", () => {
    const song = {
      metadata: { title: "Test", artist: "Tester" },
      sections: [
        { time: 0, duration: 10, label: "In" },
        { time: 10, duration: 20, label: "Vr2" },
        { time: 30, duration: 5, label: "Br*2" },
        { time: 35, duration: 1, label: "|" },
        { time: 36, duration: 1, label: "[12/8]" },
        { time: 37, duration: 8, label: "So" },
        { time: 45, duration: 4, label: "Rf" },
        { time: 49, duration: 4, label: "Pc" },
      ],
    };
    const tokens = fromRockCorpus(song);
    expect(tokens.map((t) => t.role)).toEqual(["intro", "verse", "bridge", "solo", "chorus", "pre_chorus"]);
  });

  it("falls unmapped abbreviations through to 'other' rather than guessing", () => {
    const song = {
      metadata: { title: "Test", artist: "Tester" },
      sections: [{ time: 0, duration: 10, label: "Zz" }],
    };
    expect(fromRockCorpus(song)[0].role).toBe("other");
  });
});

describe("fromBlueprintSong", () => {
  it("prefers a real role over name", () => {
    const song = { sections: [{ role: "chorus", name: "Verse 1" }] };
    expect(fromBlueprintSong(song)[0].role).toBe("chorus");
  });

  it("falls back to name when role is the 'custom' placeholder", () => {
    const song = { sections: [{ role: "custom", name: "Bridge" }] };
    expect(fromBlueprintSong(song)[0].role).toBe("bridge");
  });

  it("derives lyricLineCount from section lyrics text", () => {
    const song = {
      sections: [{ role: "custom", name: "Verse 1", lyrics: "line one\nline two\n\nline three" }],
    };
    expect(fromBlueprintSong(song)[0].lyricLineCount).toBe(3);
  });

  it("drops silence sections even in BlueprintSong shape", () => {
    const song = { sections: [{ role: "custom", name: "silence" }, { role: "custom", name: "verse" }] };
    expect(fromBlueprintSong(song)).toHaveLength(1);
  });
});
