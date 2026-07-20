import { describe, expect, it } from "vitest";
import { classifyNarrative } from "../src/classify.js";
import type { NarrativeForm, SectionToken } from "../src/types.js";

// A small fixture taxonomy — deliberately not the real mined data, so
// these tests don't break every time the real taxonomy evolves.
const FIXTURE_TAXONOMY: NarrativeForm[] = [
  {
    id: "verse",
    name: "Verse",
    definition: "Strophic, no chorus.",
    signature: ["verse"],
    exemplars: [],
    provenance: { addedAt: "2026-01-01T00:00:00Z", addedBy: "seed" },
  },
  {
    id: "verse-chorus",
    name: "Verse-Chorus",
    definition: "The pop staple.",
    signature: ["verse", "chorus"],
    exemplars: [],
    provenance: { addedAt: "2026-01-01T00:00:00Z", addedBy: "seed" },
  },
  {
    id: "verse-chorus-verse-chorus-bridge-chorus",
    name: "Verse-Chorus-Verse-Chorus-Bridge-Chorus",
    definition: "Full pop form with a bridge.",
    signature: ["verse", "chorus", "verse", "chorus", "bridge", "chorus"],
    exemplars: [],
    provenance: { addedAt: "2026-01-01T00:00:00Z", addedBy: "seed" },
  },
];

function tokens(...roles: SectionToken["role"][]): SectionToken[] {
  return roles.map((role) => ({ role, rawLabel: role }));
}

describe("classifyNarrative", () => {
  it("matches an exact skeleton with score 1", () => {
    const match = classifyNarrative(tokens("verse", "chorus"), FIXTURE_TAXONOMY);
    expect(match.formId).toBe("verse-chorus");
    expect(match.score).toBe(1);
  });

  it("returns null below the threshold rather than force-fitting", () => {
    // A long, unusual sequence with no close match in the fixture taxonomy.
    const match = classifyNarrative(
      tokens("bridge", "solo", "bridge", "solo", "bridge"),
      FIXTURE_TAXONOMY,
      { threshold: 0.9 },
    );
    expect(match.formId).toBeNull();
  });

  it("populates a runner-up when a second candidate scores close", () => {
    const match = classifyNarrative(tokens("verse", "chorus", "verse"), FIXTURE_TAXONOMY);
    expect(match.runnerUp).toBeDefined();
    expect(match.runnerUp!.formId).not.toBe(match.formId);
  });

  it("records the skeleton and evidence strings", () => {
    const match = classifyNarrative(tokens("intro", "verse", "chorus", "outro"), FIXTURE_TAXONOMY);
    expect(match.skeleton).toEqual(["verse", "chorus"]);
    expect(match.evidence.some((e) => e.includes("skeleton:"))).toBe(true);
  });
});
