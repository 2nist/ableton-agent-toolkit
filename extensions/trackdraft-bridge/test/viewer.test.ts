import { describe, expect, it } from "vitest";
import { buildViewerHtml } from "../src/viewer.js";
import type { BlueprintSong } from "../src/blueprint.js";

const twinFish: BlueprintSong = {
  id: "lalo-chezia-03_twin_fish",
  title: "Twin Fish",
  bpm: 60,
  key: "E",
  scale: "major",
  concept: "A song about a fish with a twin.",
  notes: {
    vocalDelivery: "Breathy, close-mic'd",
    dynamics: "Builds from verse to chorus",
    instrumentation: ["nylon guitar", "upright bass"],
    lyricalContent: "Water imagery throughout",
  },
  sections: [
    {
      id: "1",
      name: "Intro",
      bars: 8,
      timeSignatureNumerator: 4,
      role: "intro",
      chords: [
        { romanNumeral: "I", root: "E", quality: "maj", beats: 4 },
        { romanNumeral: "vi", root: "C#", quality: "min", beats: 4 },
      ],
      transitionNote: "Fades in from silence",
    },
  ],
};

describe("buildViewerHtml", () => {
  it("embeds the song's concept, notes, and section chord data", () => {
    const html = buildViewerHtml([twinFish]);
    expect(html).toContain("Twin Fish");
    expect(html).toContain("A song about a fish with a twin.");
    expect(html).toContain("Breathy, close-mic'd");
    expect(html).toContain("nylon guitar");
    expect(html).toContain("Fades in from silence");
    expect(html).toContain("romanNumeral");
  });

  it("never contains a literal closing script tag, even if prose text tries to inject one", () => {
    const malicious: BlueprintSong = {
      ...twinFish,
      concept: "</script><script>alert(1)</script>",
    };
    const html = buildViewerHtml([malicious]);
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  it("handles a song with no concept/notes/sections without emitting 'undefined'", () => {
    const bare: BlueprintSong = { id: "x", title: "Bare Song", bpm: 100, sections: [] };
    const html = buildViewerHtml([bare]);
    expect(html).toContain("Bare Song");
    expect(html).not.toContain("undefined");
  });

  it("shows a fallback message and no close-crashing state when there are no blueprints", () => {
    const html = buildViewerHtml([]);
    expect(html).toContain("No blueprints found");
  });
});
