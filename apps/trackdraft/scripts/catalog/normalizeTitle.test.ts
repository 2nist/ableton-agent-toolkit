import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./normalizeTitle.js";

describe("normalizeTitle", () => {
  it("matches real chord-file and LRCLIB titles for the same song to the same key", () => {
    expect(normalizeTitle("02 - Misery")).toBe(normalizeTitle("02 - Misery"));
    expect(normalizeTitle("03 - Anna_(Go_To_Him)")).toBe(normalizeTitle("03 - Anna (Go To Him)"));
    expect(normalizeTitle("01 Come Together")).toBe(normalizeTitle("01 - Come_Together"));
  });

  it("strips leading track numbers in either dash or bare-space form", () => {
    expect(normalizeTitle("02 - Misery")).toBe("misery");
    expect(normalizeTitle("01 Come Together")).toBe("come together");
  });

  it("strips a leading CD-disc prefix too (real White Album filenames, e.g. 'CD1 - 03 - Glass_Onion')", () => {
    // Regression: without this, every White Album track silently failed to
    // match its real, present LRCLIB entry — found by running the real
    // ingestion script against real data, not by inspection.
    expect(normalizeTitle("CD1 - 03 - Glass_Onion")).toBe("glass onion");
    expect(normalizeTitle("Glass Onion")).toBe("glass onion");
  });

  it("normalizes the real underscore-for-apostrophe form both sources actually use", () => {
    // Both the chord corpus and LRCLIB's echoed-back trackName consistently
    // use "_s_" for possessives (confirmed on real files), not a literal
    // apostrophe — this is the real-world case that has to match, not a
    // hypothetical mixed-form one.
    expect(normalizeTitle("01_-_A_Hard_Day_s_Night")).toBe(normalizeTitle("01 - A Hard Day_s Night"));
  });
});
