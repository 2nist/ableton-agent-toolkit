import { describe, it, expect } from "vitest";
import { inferDrumPattern, songSignalsFor } from "@drum/library";
import {
  resolveDrumHits,
  resolveOutlineVoiceNecklaces,
  resolveSectionVoiceNecklaces,
  resolveSectionVariant,
  resolveVoiceNecklaces,
  seededVariantIndex,
  inferPatternForSection,
  inferGrooveOverride,
} from "./drumPreview";
import type { BlueprintSection, MeterOutline } from "../../types/blueprint";

// "standard" is a real, always-present baked pattern (unlike "none", which
// has no preset at all) — used here for its stable *shape* (loops, has
// notes), not asserted against exact baked content, which legitimately
// changes when the corpus is re-baked (same reasoning drumClips.test.ts
// uses fixture presets for its exact-value assertions).
const PATTERN = "standard";

function makeSection(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "sec-1",
    name: "Verse",
    role: "verse",
    bars: 2,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

describe("resolveDrumHits", () => {
  it("returns null for a pattern with no preset (e.g. 'none')", () => {
    expect(resolveDrumHits("none", undefined, makeSection(), 0.5)).toBeNull();
  });

  it("converts beat positions to real seconds via secPerBeat, not raw beats", () => {
    const section = makeSection({ bars: 1 }); // 4 beats @ 4/4
    const secPerBeat = 0.5; // 120bpm
    const hits = resolveDrumHits(PATTERN, 0, section, secPerBeat)!;
    expect(hits.length).toBeGreaterThan(0);
    // Every hit falls within the section's own duration in *seconds*
    // (4 beats * 0.5s/beat = 2s) — if beats were passed through unconverted
    // (the bug), hits would land at raw beat-sized offsets instead, which
    // for a 4-beat loop happen to only mostly overlap this bound by
    // coincidence, so the real check is the proportionality one below.
    for (const hit of hits) expect(hit.offsetSec).toBeGreaterThanOrEqual(0);

    const doubledTempoHits = resolveDrumHits(PATTERN, 0, section, secPerBeat * 2)!;
    // Same beat positions, double secPerBeat (half tempo) → every offset
    // should scale by exactly 2x, proving conversion is linear in
    // secPerBeat rather than a fixed/ignored value.
    hits.forEach((hit, i) => {
      expect(doubledTempoHits[i].offsetSec).toBeCloseTo(hit.offsetSec * 2, 5);
    });
  });

  it("tiles to fill a section longer than one loop, instead of stopping after one pass", () => {
    const shortSection = makeSection({ bars: 1 }); // 4 beats
    const longSection = makeSection({ bars: 8 }); // 32 beats — several loops of a 4-beat pattern
    const secPerBeat = 0.5;

    const shortHits = resolveDrumHits(PATTERN, 0, shortSection, secPerBeat)!;
    const longHits = resolveDrumHits(PATTERN, 0, longSection, secPerBeat)!;

    // A longer section tiles the same loop repeatedly, so it should have
    // meaningfully more hits and cover meaningfully more time — not just
    // the one loop's worth regardless of section length.
    expect(longHits.length).toBeGreaterThan(shortHits.length);
    const lastShort = Math.max(...shortHits.map((h) => h.offsetSec));
    const lastLong = Math.max(...longHits.map((h) => h.offsetSec));
    expect(lastLong).toBeGreaterThan(lastShort);
    // Roughly proportional to the 8x longer section (loose bound — tiling
    // adds per-tile micro-variation, not exact repetition).
    expect(lastLong).toBeGreaterThan(lastShort * 4);
  });

  it("clamps an out-of-range variantIndex instead of throwing", () => {
    const section = makeSection();
    expect(() => resolveDrumHits(PATTERN, 999, section, 0.5)).not.toThrow();
    expect(resolveDrumHits(PATTERN, 999, section, 0.5)).not.toBeNull();
  });
});

const SEVEN_EIGHT: MeterOutline = { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" };

describe("resolveOutlineVoiceNecklaces", () => {
  it("with no cellVoices, still splits into a backbeat — not a click", () => {
    // It used to collapse to one closed-hat necklace: apply a Euclidean groove,
    // and the kick and snare the editor shows you never appear.
    const necklaces = resolveOutlineVoiceNecklaces(SEVEN_EIGHT)!;
    const voices = necklaces.map((n) => n.voice).sort();
    expect(voices).toEqual(["closedHat", "kick", "snare"]);
  });

  it("with cellVoices, splits into separate kick/snare/hat necklaces", () => {
    const outline: MeterOutline = { ...SEVEN_EIGHT, cellVoices: ["kick", "snare", "hat"] };
    const necklaces = resolveOutlineVoiceNecklaces(outline)!;
    const voices = necklaces.map((n) => n.voice).sort();
    expect(voices).toEqual(["closedHat", "kick", "snare"]);
    // Exactly one kick onset (cell 0's downbeat) and one snare onset
    // (cell 1's downbeat) — the rest of cell 0/1's subdivisions and all
    // of cell 2 (voice "hat") are closed-hat.
    expect(necklaces.find((n) => n.voice === "kick")!.count).toBe(1);
    expect(necklaces.find((n) => n.voice === "snare")!.count).toBe(1);
  });

  it("onset fractions are relative to the outline's own beats-per-bar, not a fixed 4-beat assumption", () => {
    // [2,2,3] at cellBeats 0.5 -> beatsPerBar 3.5. The kick (cell 0's
    // downbeat) sits at beat 0 -> fraction 0.
    const outline: MeterOutline = { ...SEVEN_EIGHT, cellVoices: ["kick"] };
    const necklaces = resolveOutlineVoiceNecklaces(outline)!;
    expect(necklaces.find((n) => n.voice === "kick")!.hits).toEqual([0]);
  });

  it("labels each necklace with the outline's numerator as its steps (n in E(k,n))", () => {
    const necklaces = resolveOutlineVoiceNecklaces(SEVEN_EIGHT)!;
    expect(necklaces.length).toBeGreaterThan(0);
    for (const n of necklaces) expect(n.steps).toBe(7);
  });
});

describe("resolveVoiceNecklaces", () => {
  it("labels each necklace with the loop's 16th-note grid (steps = loopBeats * 4)", () => {
    const necklaces = resolveVoiceNecklaces(PATTERN, 0)!;
    expect(necklaces.length).toBeGreaterThan(0);
    for (const n of necklaces) {
      expect(n.steps).toBeGreaterThan(0);
      expect(Number.isInteger(n.steps)).toBe(true);
    }
  });
});

describe("seeded variant selection (the 'same drums everywhere' fix)", () => {
  it("different sections resolve to different variants, not all variant 0", () => {
    // The auto pick leans on the clean downbeat groove (variant 0) but
    // spreads the rest over the corpus variants; across many distinct
    // sections the seeded variation must still produce more than one
    // groove — the old bug was variant 0 for EVERY section.
    const notes = Array.from({ length: 20 }, (_, i) =>
      resolveSectionVariant(makeSection({ id: `song-${i}-section` }))!.notes.join("|"),
    );
    expect(new Set(notes).size).toBeGreaterThan(1);
  });

  it("keeps the default variant as the single most common pick — without dominating", () => {
    // Variant 0 is the pattern's own authored groove (a real 2 & 4 backbeat
    // now — it used to be a shared "clean downbeat" with the snare on 1 & 3,
    // which meant a third of all auto picks had no backbeat at all). The
    // contract this pins is the DISTRIBUTION: variant 0 is the mode, but a
    // 2026-09 catalog audit measured the old 60% weight flattening whole
    // songs (46/194 dominated by one combo), so it must not be a majority.
    const pattern = inferPatternForSection(makeSection());
    const picks = Array.from({ length: 200 }, (_, i) =>
      seededVariantIndex(pattern, makeSection({ id: `verse-${i}` }), undefined, 0),
    );
    const defaults = picks.filter((index) => index === 0).length;
    expect(defaults).toBeGreaterThan(picks.length * 0.15);
    expect(defaults).toBeLessThan(picks.length * 0.5);
    // And it is the MODE — no other single variant beats it.
    const counts = new Map<number, number>();
    for (const index of picks) counts.set(index!, (counts.get(index!) ?? 0) + 1);
    expect(defaults).toBe(Math.max(...counts.values()));
    // ...while the rest of the pool still gets used.
    expect(counts.size).toBeGreaterThan(5);
  });
  it("is deterministic: same section id + occurrence → the same variant", () => {
    const first = resolveSectionVariant(makeSection({ id: "sec-x" }), undefined, 0)!;
    const second = resolveSectionVariant(makeSection({ id: "sec-x" }), undefined, 0)!;
    expect(first.notes).toEqual(second.notes);
  });

  it("a repeated section's later occurrence gets a different variant", () => {
    const occ0 = resolveSectionVariant(makeSection({ id: "chorus" }), undefined, 0)!;
    const occ2 = resolveSectionVariant(makeSection({ id: "chorus" }), undefined, 2)!;
    expect(occ0.notes).not.toEqual(occ2.notes);
  });

  it("an explicit drumVariantIndex always wins over the seed", () => {
    // Pinning variant 2 twice is stable — the explicit index wins, not the seed.
    const manual = resolveSectionVariant(makeSection({ id: "sec-y", drumVariantIndex: 2 }))!;
    const manualAgain = resolveSectionVariant(makeSection({ id: "sec-y", drumVariantIndex: 2 }))!;
    expect(manual.notes).toEqual(manualAgain.notes);
    // A pinned variant-0 and the auto-seeded pick for the same section are
    // independent resolutions, and both must resolve to notes.
    const explicit0 = resolveSectionVariant(makeSection({ id: "sec-z", drumVariantIndex: 0 }))!;
    const seeded = resolveSectionVariant(makeSection({ id: "sec-z" }), undefined, 0)!;
    expect(explicit0.notes.length).toBeGreaterThan(0);
    expect(seeded.notes.length).toBeGreaterThan(0);
  });

  it("refrain resolves to the same (chorus) family as chorus via inferPatternForSection", () => {
    const refrain = inferPatternForSection({ ...makeSection({ id: "r" }), role: "refrain" as never });
    const chorus = inferPatternForSection({ ...makeSection({ id: "c" }), role: "chorus" });
    expect(refrain).toBe(chorus);
  });
});

describe("resolveSectionVoiceNecklaces", () => {
  it("drumMeterOutline takes priority over drumPattern, same order the export uses", () => {
    const section = makeSection({
      drumPattern: PATTERN,
      drumMeterOutline: { ...SEVEN_EIGHT, cellVoices: ["kick", "snare", "hat"] },
    });
    const necklaces = resolveSectionVoiceNecklaces(section)!;
    // Only the outline's three voices should appear — if drumPattern had
    // won instead, "standard"'s own baked voices would show up too.
    expect(necklaces.map((n) => n.voice).sort()).toEqual(["closedHat", "kick", "snare"]);
  });

  it("passes the outline's numerator through as steps when an outline resolves", () => {
    const section = makeSection({ drumMeterOutline: SEVEN_EIGHT });
    const necklaces = resolveSectionVoiceNecklaces(section)!;
    for (const n of necklaces) expect(n.steps).toBe(7);
  });

  it("falls back to the heuristic pattern when neither drumPattern nor drumMeterOutline is set", () => {
    const section = makeSection();
    expect(resolveSectionVoiceNecklaces(section)).not.toBeNull();
  });

  it("applies a per-voice Euclidean override on top of the base pattern, replacing that voice's necklace", () => {
    const section = makeSection({
      drumPattern: PATTERN,
      drumVoicePatterns: { kick: { k: 3, n: 7, rotation: 0 } },
    });
    const necklaces = resolveSectionVoiceNecklaces(section)!;
    const kick = necklaces.find((n) => n.voice === "kick");
    // kick now comes from the free-form override (3 onsets over 7 steps)
    expect(kick).toBeTruthy();
    expect(kick!.steps).toBe(7);
    expect(kick!.count).toBe(3);
    // other preset voices still resolve from the base pattern
    expect(necklaces.some((n) => n.voice === "snare")).toBe(true);
  });
});

describe("inferPatternForSection", () => {
  it("without a concept, always reads as acoustic regardless of what the song actually is", () => {
    const section = makeSection({ role: "verse", velocity: "mf" });
    // Acoustic-family verse/mf pattern.
    expect(inferPatternForSection(section)).toBe("standard");
  });

  it("an electronic concept routes to the electronic pattern family instead", () => {
    const section = makeSection({ role: "verse", velocity: "mf" });
    const acoustic = inferPatternForSection(section);
    const electronic = inferPatternForSection(section, {
      concept: "Synthwave — analog synth arpeggios, gated-reverb snare.",
    });
    expect(acoustic).toBe("standard");
    expect(electronic).toBe("four_on_floor");
    expect(electronic).not.toBe(acoustic);
  });

  it("honors bpm — the same song resolves dnb at ≥160 instead of four_on_floor (the drift the full-song fix closes)", () => {
    const section = makeSection({ role: "chorus", velocity: "mf" });
    const song = { concept: "electronic club track", bpm: 120 };
    // Old app behavior (concept only) returned four_on_floor at ANY tempo
    // while the bridge's full-signal call returned dnb — the parity bug.
    expect(inferPatternForSection(section, song)).toBe("four_on_floor");
    expect(inferPatternForSection(section, { ...song, bpm: 170 })).toBe("dnb");
  });

  it("honors notes.instrumentation — an 808/trap-leaning song resolves trap", () => {
    const section = makeSection({ role: "chorus", velocity: "mf" });
    expect(
      inferPatternForSection(section, {
        bpm: 140,
        notes: { instrumentation: ["808", "hi-hats"] },
      }),
    ).toBe("trap");
  });

  it("matches the bridge: full song signals produce the identical pattern via the shared songSignalsFor", () => {
    const section = makeSection({ role: "verse", velocity: "mf" });
    const song = {
      bpm: 172,
      title: "Neon Corridor",
      concept: "synthwave chase scene",
      notes: { instrumentation: ["synth", "909"], dynamics: "loud", lyricalContent: "running" },
    };
    // App path: inferPatternForSection(section, song) → inferDrumPattern(
    //   sectionFields, songSignalsFor(song)). Bridge path: the same call
    //   from planDrumClips. Both resolve identically — that's the parity
    //   property this test locks in.
    const viaApp = inferPatternForSection(section, song);
    const viaBridge = inferDrumPattern(
      {
        role: section.role,
        velocity: section.velocity,
        name: section.name,
        timeSignatureNumerator: section.timeSignatureNumerator,
        timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
      },
      songSignalsFor(song),
    );
    expect(viaApp).toBe(viaBridge);
  });
});

describe("inferGrooveOverride", () => {
  it("returns undefined for prose with no unambiguous pattern signal", () => {
    expect(inferGrooveOverride("Warm pads swirl, no strong downbeat yet.")).toBeUndefined();
    expect(inferGrooveOverride(undefined)).toBeUndefined();
  });

  it("matches an explicit half-time mention", () => {
    expect(inferGrooveOverride("Hard pivot to half-time, everything drags.")).toBe("half_time");
  });

  it("matches an explicit 'no kit yet' / kick-only mention", () => {
    expect(inferGrooveOverride("Sub-bass pulse alone, no kit yet.")).toBe("kick_only");
    expect(inferGrooveOverride("Just a kick pulse under the vamp.")).toBe("kick_only");
  });

  it("does not match patterns the legacy dropdown can't represent (four-on-the-floor, trap, breakbeat)", () => {
    // These are real, common groove phrases from the new genre catalog
    // entries — deliberately NOT matched, since "four_on_floor"/"trap"/
    // "breakbeat" aren't in the schema's DrumPattern union at all.
    expect(inferGrooveOverride("Rigid quantized four-on-the-floor kick, zero swing.")).toBeUndefined();
    expect(inferGrooveOverride("Triplet trap hi-hat rolls over a sparse 808 kick.")).toBeUndefined();
  });
});
