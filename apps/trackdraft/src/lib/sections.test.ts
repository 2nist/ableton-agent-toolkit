import { describe, it, expect } from "vitest";
import {
  addSection,
  removeSection,
  reorderSections,
  updateRepeats,
  repeatsFor,
  applySongMap,
  splitSection,
  partBars,
  splitSectionAt,
  mergeWithNext,
  foldSectionSplits,
  splitSectionAtBar,
  duplicateSection,
  copySectionTo,
  insertSection,
  clearPassOverride,
  passOverrideFor,
  removePass,
  repeatPassLike,
  setPassOverride,
} from "./sections";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";
import { sectionSpans } from "./arrangement";
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

describe("splitSection", () => {
  const chord = (root: string, beats: number) => ({ id: `${root}-${beats}`, root, quality: "min" as const, beats, romanNumeral: "" });

  it("replaces one section with the parts its chord stream is made of", () => {
    const song = makeSong([{ id: "a" }, { id: "big", name: "Unlabeled", bars: 16, role: "verse" }]);
    const split = splitSection(song, "big", [
      { label: "A", chords: [chord("D", 4), chord("Bb", 4)], repeats: 3 },
      { label: "B", chords: [chord("C", 4)], repeats: 1 },
    ]);
    expect(split.sections.map((s) => s.name)).toEqual(["Section 0", "A", "B"]);
    expect(split.sections[1].chords).toHaveLength(2);
    expect(split.sections[1].bars).toBe(2);
    // Role, meter and velocity are the parent's — a detected split moves
    // boundaries, it doesn't re-label the material.
    expect(split.sections[1].role).toBe("verse");
    expect(split.sections[1].timeSignatureDenPower).toBe(2);
    expect(split.sections[1].beatsPerChord).toBe(4);
  });

  it("marks consecutive passes as repeats rather than extra sections", () => {
    const song = makeSong([{ id: "big" }]);
    const split = splitSection(song, "big", [{ label: "A", chords: [chord("D", 4)], repeats: 4 }]);
    expect(split.sections).toHaveLength(1);
    expect(split.arrangement).toEqual([{ sectionId: split.sections[0].id, repeats: 4 }]);
  });

  it("keeps the arrangement in step with the new section list", () => {
    const song = makeSong([{ id: "intro" }, { id: "big" }, { id: "outro" }]);
    const split = splitSection(song, "big", [
      { label: "A", chords: [chord("D", 4)], repeats: 2 },
      { label: "B", chords: [chord("C", 4)], repeats: 1 },
    ]);
    expect(split.arrangement.map((entry) => entry.sectionId)).toEqual(split.sections.map((s) => s.id));
    expect(split.arrangement.map((entry) => entry.repeats)).toEqual([1, 2, 1, 1]);
  });

  it("leaves the song alone when the section is gone", () => {
    const song = makeSong([{ id: "a" }]);
    expect(splitSection(song, "nope", [{ label: "A", chords: [], repeats: 1 }])).toBe(song);
    expect(splitSection(song, "a", [])).toBe(song);
  });

  it("keeps lyrics on the first part so nothing is lost", () => {
    const song = makeSong([{ id: "big", lyrics: "first line\nsecond line" }]);
    const split = splitSection(song, "big", [
      { label: "A", chords: [chord("D", 4)], repeats: 1 },
      { label: "B", chords: [chord("C", 4)], repeats: 1 },
    ]);
    expect(split.sections[0].lyrics).toBe("first line\nsecond line");
    expect(split.sections[1].lyrics).toBeUndefined();
  });
});

describe("partBars", () => {
  it("gives each part whole bars that cover its own chords", () => {
    expect(partBars([16, 16, 16], 4)).toEqual([4, 4, 4]);
  });

  it("rounds a part that ends mid-bar up, never down", () => {
    // 21 beats of 3-beat chords = 5.25 bars: five bars would cut the last
    // chord, which is what export does with an over-long section.
    expect(partBars([21, 9, 15], 4)).toEqual([6, 3, 4]);
    for (const [beats, bars] of [[21, 6], [9, 3], [15, 4]] as const) {
      expect(bars * 4).toBeGreaterThanOrEqual(beats);
    }
  });

  it("never returns zero bars, even for an empty part", () => {
    expect(partBars([0, 4], 4)).toEqual([1, 1]);
  });

  it("measures bars with the section's own meter", () => {
    expect(partBars([7, 7], 7)).toEqual([1, 1]);
  });
});

