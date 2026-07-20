import { describe, it, expect } from "vitest";
import { repairSuspiciousIntros, repairChorusBlob, repairSong } from "./repair-catalog";
import { auditSong } from "./audit-catalog";
import type { BlueprintSong, BlueprintSection } from "../src/types/blueprint";

function makeSong(sections: Partial<BlueprintSection>[]): BlueprintSong {
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
      chords: s.chords ?? [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      ...s,
    })),
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("repairSuspiciousIntros", () => {
  it("relabels a suspicious intro to verse, moving no text", () => {
    const song = makeSong([{ id: "s0", role: "intro", name: "intro", lyrics: Array(8).fill("line").join("\n") }]);
    const flags = auditSong(song);
    const { song: repaired, relabeled } = repairSuspiciousIntros(song, flags);
    expect(repaired.sections[0].role).toBe("verse");
    expect(repaired.sections[0].lyrics).toBe(song.sections[0].lyrics);
    expect(relabeled).toEqual([{ sectionName: "intro", lineCount: 8 }]);
  });

  it("leaves a real (short) intro untouched", () => {
    const song = makeSong([{ id: "s0", role: "intro", name: "intro", lyrics: "one\ntwo" }]);
    const { song: repaired, relabeled } = repairSuspiciousIntros(song, auditSong(song));
    expect(repaired).toBe(song);
    expect(relabeled).toEqual([]);
  });
});

describe("repairChorusBlob — gated on the song not already classifying confidently", () => {
  it("skips consolidation when the pre-repair role skeleton already classifies confidently", () => {
    // A real regression this gate exists to prevent: role names alone
    // (verse/bridge/verse/bridge/verse) already form a clean, classifiable
    // skeleton even though the lyrics are dumped in one blob — splitting a
    // repeated phrase out of that blob only hurts, it fixes nothing.
    const blobLyrics = [
      "hook line one",
      "hook line two",
      "verse content a",
      "hook line one",
      "hook line two",
      "verse content b",
    ].join("\n");
    const song = makeSong([
      { id: "blob", role: "custom", name: "silence", lyrics: blobLyrics },
      { id: "s1", role: "verse", name: "verse" },
      { id: "s2", role: "bridge", name: "bridge" },
      { id: "s3", role: "verse", name: "verse" },
      { id: "s4", role: "bridge", name: "bridge" },
      { id: "s5", role: "verse", name: "verse" },
    ]);
    const { song: repaired, applied } = repairChorusBlob(song, auditSong(song));
    expect(applied).toBe(0);
    expect(repaired).toBe(song);
  });

  it("applies consolidation when the song doesn't already classify confidently", () => {
    // All roles custom -> no skeleton at all -> formId is null -> eligible.
    const blobLyrics = ["hook one", "hook two", "verse content a", "hook one", "hook two", "verse content b"].join(
      "\n",
    );
    const song = makeSong([
      { id: "blob", role: "custom", name: "silence", lyrics: blobLyrics },
      { id: "s1", role: "custom", name: "part_x" },
      { id: "s2", role: "custom", name: "part_y" },
    ]);
    const { applied } = repairChorusBlob(song, auditSong(song));
    expect(applied).toBeGreaterThan(0);
  });
});

describe("repairSong", () => {
  it("never changes total lyric text, even when both repairs apply", () => {
    const song = makeSong([
      { id: "blob", role: "custom", name: "silence", lyrics: ["a", "b", "a", "b", "c"].join("\n") },
      { id: "s1", role: "custom", name: "part_x" },
    ]);
    const result = repairSong(song);
    const before = song.sections
      .flatMap((s) => (s.lyrics ?? "").split("\n"))
      .filter((l) => l.length > 0)
      .sort();
    const after = result.song.sections
      .flatMap((s) => (s.lyrics ?? "").split("\n"))
      .filter((l) => l.length > 0)
      .sort();
    expect(after).toEqual(before);
  });

  it("reports changed:false and returns an untouched song when nothing is flagged", () => {
    const song = makeSong([{ id: "s0", role: "verse", name: "verse", lyrics: "clean lyrics here" }]);
    const result = repairSong(song);
    expect(result.changed).toBe(false);
    expect(result.song).toEqual(song);
  });
});
