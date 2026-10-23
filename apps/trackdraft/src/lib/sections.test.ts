import { describe, it, expect } from "vitest";
import { addSection, removeSection, reorderSections, updateRepeats, repeatsFor, applySongMap } from "./sections";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";
import type { SongMap } from "../data/songMaps";
import { getGenreMap } from "../data/genre-catalog";
import { STYLE_RECIPES } from "./style/bend";

function makeSong(sections: Partial<BlueprintSection>[], arrangement: BlueprintSong["arrangement"] = []): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: sections.map((s, i) => ({
      id: s.id ?? `sec-${i}`,
      name: s.name ?? `Section ${i}`,
      role: s.role ?? "custom",
      bars: s.bars ?? 8,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      ...s,
    })),
    arrangement,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("repeatsFor", () => {
  it("defaults to 1 when arrangement has no entry for the section", () => {
    const song = makeSong([{ id: "a" }]);
    expect(repeatsFor(song, "a")).toBe(1);
  });

  it("reads the explicit repeat count when one exists", () => {
    const song = makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 3 }]);
    expect(repeatsFor(song, "a")).toBe(3);
  });
});

describe("addSection", () => {
  it("keeps arrangement in lockstep -- the new section gets an implicit repeats:1 entry", () => {
    const song = addSection(makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 2 }]), "verse");
    expect(song.sections).toHaveLength(2);
    expect(song.arrangement).toHaveLength(2);
    expect(song.arrangement.map((e) => e.sectionId)).toEqual(song.sections.map((s) => s.id));
    // The pre-existing section's repeat count survives untouched.
    expect(song.arrangement[0]).toEqual({ sectionId: "a", repeats: 2 });
    expect(song.arrangement[1].repeats).toBe(1);
  });
});

describe("removeSection", () => {
  it("drops the removed section's arrangement entry, keeps the rest", () => {
    const song = removeSection(
      makeSong(
        [{ id: "a" }, { id: "b" }],
        [
          { sectionId: "a", repeats: 2 },
          { sectionId: "b", repeats: 3 },
        ],
      ),
      "a",
    );
    expect(song.sections.map((s) => s.id)).toEqual(["b"]);
    expect(song.arrangement).toEqual([{ sectionId: "b", repeats: 3 }]);
  });
});

describe("reorderSections", () => {
  it("reorders arrangement to match the new sections order, preserving each entry's repeats", () => {
    const song = reorderSections(
      makeSong(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [
          { sectionId: "a", repeats: 1 },
          { sectionId: "b", repeats: 4 },
          { sectionId: "c", repeats: 1 },
        ],
      ),
      1,
      0, // move "b" to the front
    );
    expect(song.sections.map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(song.arrangement).toEqual([
      { sectionId: "b", repeats: 4 },
      { sectionId: "a", repeats: 1 },
      { sectionId: "c", repeats: 1 },
    ]);
  });
});

describe("updateRepeats", () => {
  it("sets a new repeat count for a section already covered by arrangement", () => {
    const song = updateRepeats(makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 1 }]), "a", 4);
    expect(repeatsFor(song, "a")).toBe(4);
  });

  it("self-normalizes first -- works even when arrangement only partially covers sections (real catalog data shape)", () => {
    // Mirrors a real state found in shipped data: arrangement covers some
    // sections but not others, from an earlier partial ingestion pass.
    const song = updateRepeats(makeSong([{ id: "a" }, { id: "b" }], [{ sectionId: "a", repeats: 1 }]), "b", 2);
    expect(song.arrangement).toHaveLength(2);
    expect(repeatsFor(song, "a")).toBe(1);
    expect(repeatsFor(song, "b")).toBe(2);
  });

  it("clamps negative or non-numeric input to 0 rather than producing invalid data", () => {
    const song = makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 1 }]);
    expect(repeatsFor(updateRepeats(song, "a", -5), "a")).toBe(0);
    expect(repeatsFor(updateRepeats(song, "a", NaN), "a")).toBe(0);
  });

  it("allows 0 -- deliberately skip a section without deleting it", () => {
    const song = updateRepeats(makeSong([{ id: "a" }]), "a", 0);
    expect(repeatsFor(song, "a")).toBe(0);
    expect(song.sections).toHaveLength(1); // section itself untouched
  });
});

