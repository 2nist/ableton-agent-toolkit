import { describe, expect, it } from "vitest";
import { computeLeads } from "./leads";
import type { SectionRow } from "./types";

function section(partial: Partial<SectionRow>): SectionRow {
  return {
    grain: "section",
    songId: "s1",
    title: "Song",
    artist: "Artist",
    genre: "rock",
    key: "D",
    scale: "aeolian",
    meter: "4/4",
    sectionId: `sec-${Math.random()}`,
    section: "Section",
    role: "verse",
    velocity: "mp",
    bars: 8,
    beatsPerChord: 4,
    chordCount: 4,
    distinctDegrees: 3,
    borrowed: false,
    appliedCount: 0,
    avgTension: 0.4,
    hasMelody: true,
    hasLyrics: true,
    hasDrums: true,
    sectionIndex: 0,
    startBar: 0,
    cadences: "",
    ...partial,
  };
}

describe("computeLeads", () => {
  it("always reports facts, even on a scope too small for contrasts", () => {
    const rows = [
      section({ role: "intro", avgTension: 0.2, hasMelody: false }),
      section({ role: "verse" }),
    ];
    const leads = computeLeads(rows, "section");
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.some((lead) => lead.text.includes("% of sections carry a melody"))).toBe(true);
    expect(leads.every((lead) => !lead.id.startsWith("contrast-"))).toBe(true);
  });

  it("surfaces a support-gated group deviation with the filter that reproduces it", () => {
    const rows = [
      ...Array.from({ length: 6 }, () => section({ role: "chorus", avgTension: 0.8 })),
      ...Array.from({ length: 6 }, () => section({ role: "verse", avgTension: 0.3 })),
    ];
    const lead = computeLeads(rows, "section").find((entry) => entry.id.startsWith("contrast-") && entry.text.includes("chorus"));
    expect(lead).toBeDefined();
    expect(lead!.text).toContain("chorus");
    expect(lead!.text).toContain("mean tension");
    expect(lead!.filter).toMatchObject({ field: "role", op: "eq", value: "chorus" });
  });

  it("counts chord moves for the chord grain", () => {
    const base = {
      grain: "chord" as const,
      songId: "s1",
      title: "Song",
      artist: "",
      genre: "",
      key: "D",
      scale: "aeolian",
      meter: "4/4",
      sectionId: "sec1",
      section: "Verse",
      role: "verse",
      index: 0,
      roman: "V",
      nextRoman: "I",
      degree: "5",
      quality: "maj",
      fn: "dominant",
      borrowed: false,
      applied: false,
      cadence: "authentic",
      tension: 0.5,
      durationBeats: 4,
      startBeat: 0,
    };
    const leads = computeLeads(
      [
        { ...base, index: 0 },
        { ...base, index: 1, roman: "I", nextRoman: "V" },
        { ...base, index: 2, roman: "V", nextRoman: "I" },
      ],
      "chord",
    );
    expect(leads.find((lead) => lead.text.startsWith("Most common move"))!.text).toBe("Most common move: V → I");
  });
});
