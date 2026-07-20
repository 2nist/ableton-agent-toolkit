import { describe, it, expect } from "vitest";
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

describe("auditSong", () => {
  it("flags a single-blob song: one lyric-bearing section among several", () => {
    const song = makeSong([
      { id: "s0", role: "custom", name: "silence", lyrics: "a\nb\nc" },
      { id: "s1", role: "verse", name: "verse" },
      { id: "s2", role: "chorus", name: "chorus" },
    ]);
    const flags = auditSong(song);
    expect(flags).toContainEqual({ kind: "single-blob", sectionId: "s0", sectionName: "silence", lineCount: 3 });
  });

  it("does not flag single-blob when 2+ sections carry lyrics", () => {
    const song = makeSong([
      { id: "s0", role: "verse", name: "verse", lyrics: "a\nb" },
      { id: "s1", role: "chorus", name: "chorus", lyrics: "c\nd" },
    ]);
    expect(auditSong(song).some((f) => f.kind === "single-blob")).toBe(false);
  });

  it("flags missing-lyrics when no section has any", () => {
    const song = makeSong([{ id: "s0", role: "verse", name: "verse" }, { id: "s1", role: "chorus", name: "chorus" }]);
    expect(auditSong(song)).toContainEqual({ kind: "missing-lyrics" });
  });

  it("flags custom-role only when the section has real content, not for content-free filler", () => {
    const withContent = makeSong([{ id: "s0", role: "custom", name: "part_x", lyrics: "real lyrics" }]);
    expect(auditSong(withContent)).toContainEqual({ kind: "custom-role", sectionId: "s0", sectionName: "part_x" });

    const silenceOnly = makeSong([{ id: "s0", role: "custom", name: "silence" }]);
    expect(auditSong(silenceOnly).some((f) => f.kind === "custom-role")).toBe(false);
  });

  it("flags a suspicious intro (sung lyrics where the label says otherwise) above the line threshold", () => {
    const song = makeSong([{ id: "s0", role: "intro", name: "intro", lyrics: Array(7).fill("line").join("\n") }]);
    expect(auditSong(song)).toContainEqual({ kind: "suspicious-intro", sectionId: "s0", sectionName: "intro", lineCount: 7 });
  });

  it("does not flag a real short intro", () => {
    const song = makeSong([{ id: "s0", role: "intro", name: "intro", lyrics: "one\ntwo" }]);
    expect(auditSong(song).some((f) => f.kind === "suspicious-intro")).toBe(false);
  });

  it("flags non-monotonic timeline entries as bad-timing", () => {
    const song = makeSong([
      {
        id: "s0",
        lyricsTimeline: [
          { text: "a", startBeat: 4 },
          { text: "b", startBeat: 2 }, // goes backwards
        ],
      },
    ]);
    expect(auditSong(song).some((f) => f.kind === "bad-timing")).toBe(true);
  });

  it("flags a timed span that wildly mismatches the declared bar length", () => {
    const song = makeSong([
      {
        id: "s0",
        bars: 8,
        timeSignatureNumerator: 4, // declares 32 beats
        lyricsTimeline: [
          { text: "a", startBeat: 0 },
          { text: "b", startBeat: 2 }, // 2-beat span vs 32 declared
        ],
      },
    ]);
    expect(auditSong(song).some((f) => f.kind === "bad-timing")).toBe(true);
  });

  it("does not flag a reasonable timed span", () => {
    const song = makeSong([
      {
        id: "s0",
        bars: 2,
        timeSignatureNumerator: 4, // declares 8 beats
        lyricsTimeline: [
          { text: "a", startBeat: 0 },
          { text: "b", startBeat: 4 },
          { text: "c", startBeat: 7 }, // 7-beat span vs 8 declared -- fine
        ],
      },
    ]);
    expect(auditSong(song).some((f) => f.kind === "bad-timing")).toBe(false);
  });

  it("returns no flags for a clean, well-formed song", () => {
    const song = makeSong([
      { id: "s0", role: "verse", name: "verse", lyrics: "line one\nline two" },
      { id: "s1", role: "chorus", name: "chorus", lyrics: "hook one\nhook two" },
    ]);
    expect(auditSong(song)).toEqual([]);
  });
});