describe("applySongMap", () => {
  it("gives every fresh section a clean repeats:1 arrangement entry, in template order", () => {
    const map: SongMap = {
      id: "test-map",
      name: "Test",
      description: "",
      slots: [
        { role: "verse", label: "Verse", purpose: "" },
        { role: "chorus", label: "Chorus", purpose: "" },
      ],
    };
    const song = applySongMap(makeSong([{ id: "old" }], [{ sectionId: "old", repeats: 5 }]), map);
    expect(song.sections).toHaveLength(2);
    expect(song.arrangement).toHaveLength(2);
    expect(song.arrangement.map((e) => e.sectionId)).toEqual(song.sections.map((s) => s.id));
    expect(song.arrangement.every((e) => e.repeats === 1)).toBe(true);
    // The old section's repeats:5 doesn't leak into the new template (fresh ids, nothing to match).
    expect(song.arrangement.some((e) => e.sectionId === "old")).toBe(false);
  });

  it("resolves a slot's progression into real chords in the map's key/scale", () => {
    const map: SongMap = {
      id: "test-map-chords",
      name: "Test",
      description: "",
      defaults: { key: "A", scale: "aeolian" },
      slots: [
        { role: "verse", label: "Verse", purpose: "", beatsPerChord: 4, progression: ["i", "bVII", "bVI", "iv"] },
        { role: "chorus", label: "Chorus", purpose: "" }, // no progression -> chords stay empty
      ],
    };
    const song = applySongMap(makeSong([]), map);
    expect(song.sections[0].chords).toHaveLength(4);
    expect(song.sections[0].chords.map((c) => c.romanNumeral)).toEqual(["i", "♭VII", "♭VI", "iv"]);
    // aeolian's i is minor, rooted on A itself.
    expect(song.sections[0].chords[0].root).toBe("A");
    expect(song.sections[0].chords[0].quality).toBe("min");
    expect(song.sections[1].chords).toEqual([]);
  });

  it("sets an explicit drumPattern only when groove names something the legacy dropdown can represent", () => {
    const map: SongMap = {
      id: "test-map-groove",
      name: "Test",
      description: "",
      slots: [
        { role: "verse", label: "Verse", purpose: "", groove: "Hard pivot to half-time, everything drags." },
        { role: "chorus", label: "Chorus", purpose: "", groove: "Warm pads, no strong beat signal here." },
        { role: "bridge", label: "Bridge", purpose: "" }, // no groove at all
      ],
    };
    const song = applySongMap(makeSong([]), map);
    expect(song.sections[0].drumPattern).toBe("half_time");
    expect(song.sections[1].drumPattern).toBeUndefined();
    expect(song.sections[2].drumPattern).toBeUndefined();
  });

  it("applies a named variant's slots instead of the map's primary slots", () => {
    const map: SongMap = {
      id: "test-map-variant",
      name: "Test",
      description: "",
      slots: [{ role: "verse", label: "Primary Verse", purpose: "" }],
      variants: [
        {
          name: "Club Loop",
          slots: [
            { role: "intro", label: "Loop A", purpose: "" },
            { role: "verse", label: "Loop B", purpose: "" },
          ],
        },
      ],
    };
    const song = applySongMap(makeSong([]), map, { variantName: "Club Loop" });
    expect(song.sections.map((s) => s.name)).toEqual(["Loop A", "Loop B"]);
  });

  it("mints the harmony rhythm fields from a slot's harmonyRhythm/harmonyRotation/syncopationOffset", () => {
    const map: SongMap = {
      id: "test-map-harmony-rhythm",
      name: "Test",
      description: "",
      slots: [
        // euclid on the slot's own 7/8 meter (3-cell groupings), no rotation
        { role: "verse", label: "Verse", purpose: "", timeSignatureNumerator: 7, timeSignatureDenPower: 3, harmonyRhythm: "euclid" },
        // same meter, rotated one cell — a real accent-pattern shift
        { role: "pre_chorus", label: "Pre-Chorus", purpose: "", timeSignatureNumerator: 7, timeSignatureDenPower: 3, harmonyRhythm: "euclid", harmonyRotation: 1 },
        // follow drums + a 16th push
        { role: "chorus", label: "Chorus", purpose: "", harmonyRhythm: "follow drums", syncopationOffset: 0.25 },
        // default beats — no harmony rhythm fields at all
        { role: "bridge", label: "Bridge", purpose: "" },
      ],
    };
    const song = applySongMap(makeSong([]), map);
    const verse = song.sections[0].harmonyMeterOutline!;
    const pre = song.sections[1].harmonyMeterOutline!;
    expect(verse.cellBeats).toBe(0.5); // /8 meter
    for (const o of [verse, pre]) {
      expect(o.cells.reduce((a, b) => a + b, 0)).toBe(7);
      expect(o.cells.every((c) => c === 2 || c === 3)).toBe(true);
    }
    expect(verse.cells).not.toEqual(pre.cells); // rotation shifts which 2s/3s reads first
    expect(song.sections[0].harmonyFollowsDrums).toBeUndefined();
    expect(song.sections[2].harmonyMeterOutline).toBeUndefined();
    expect(song.sections[2].harmonyFollowsDrums).toBe(true);
    expect(song.sections[2].syncopationOffset).toBe(0.25);
    expect(song.sections[3].harmonyMeterOutline).toBeUndefined();
    expect(song.sections[3].harmonyFollowsDrums).toBeUndefined();
    expect(song.sections[3].syncopationOffset).toBeUndefined();
  });

  it("mints euclid harmony outlines from the real math-rock genre map's 7/8 slots, keeps the 4/4 deception bridge straight", () => {
    const map = getGenreMap("genre-math-rock-78");
    expect(map).toBeDefined();
    const song = applySongMap(makeSong([]), map!);
    const byRole = (r: string) => song.sections.find((s) => s.role === r)!;
    for (const role of ["intro", "verse", "chorus"]) {
      const o = byRole(role).harmonyMeterOutline;
      expect(o?.cellBeats).toBe(0.5); // /8 meter
      expect(o?.cells.reduce((a, b) => a + b, 0)).toBe(7);
      expect(o?.cells.every((c) => c === 2 || c === 3)).toBe(true);
    }
    // The Metric Deception pivots to straight 4/4 — its harmony stays on beats.
    expect(byRole("bridge").harmonyMeterOutline).toBeUndefined();
    expect(byRole("bridge").syncopationOffset).toBeUndefined();
  });

  it("drops slots marked optional when excludeOptional is set", () => {
    const map: SongMap = {
      id: "test-map-optional",
      name: "Test",
      description: "",
      slots: [
        { role: "verse", label: "Verse", purpose: "" },
        { role: "solo", label: "Extended Solo", purpose: "", optional: true },
        { role: "outro", label: "Outro", purpose: "" },
      ],
    };
    const song = applySongMap(makeSong([]), map, { excludeOptional: true });
    expect(song.sections.map((s) => s.name)).toEqual(["Verse", "Outro"]);
  });
});

