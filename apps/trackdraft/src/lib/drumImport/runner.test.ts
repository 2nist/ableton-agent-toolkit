import { describe, expect, it } from "vitest";
import { addSection } from "../sections";
import { createEmptySong, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";
import { parseAnalysisFile } from "./analysisFile";
import { applySectionPatch, findAnalysisEntries, mergeAnalysisIntoSong, planSectionImport, planSongImport } from "./runner";

// ---- fixture: a hand-made 7-bar grid in Drive-My-Car's shape --------------
// intro (2 identical kick bars) · verse (3 groove bars + 1 late fill bar) ·
// one trailing groove bar for an analysis span that matches no section.

const V = 100;
const HV = 70;
const hits = (v: number, ...idx: number[]): number[] => {
  const a = Array.from({ length: 16 }, () => 0);
  for (const i of idx) a[i] = v;
  return a;
};
const bar = (lanes: Record<string, number[]>): { lanes: Record<string, number[]> } => ({ lanes });

const INTRO_BAR = bar({ kick: hits(V, 0, 8) });
const GROOVE = bar({ kick: hits(V, 0, 8), snare: hits(V, 4, 12), hat: hits(HV, 0, 2, 4, 6, 8, 10, 12, 14) });
const FILL = bar({
  kick: hits(V, 0, 8),
  snare: hits(V, 4, 12, 14, 15),
  hat: hits(HV, 0, 2, 4, 6, 8, 10, 12, 13, 14, 15),
});

const FILE = parseAnalysisFile({
  format: "trackdraft-drum-analysis",
  songId: "test-song",
  stepsPerBar: 16,
  bars: [INTRO_BAR, INTRO_BAR, GROOVE, GROOVE, GROOVE, FILL, GROOVE],
  sections: [
    { sectionId: "sec-0", startBar: 0, bars: 2 },
    { sectionId: "sec-0", startBar: 0, bars: 2 },
    { sectionName: "Verse", startBar: 2, bars: 4 },
    { sectionId: "ghost", startBar: 6, bars: 1 },
  ],
});

function makeSong(): BlueprintSong {
  let song = createEmptySong("Import Test");
  song = addSection(song, "intro");
  song = addSection(song, "verse");
  song = addSection(song, "chorus");
  const names = ["intro", "verse", "chorus"];
  return {
    ...song,
    id: "test-song",
    sections: song.sections.map((s, i) => ({ ...s, id: `sec-${i}`, name: names[i], bars: i === 0 ? 2 : 4 })),
  };
}

describe("importer runner — analysis file → section patches", () => {
  const song = makeSong();

  it("matches by id first; an occurrence split takes the first span", () => {
    const intro = planSectionImport(FILE, song.sections[0]);
    expect(intro).not.toBeNull();
    expect(intro!.matches).toBe(2); // two spans carry sec-0
    expect(intro!.entryIndex).toBe(0);
    expect(intro!.patch.drumPattern).toBe("none");
    expect(intro!.patch.velocity).toBe("mf"); // kick hits at ~100
    expect(intro!.patch.drumBlocks.length).toBeGreaterThan(0);
    expect(intro!.report.bars.map((b) => b.kind)).toEqual(["groove", "groove"]);
    expect(intro!.report.stats.clearBlocks).toBeGreaterThan(0); // unimported lanes cleared
  });

  it("falls back to a case-insensitive section-name match", () => {
    const verse = song.sections[1];
    expect(findAnalysisEntries(FILE, verse)).toEqual([2]);
    const r = planSectionImport(FILE, verse)!;
    expect(r.matches).toBe(1);
    expect(r.patch.velocity).toBe("mp"); // mean source velocity ≈ 80
  });

  it("detects the deviating bar as a fill starting on its last beat; ids are deterministic", () => {
    const r = planSectionImport(FILE, song.sections[1])!;
    expect(r.report.bars.filter((b) => b.kind === "groove")).toHaveLength(3);
    const fill = r.report.bars.find((b) => b.kind === "fill");
    expect(fill?.fillStartBeat).toBe(3);
    expect(r.report.stats.euclidBlocks).toBeGreaterThan(0);
    const again = planSectionImport(FILE, song.sections[1])!;
    expect(JSON.stringify(again.patch.drumBlocks)).toBe(JSON.stringify(r.patch.drumBlocks));
  });

  it("returns null when the file has no span for the section", () => {
    expect(planSectionImport(FILE, song.sections[2])).toBeNull(); // chorus never appears
  });

  it("applySectionPatch replaces the drum authoring and clears competing layers", () => {
    const authored: BlueprintSection = {
      ...song.sections[2],
      drumPattern: "standard",
      drumVariantIndex: 2,
      drumMeterOutline: { label: "test outline", cellBeats: 0.5, cells: [2, 2, 2] },
      drumVoicePatterns: { kick: { k: 3, n: 8, rotation: 0 } },
      drumVariationOutline: { label: "test detour", cellBeats: 0.5, cells: [3, 3, 2] },
      drumVariationBars: 1,
      drumVariationStartBeat: 4,
      drumTransitionModel: "buildUp",
      drumTransitionBars: 2,
    };
    const patch = planSectionImport(FILE, song.sections[1])!.patch;
    const merged = applySectionPatch(authored, patch);
    expect(merged.drumPattern).toBe("none");
    expect(merged.drumBlocks).toEqual(patch.drumBlocks);
    expect(merged.velocity).toBe(patch.velocity);
    const cleared = [
      "drumVariantIndex", "drumMeterOutline", "drumVoicePatterns",
      "drumVariationOutline", "drumVariationBars", "drumVariationStartBeat",
      "drumTransitionModel", "drumTransitionBars",
    ];
    for (const k of cleared) expect((merged as unknown as Record<string, unknown>)[k]).toBeUndefined();
    // non-drum fields stay untouched
    expect(merged.name).toBe(authored.name);
    expect(merged.chords).toEqual(authored.chords);
    expect(merged.bars).toBe(authored.bars);
  });

  it("merges the whole song, warns about unmatched spans, leaves other sections alone", () => {
    const { song: merged, results, warnings } = mergeAnalysisIntoSong(song, FILE);
    expect(results.map((r) => r.sectionId)).toEqual(["sec-0", "sec-1"]);
    expect(merged.sections[0].drumBlocks?.length).toBeGreaterThan(0);
    expect(merged.sections[1].drumBlocks?.length).toBeGreaterThan(0);
    expect(merged.sections[2]).toEqual(song.sections[2]); // chorus untouched
    expect(warnings.some((w) => w.includes('"ghost"'))).toBe(true);
    expect(warnings.some((w) => w.includes("2 analysis spans"))).toBe(true);
    expect(warnings.some((w) => w.includes("is for song"))).toBe(false);
  });

  it("warns when the file names a different song", () => {
    const { warnings } = planSongImport({ ...FILE, songId: "other-song" }, song);
    expect(warnings.some((w) => w.includes('"other-song"'))).toBe(true);
  });
});