function chordSet(count: number, beats = 4) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    romanNumeral: "",
    root: "C" as const,
    quality: "maj" as const,
    beats,
  }));
}

describe("splitSectionAt — a cut where the reading didn't put one", () => {
  const song = () =>
    makeSong([
      { id: "long", name: "Unlabeled", bars: 8, chords: chordSet(16) },
      { id: "after", name: "Outro", bars: 4 },
    ]);

  it("cuts at the chord, not through it", () => {
    const next = splitSectionAt(song(), "long", "c8");
    expect(next.sections.map((s) => s.id)).not.toContain("long");
    expect(next.sections).toHaveLength(3);
    expect(next.sections[0].chords).toHaveLength(8);
    expect(next.sections[1].chords).toHaveLength(8);
    expect(next.sections[1].chords[0].id).toBe("c8");
    // an unnamed block gets plain letters
    expect([next.sections[0].name, next.sections[1].name]).toEqual(["A", "B"]);
    // 8 bars of 4/4 at 4 beats per chord → each half is 8 bars… unchanged
    expect([next.sections[0].bars, next.sections[1].bars]).toEqual([8, 8]);
  });

  it("keeps a named block's name on both halves", () => {
    const next = splitSectionAt(makeSong([{ id: "v", name: "Verse", chords: chordSet(8) }]), "v", "c4");
    expect([next.sections[0].name, next.sections[1].name]).toEqual(["Verse A", "Verse B"]);
  });

  it("refuses a cut at the first chord — that would make an empty section", () => {
    const next = splitSectionAt(song(), "long", "c0");
    expect(next.sections).toHaveLength(2);
    expect(next.sections[0].id).toBe("long");
  });
});

describe("mergeWithNext — the undo of an over-eager split", () => {
  it("joins two sections into one block of their chords", () => {
    const song = makeSong([
      { id: "a", name: "A", bars: 2, chords: chordSet(4) },
      { id: "b", name: "B", bars: 2, chords: chordSet(4) },
      { id: "c", name: "C", bars: 2, chords: chordSet(4) },
    ]);
    const next = mergeWithNext(song, "a");
    expect(next.sections.map((s) => s.name)).toEqual(["A", "C"]);
    expect(next.sections[0].chords).toHaveLength(8);
    // 8 chords × 4 beats = 32 beats = 8 bars of 4/4
    expect(next.sections[0].bars).toBe(8);
  });

  it("expands repeats into the chord list rather than losing them", () => {
    const song = makeSong(
      [
        { id: "a", name: "A", bars: 2, chords: chordSet(4) },
        { id: "b", name: "B", bars: 2, chords: chordSet(4) },
      ],
      [],
    );
    const repeated = updateRepeats(song, "a", 2);
    const next = mergeWithNext(repeated, "a");
    expect(next.sections[0].chords).toHaveLength(12);
    expect(next.sections[0].bars).toBe(12);
    expect(next.arrangement[0].repeats).toBe(1);
  });

  it("does nothing on the last section", () => {
    const song = makeSong([{ id: "a" }, { id: "b" }]);
    expect(mergeWithNext(song, "b").sections).toHaveLength(2);
  });
});

describe("foldSectionSplits — the reading is a proposal", () => {
  const part = (label: string, chords: ReturnType<typeof chordSet>, repeats = 1) => ({
    label,
    chords,
    repeats,
    bars: Math.ceil(chords.length * 4 / 4),
  });

  it("folds a part into the one above it and re-derives whole bars", () => {
    const splits = [part("A", chordSet(4)), part("A", chordSet(4)), part("B", chordSet(8))];
    const folded = foldSectionSplits(splits, [1], 4);
    expect(folded).toHaveLength(2);
    expect(folded[0].chords).toHaveLength(8);
    expect(folded[0].bars).toBe(8);
    expect(folded[1].label).toBe("B");
  });

  it("expands the passes of the part above, because they are literal now", () => {
    const splits = [part("A", chordSet(4), 2), part("B", chordSet(4))];
    const folded = foldSectionSplits(splits, [1], 4);
    expect(folded).toHaveLength(1);
    expect(folded[0].chords).toHaveLength(12);
    expect(folded[0].repeats).toBe(1);
    expect(folded[0].bars).toBe(12);
  });

  it("leaves the list alone when nothing is folded", () => {
    const splits = [part("A", chordSet(4)), part("B", chordSet(4))];
    expect(foldSectionSplits(splits, [], 4)).toHaveLength(2);
  });
});