describe("applySongMap — engine genre (Groove DNA) + Bend seeding", () => {
  it("writes song.genre when the map declares defaults.genre, and leaves it alone otherwise", () => {
    const withGenre: SongMap = {
      id: "t1",
      name: "T1",
      description: "",
      defaults: { genre: "math-rock" },
      slots: [{ role: "verse", label: "V", purpose: "" }],
    };
    const noGenre: SongMap = {
      id: "t2",
      name: "T2",
      description: "",
      slots: [{ role: "verse", label: "V", purpose: "" }],
    };
    const base = makeSong([]);
    expect(applySongMap(base, withGenre).genre).toBe("math-rock");
    expect(applySongMap(base, noGenre).genre).toBeUndefined();
    // A map without an engine genre must not clear the song's existing one.
    expect(applySongMap({ ...base, genre: "rock" }, noGenre).genre).toBe("rock");
  });

  it("seedStyleRecipe copies the genre's STYLE_RECIPES entry into bend — tempo excluded, map BPM wins", () => {
    const map: SongMap = {
      id: "t3",
      name: "T3",
      description: "",
      defaults: { genre: "neo-soul", bpm: 88 },
      slots: [{ role: "verse", label: "V", purpose: "" }],
    };
    const song = applySongMap(makeSong([]), map, { seedStyleRecipe: true });
    const recipe = STYLE_RECIPES["neo-soul"];
    expect(song.genre).toBe("neo-soul");
    expect(song.bpm).toBe(88); // the map's researched tempo beats the recipe's generic one
    expect(song.bend?.energy).toBe(recipe.energy);
    expect(song.bend?.backbeat).toBe(recipe.backbeat);
    expect((song.bend as Record<string, unknown> | undefined)?.tempo).toBeUndefined();
  });

  it("does not touch bend without the seed flag (genre engages, sliders stay neutral)", () => {
    const map: SongMap = {
      id: "t4",
      name: "T4",
      description: "",
      defaults: { genre: "trap" },
      slots: [{ role: "verse", label: "V", purpose: "" }],
    };
    const plain = applySongMap(makeSong([]), map);
    expect(plain.genre).toBe("trap");
    expect(plain.bend).toBeUndefined();
    // An existing bend survives a genre-only apply untouched.
    const bent = { ...makeSong([]), bend: { energy: 0.9 } };
    expect(applySongMap(bent, map).bend).toEqual({ energy: 0.9 });
  });

});

