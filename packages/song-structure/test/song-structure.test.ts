/**
 * Baseline regression suite for the ported @music-theory/song-structure.
 * See music-theory's test file for why this exists despite not mirroring
 * an upstream suite — there wasn't one to mirror.
 */

import { describe, expect, it } from "vitest";
import { buildSong, chord, getPreset, getPresetNames, getSectionBeats, getVelocity, S, sectionsEqual } from "../src/index.js";

describe("S (section builder)", () => {
  it("builds a section with the given defaults", () => {
    const section = S("Verse 1", 8, [chord("I")], 4, "standard", "mf", 4, 2, "verse");
    expect(section).toMatchObject({ name: "Verse 1", bars: 8, role: "verse", drumPattern: "standard", velocity: "mf" });
  });

  it("computes total beats as bars × time signature numerator", () => {
    const section = S("Chorus", 8, [], 4, "standard", "mf", 3, 2);
    expect(getSectionBeats(section)).toBe(24); // 8 bars * 3/x time
  });
});

describe("chord (SectionChord factory)", () => {
  it("defaults root to the degree when no explicit root is given", () => {
    expect(chord("IV")).toMatchObject({ root: "IV", degree: "IV", quality: "maj", duration: 4, isSubstitution: false });
  });
});

describe("buildSong", () => {
  it("computes totalBars and totalDurationSeconds from the arrangement, not just the section list", () => {
    const verse = S("Verse", 8, [], 4, "standard", "mf", 4, 2, "verse");
    const chorus = S("Chorus", 4, [], 4, "driving", "f", 4, 2, "chorus");

    const song = buildSong({
      title: "Test Song",
      bpm: 120,
      sections: [verse, chorus],
      arrangement: [
        { sectionName: "Verse", repeats: 2 },
        { sectionName: "Chorus", repeats: 1 },
      ],
    });

    // 8*2 + 4*1 = 20 bars, at 4/4 and 120bpm: 20*4 beats * 0.5s/beat = 40s
    expect(song.totalBars).toBe(20);
    expect(song.totalDurationSeconds).toBeCloseTo(40, 5);
    expect(Object.keys(song.sections)).toEqual(["Verse", "Chorus"]);
  });

  it("ignores arrangement entries referencing an undefined section rather than throwing", () => {
    const song = buildSong({
      title: "Broken",
      sections: [S("A", 4)],
      arrangement: [{ sectionName: "Nonexistent", repeats: 3 }],
    });
    expect(song.totalBars).toBe(0);
  });
});

describe("getVelocity", () => {
  it("maps named presets to MIDI velocity values", () => {
    expect(getVelocity("mf")).toBe(96);
    expect(getVelocity("fff")).toBe(127);
  });
});

describe("sectionsEqual", () => {
  it("treats sections with identical structure as equal regardless of name", () => {
    const a = S("Verse A", 8, [chord("I"), chord("V")], 4, "standard", "mf");
    const b = S("Verse B", 8, [chord("I"), chord("V")], 4, "standard", "mf");
    expect(sectionsEqual(a, b)).toBe(true);
  });

  it("detects a difference in chord progression length", () => {
    const a = S("A", 8, [chord("I")], 4);
    const b = S("B", 8, [chord("I"), chord("V")], 4);
    expect(sectionsEqual(a, b)).toBe(false);
  });
});

describe("presets", () => {
  it("exposes at least the 5 presets documented in prior analysis", () => {
    expect(getPresetNames().sort()).toEqual(["ambient", "blues", "dorian-groove", "pop", "rock"]);
  });

  it("every preset's arrangement only references sections it actually defines", () => {
    for (const name of getPresetNames()) {
      const preset = getPreset(name)!;
      const sectionNames = new Set(preset.sections.map((s) => s.name));
      for (const entry of preset.arrangement) {
        expect(sectionNames.has(entry.sectionName)).toBe(true);
      }
    }
  });

  it("every preset builds into a Song with positive total duration", () => {
    for (const name of getPresetNames()) {
      const preset = getPreset(name)!;
      const song = buildSong({ title: name, sections: preset.sections, arrangement: preset.arrangement });
      expect(song.totalBars).toBeGreaterThan(0);
      expect(song.totalDurationSeconds).toBeGreaterThan(0);
    }
  });
});
