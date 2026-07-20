import { describe, expect, it } from "vitest";
import { normalizeRole } from "../src/roles.js";

describe("normalizeRole", () => {
  it("maps all 12 McGill sectionType values", () => {
    expect(normalizeRole("Verse")).toBe("verse");
    expect(normalizeRole("Intro")).toBe("intro");
    expect(normalizeRole("Chorus")).toBe("chorus");
    expect(normalizeRole("Bridge")).toBe("bridge");
    expect(normalizeRole("Transition")).toBe("link");
    expect(normalizeRole("Other")).toBe("other");
    expect(normalizeRole("Outro")).toBe("outro");
    expect(normalizeRole("PreChorus")).toBe("pre_chorus");
    expect(normalizeRole("Instrumental")).toBe("link");
    expect(normalizeRole("Solo")).toBe("solo");
    expect(normalizeRole("Breakdown")).toBe("link");
    expect(normalizeRole("Interlude")).toBe("link");
  });

  it("drops silence and other non-section annotations", () => {
    expect(normalizeRole("silence")).toBeNull();
    expect(normalizeRole("applause")).toBeNull();
    expect(normalizeRole("")).toBeNull();
    expect(normalizeRole("   ")).toBeNull();
  });

  it("maps Beatles-catalog naming variants", () => {
    expect(normalizeRole("refrain")).toBe("chorus");
    expect(normalizeRole("refrain_a")).toBe("chorus");
    expect(normalizeRole("refrain_with_ending")).toBe("chorus");
    expect(normalizeRole("verse_(guitar_solo)")).toBe("solo");
    expect(normalizeRole("sitar_solo")).toBe("solo");
    expect(normalizeRole("verse_(instrumental)")).toBe("verse");
    expect(normalizeRole("verse'")).toBe("verse");
    expect(normalizeRole("verse_(variant_2)")).toBe("verse");
    expect(normalizeRole("middle_eight")).toBe("bridge");
    expect(normalizeRole("bridge_extension")).toBe("bridge");
    expect(normalizeRole("half_verse_(climax)")).toBe("verse");
    expect(normalizeRole("mantra")).toBe("other");
    expect(normalizeRole("part_1_")).toBe("other");
  });

  it("tests pre_chorus before chorus, so it never falls into chorus", () => {
    expect(normalizeRole("pre-chorus")).toBe("pre_chorus");
    expect(normalizeRole("pre_chorus")).toBe("pre_chorus");
    expect(normalizeRole("prechorus")).toBe("pre_chorus");
  });
});