describe("applySongMap — narrative seeding", () => {
  const arc = { tension_profile: 0.9, rhythmic_energy: 0.2, transition_delta: 0.5, structural_warp: 0.7 };
  const map: SongMap = {
    id: "arc",
    name: "Arc",
    description: "",
    defaults: { narrative: arc },
    slots: [
      { role: "verse", label: "V1", purpose: "", narrative: arc },
      { role: "chorus", label: "C", purpose: "" },
    ],
  };

  it("leaves structure-applied narrative alone without the flag", () => {
    // A template is a structure first: the arc is an opinion, so the song's
    // own master survives and fresh sections start with no arc at all.
    const mine = { tension_profile: 0.1, rhythmic_energy: 0.1, transition_delta: 0, structural_warp: 0 };
    const song = applySongMap({ ...makeSong([]), narrative: mine }, map);
    expect(song.narrative).toEqual(mine);
    expect(song.sections.every((s) => s.narrative === undefined)).toBe(true);
  });

  it("copies the master and each slot's arc when asked", () => {
    const song = applySongMap(makeSong([]), map, { seedNarrative: true });
    expect(song.narrative).toEqual(arc);
    expect(song.sections[0].narrative).toEqual(arc);
    expect(song.sections[1].narrative).toBeUndefined();
  });

  it("falls back to the song's own master when the map has none", () => {
    const mine = { tension_profile: 0.1, rhythmic_energy: 0.1, transition_delta: 0, structural_warp: 0 };
    const noMaster: SongMap = { ...map, defaults: undefined };
    const song = applySongMap({ ...makeSong([]), narrative: mine }, noMaster, { seedNarrative: true });
    expect(song.narrative).toEqual(mine);
    expect(song.sections[0].narrative).toEqual(arc); // the slot still carries its own
  });
});