describe("splitSectionAtBar — the cut a bar strip means", () => {
  it("cuts at the first chord at or after that bar", () => {
    // 8 chords of 4 beats in 4/4: bar 5 starts at beat 16 = chord 4.
    const song = makeSong([{ id: "long", name: "Block", bars: 8, chords: chordSet(8) }]);
    const next = splitSectionAtBar(song, "long", 4);
    expect(next.sections).toHaveLength(2);
    expect(next.sections[0].chords).toHaveLength(4);
    expect(next.sections[1].chords[0].id).toBe("c4");
    expect(next.sections[0].bars + next.sections[1].bars).toBe(8);
  });

  it("does nothing for bar 1 or a bar past the end", () => {
    const song = makeSong([{ id: "long", bars: 8, chords: chordSet(8) }]);
    expect(splitSectionAtBar(song, "long", 0).sections).toHaveLength(1);
    expect(splitSectionAtBar(song, "long", 99).sections).toHaveLength(1);
  });
});

describe("structural edits move the section's timed data", () => {
  const chord = (id: string, beats = 4) => ({ id, root: "D", quality: "min" as const, beats, romanNumeral: "" });
  const eight = () => Array.from({ length: 8 }, (_, i) => chord(`c${i}`));

  it("splits tonic regions at the cut and re-bases the tail", () => {
    // D for the first four bars, F from bar 5 — a modulation inside one block.
    const song = makeSong([
      {
        id: "big",
        bars: 8,
        chords: eight(),
        tonicRegions: [
          { startBeat: 0, key: "D", scale: "aeolian", source: "authored" },
          { startBeat: 16, key: "F", scale: "ionian", source: "authored" },
        ],
      },
    ]);
    const next = splitSectionAtBar(song, "big", 4);
    expect(next.sections[0].tonicRegions).toEqual([
      { startBeat: 0, key: "D", scale: "aeolian", source: "authored" },
    ]);
    // The tail opens on the home that was in force at the cut — not beat 16.
    expect(next.sections[1].tonicRegions).toEqual([
      { startBeat: 0, key: "F", scale: "ionian", source: "authored" },
    ]);
  });

  it("splits a meter map and opens the tail on the meter in force", () => {
    const song = makeSong([
      { id: "big", bars: 8, chords: eight(), meterMap: [{ bar: 4, numerator: 7, denominator: 8 }] },
    ]);
    const next = splitSectionAtBar(song, "big", 4);
    expect(next.sections[0].meterMap).toBeUndefined();
    expect(next.sections[0].timeSignatureNumerator).toBe(4);
    // The tail's 7/8 bar is its own bar 1 now, and its opening meter is 7/8.
    expect(next.sections[1].meterMap).toEqual([{ bar: 0, numerator: 7, denominator: 8 }]);
    expect(next.sections[1].timeSignatureNumerator).toBe(7);
    expect(next.sections[1].timeSignatureDenPower).toBe(3);
  });

  it("cuts on the real bar length when a meter map changes it", () => {
    // Bars: 4, 3.5, 4, 4 — so bar 2 starts at beat 7.5, not 8.
    const song = makeSong([
      { id: "big", bars: 4, chords: [chord("c0"), chord("c1"), chord("c2"), chord("c3")], meterMap: [{ bar: 1, numerator: 7, denominator: 8 }] },
    ]);
    const next = splitSectionAtBar(song, "big", 2);
    expect(next.sections[0].chords.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(next.sections[1].chords.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("slices the melody and the lyric timeline, dropping generator provenance", () => {
    const song = makeSong([
      {
        id: "big",
        bars: 8,
        chords: eight(),
        melody: {
          notes: [
            { pitch: 62, startTime: 0, duration: 2 },
            { pitch: 65, startTime: 20, duration: 2 },
          ],
          source: "generated",
          seed: 7,
        },
        lyricsTimeline: [
          { text: "first", startBeat: 4 },
          { text: "second", startBeat: 20 },
        ],
        transitionNote: "drum fill",
        harmonyMeterOutline: { cellBeats: 0.5, cells: [2, 3], label: "1 2 3" },
      },
    ]);
    const next = splitSectionAtBar(song, "big", 4);
    expect(next.sections[0].melody?.notes).toEqual([{ pitch: 62, startTime: 0, duration: 2 }]);
    expect(next.sections[1].melody?.notes).toEqual([{ pitch: 65, startTime: 4, duration: 2 }]);
    expect(next.sections[0].melody?.source).toBeUndefined();
    expect(next.sections[0].lyricsTimeline).toEqual([{ text: "first", startBeat: 4 }]);
    expect(next.sections[1].lyricsTimeline).toEqual([{ text: "second", startBeat: 4 }]);
    // Whole-section fields stay on the head.
    expect(next.sections[0].transitionNote).toBe("drum fill");
    expect(next.sections[1].transitionNote).toBeUndefined();
    expect(next.sections[0].harmonyMeterOutline).toBeDefined();
    expect(next.sections[1].harmonyMeterOutline).toBeUndefined();
  });

  it("merges the second section's timed data behind the first", () => {
    const song = makeSong([
      {
        id: "a",
        bars: 4,
        chords: [chord("a0"), chord("a1"), chord("a2"), chord("a3")],
        tonicRegions: [{ startBeat: 0, key: "D", scale: "aeolian", source: "authored" }],
        melody: { notes: [{ pitch: 62, startTime: 0, duration: 2 }] },
      },
      {
        id: "b",
        bars: 4,
        chords: [chord("b0"), chord("b1"), chord("b2"), chord("b3")],
        tonicRegions: [{ startBeat: 0, key: "F", scale: "ionian", source: "authored" }],
        melody: { notes: [{ pitch: 65, startTime: 4, duration: 2 }] },
        meterMap: [{ bar: 2, numerator: 7, denominator: 8 }],
      },
    ], [{ sectionId: "a", repeats: 1 }, { sectionId: "b", repeats: 1 }]);
    const merged = mergeWithNext(song, "a").sections[0];
    expect(merged.chords).toHaveLength(8);
    expect(merged.tonicRegions).toEqual([
      { startBeat: 0, key: "D", scale: "aeolian", source: "authored" },
      { startBeat: 16, key: "F", scale: "ionian", source: "authored" },
    ]);
    expect(merged.melody?.notes).toEqual([
      { pitch: 62, startTime: 0, duration: 2 },
      { pitch: 65, startTime: 20, duration: 2 },
    ]);
    // The second section's 7/8 bar is now the merged block's bar 7.
    expect(merged.meterMap).toEqual([{ bar: 6, numerator: 7, denominator: 8 }]);
  });
});

describe("duplicateSection", () => {
  const song = () =>
    makeSong([
      { id: "a", name: "Verse 1", role: "verse" },
      { id: "b", name: "Chorus", role: "chorus" },
    ]);

  it("puts the copy directly after its source and hands back its id", () => {
    const result = duplicateSection(song(), "a");
    expect(result).not.toBeNull();
    expect(result!.song.sections.map((s) => s.name)).toEqual([
      "Verse 1",
      "Verse 2",
      "Chorus",
    ]);
    expect(result!.song.sections[1].id).toBe(result!.sectionId);
  });

  it("owns its material — editing the copy must not move the original", () => {
    const source = makeSong([
      {
        id: "a",
        name: "Verse 1",
        role: "verse",
        chords: [
          { id: "c1", root: "C", quality: "maj", beats: 4, romanNumeral: "I" },
        ],
        bassNotes: [{ pitch: 36, startTime: 0, duration: 4 }],
      },
    ]);
    const copy = duplicateSection(source, "a")!.song.sections[1];
    expect(copy.chords).not.toBe(source.sections[0].chords);
    expect(copy.bassNotes).not.toBe(source.sections[0].bassNotes);
  });

  it("returns null for a section that is gone", () => {
    expect(duplicateSection(song(), "nope")).toBeNull();
  });

  it("keeps the arrangement covering the sections", () => {
    expect(duplicateSection(song(), "b")!.song.arrangement).toHaveLength(3);
  });

  it("leaves the source where it was", () => {
    const out = duplicateSection(song(), "a")!.song;
    expect(out.sections[0].id).toBe("a");
    expect(out.sections[0].name).toBe("Verse 1");
    expect(out.sections[2].id).toBe("b");
  });
});

describe("copySectionTo", () => {
  const song = () =>
    makeSong([
      { id: "a", name: "Verse 1", role: "verse" },
      { id: "b", name: "Chorus", role: "chorus" },
      { id: "c", name: "Bridge", role: "bridge" },
    ]);

  it("puts the copy where the drop was, before what was there", () => {
    const out = copySectionTo(song(), "a", 2);
    expect(out.sections.map((s) => s.name)).toEqual([
      "Verse 1",
      "Chorus",
      "Verse 2",
      "Bridge",
    ]);
  });

  it("can copy the same section twice, in two places", () => {
    const once = copySectionTo(song(), "b", 0);
    const twice = copySectionTo(once, "b", 3);
    const names = twice.sections.map((s) => s.name);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    // The copies are where the drops were; the originals are untouched.
    expect(names[2]).toBe("Chorus");
    expect(twice.sections[0].id).not.toBe("b");
    expect(twice.sections[3].id).not.toBe("b");
  });

  it("owns its material, like any other copy", () => {
    const source = makeSong([
      {
        id: "a",
        name: "Verse 1",
        role: "verse",
        chords: [
          { id: "c1", root: "C", quality: "maj", beats: 4, romanNumeral: "I" },
        ],
        bassNotes: [{ pitch: 36, startTime: 0, duration: 4 }],
      },
    ]);
    const out = copySectionTo(source, "a", 1);
    expect(out.sections[1].chords).not.toBe(source.sections[0].chords);
    expect(out.sections[1].bassNotes).not.toBe(source.sections[0].bassNotes);
  });

  it("clamps a drop past the end, and ignores a section that is gone", () => {
    expect(copySectionTo(song(), "a", 99).sections).toHaveLength(4);
    expect(copySectionTo(song(), "nope", 0).sections).toHaveLength(3);
  });

  it("keeps the arrangement covering the sections", () => {
    expect(copySectionTo(song(), "a", 3).arrangement).toHaveLength(4);
  });
});

describe("insertSection", () => {
  const song = () =>
    makeSong([
      { id: "a", name: "Verse 1", role: "verse" },
      { id: "b", name: "Chorus", role: "chorus" },
    ]);

  it("puts a blank section between two others", () => {
    const result = insertSection(song(), 1);
    expect(result).not.toBeNull();
    expect(result!.song.sections.map((s) => s.name)).toEqual([
      "Verse 1",
      "Verse 2",
      "Chorus",
    ]);
    expect(result!.song.sections[1].id).toBe(result!.sectionId);
    expect(result!.song.sections[1].chords).toEqual([]);
  });

  it("can insert at the very front and the very back", () => {
    const front = insertSection(song(), 0)!;
    expect(front.song.sections[0].id).toBe(front.sectionId);
    const back = insertSection(song(), 2)!;
    expect(back.song.sections[2].id).toBe(back.sectionId);
  });

  it("clamps a position outside the song", () => {
    const past = insertSection(song(), 99)!;
    expect(past.song.sections).toHaveLength(3);
    expect(past.song.sections[2].id).toBe(past.sectionId);

    const before = insertSection(song(), -5)!;
    expect(before.song.sections).toHaveLength(3);
    expect(before.song.sections[0].id).toBe(before.sectionId);
  });

  it("names the new section against the roles already there", () => {
    const withTwo = makeSong([
      { id: "a", name: "Verse 1", role: "verse" },
      { id: "b", name: "Verse 2", role: "verse" },
    ]);
    expect(insertSection(withTwo, 2)!.song.sections[2].name).toBe("Verse 3");
    expect(insertSection(withTwo, 2, "chorus")!.song.sections[2].name).toBe(
      "Chorus 1",
    );
  });

  it("keeps the arrangement covering the sections", () => {
    const result = insertSection(song(), 1)!;
    expect(result.song.arrangement).toHaveLength(3);
  });
});

describe("per-pass overrides (§P4.1)", () => {
  const song = () =>
    makeSong([{ id: "a" }, { id: "b" }], [
      { sectionId: "a", repeats: 3 },
      { sectionId: "b", repeats: 1 },
    ]);

  it("writes a value for one pass only", () => {
    const withClock = setPassOverride(song(), "a", 2, { timeDomain: { rate: 0.5 } });
    expect(passOverrideFor(withClock, "a", 2)).toEqual({ timeDomain: { rate: 0.5 } });
    expect(passOverrideFor(withClock, "a", 1)).toBeNull();
    // The authored section is untouched: this is an instance, not a copy.
    expect(withClock.sections.find((s) => s.id === "a")?.timeDomain).toBeUndefined();
  });

  it("merges a second field instead of replacing the first", () => {
    const both = setPassOverride(
      setPassOverride(song(), "a", 1, { timeDomain: { rate: 2 } }),
      "a",
      1,
      { velocity: "ff" },
    );
    expect(passOverrideFor(both, "a", 1)).toEqual({
      timeDomain: { rate: 2 },
      velocity: "ff",
    });
  });

  it("clears a field by writing undefined, and drops the pass when nothing is left", () => {
    const set = setPassOverride(song(), "a", 1, { timeDomain: { rate: 2 } });
    const cleared = setPassOverride(set, "a", 1, { timeDomain: undefined });
    expect(passOverrideFor(cleared, "a", 1)).toBeNull();
    // Nothing left behind: no empty record, no `occurrenceOverrides: {}`.
    expect(cleared.arrangement.find((e) => e.sectionId === "a")?.occurrenceOverrides).toBeUndefined();
  });

  it("clears a whole pass, and is a no-op when there was nothing to clear", () => {
    const set = setPassOverride(song(), "a", 1, { timeDomain: { rate: 2 }, velocity: "ff" });
    expect(passOverrideFor(clearPassOverride(set, "a", 1), "a", 1)).toBeNull();
    const untouched = clearPassOverride(song(), "a", 1);
    expect(passOverrideFor(untouched, "a", 1)).toBeNull();
  });

  it("self-normalizes: works on a song whose arrangement is incomplete", () => {
    const loose = { ...song(), arrangement: [{ sectionId: "a", repeats: 2 }] };
    const withClock = setPassOverride(loose, "b", 0, { timeDomain: { rate: 0.5 } });
    expect(passOverrideFor(withClock, "b", 0)).toEqual({ timeDomain: { rate: 0.5 } });
  });

  it("leaves the other sections' entries exactly as they were", () => {
    const withClock = setPassOverride(song(), "a", 0, { timeDomain: { rate: 2 } });
    expect(withClock.arrangement.find((e) => e.sectionId === "b")).toEqual(
      song().arrangement.find((e) => e.sectionId === "b"),
    );
  });
});

describe("removePass (§P4.2)", () => {
  const song = () =>
    makeSong([{ id: "a" }, { id: "b" }], [
      { sectionId: "a", repeats: 3 },
      { sectionId: "b", repeats: 1 },
    ]);

  it("takes one pass away and leaves the section", () => {
    const after = removePass(song(), "a", 1);
    expect(repeatsFor(after, "a")).toBe(2);
    expect(after.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("shifts the later passes' overrides down", () => {
    // Passes 0..2, the third one half time. Remove the middle one and it is the
    // SECOND pass that is now the half-time one.
    const withClock = setPassOverride(song(), "a", 2, { timeDomain: { rate: 0.5 } });
    const after = removePass(withClock, "a", 1);
    expect(repeatsFor(after, "a")).toBe(2);
    expect(passOverrideFor(after, "a", 1)).toEqual({ timeDomain: { rate: 0.5 } });
    expect(passOverrideFor(after, "a", 2)).toBeNull();
  });

  it("drops the override that belonged to the pass it removed", () => {
    const withClock = setPassOverride(song(), "a", 1, { timeDomain: { rate: 2 } });
    const after = removePass(withClock, "a", 1);
    expect(passOverrideFor(after, "a", 1)).toBeNull();
    expect(after.arrangement.find((e) => e.sectionId === "a")?.occurrenceOverrides).toBeUndefined();
  });

  it("deletes the section when the last pass goes", () => {
    const single = removePass(song(), "b", 0);
    expect(single.sections.map((s) => s.id)).toEqual(["a"]);
  });

  it("never drops a section below one pass by accident", () => {
    // A pass index past the end still leaves the section playing.
    const after = removePass(song(), "a", 9);
    expect(repeatsFor(after, "a")).toBe(2);
  });

  it("leaves other sections' entries alone", () => {
    const after = removePass(song(), "a", 0);
    expect(after.arrangement.find((e) => e.sectionId === "b")).toEqual(
      song().arrangement.find((e) => e.sectionId === "b"),
    );
  });
});

describe("per-pass fields beyond the clock (§P4.3)", () => {
  const song = () =>
    makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 3 }]);

  it("gives one pass a dynamic and a kit", () => {
    const loud = setPassOverride(song(), "a", 2, {
      velocity: "ff",
      drumPattern: "half_time",
      drumVariantIndex: 1,
    });
    expect(passOverrideFor(loud, "a", 2)).toEqual({
      velocity: "ff",
      drumPattern: "half_time",
      drumVariantIndex: 1,
    });
    // The section itself is untouched: this is a pass, not a copy.
    expect(loud.sections[0].velocity).toBe("mf");
    expect(loud.sections[0].drumPattern).toBeUndefined();
  });

  it("reads back through sectionSpans, so the export sees it", () => {
    const loud = setPassOverride(song(), "a", 1, { velocity: "pp" });
    const spans = sectionSpans(loud);
    expect(spans.map((span) => span.section.velocity)).toEqual(["mf", "pp", "mf"]);
  });

  it("clears one field without disturbing the others on that pass", () => {
    const both = setPassOverride(song(), "a", 0, { velocity: "ff", drumPattern: "standard" });
    const cleared = setPassOverride(both, "a", 0, { velocity: undefined });
    expect(passOverrideFor(cleared, "a", 0)).toEqual({ drumPattern: "standard" });
  });
});

describe("repeatPassLike (§P4.4)", () => {
  const song = () =>
    makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 2 }]);

  it("adds a pass and gives it this pass's overrides", () => {
    const loud = setPassOverride(song(), "a", 1, { velocity: "ff", timeDomain: { rate: 2 } });
    const more = repeatPassLike(loud, "a", 1);
    expect(repeatsFor(more, "a")).toBe(3);
    expect(passOverrideFor(more, "a", 2)).toEqual({ velocity: "ff", timeDomain: { rate: 2 } });
    // The pass it copied still has its own.
    expect(passOverrideFor(more, "a", 1)).toEqual({ velocity: "ff", timeDomain: { rate: 2 } });
  });

  it("copies the VALUES, not the object", () => {
    const loud = setPassOverride(song(), "a", 0, { velocity: "ff" });
    const more = repeatPassLike(loud, "a", 0);
    const first = passOverrideFor(more, "a", 0)!;
    const copied = passOverrideFor(more, "a", 2)!;
    expect(copied).not.toBe(first);
    expect(copied).toEqual(first);
  });

  it("just adds a pass when this one has nothing to copy", () => {
    const more = repeatPassLike(song(), "a", 0);
    expect(repeatsFor(more, "a")).toBe(3);
    expect(passOverrideFor(more, "a", 2)).toBeNull();
  });

  it("works from a section that plays once — it plays twice after", () => {
    const single = makeSong([{ id: "a" }], [{ sectionId: "a", repeats: 1 }]);
    const more = repeatPassLike(single, "a", 0);
    expect(repeatsFor(more, "a")).toBe(2);
  });
});
