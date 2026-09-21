import { describe, expect, it } from "vitest";
import { parseRockCorpusTdc } from "./rockCorpusTdc.js";

function rockSong(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { title: "Test Song", artist: "Tester", key: "C", tempo: 30 },
    chords: [],
    beats: [],
    sections: [],
    ...overrides,
  };
}

describe("parseRockCorpusTdc", () => {
  it("parses metadata: key, bars-per-minute tempo ×4, title/artist", () => {
    const raw = parseRockCorpusTdc(rockSong());
    expect(raw.title).toBe("Test Song");
    expect(raw.artist).toBe("Tester");
    expect(raw.key).toBe("C");
    expect(raw.bpm).toBe(120);
    expect(raw.sourceFormat).toBe("rock-corpus-tdc");
  });

  it("translates plain numerals with case-driven quality", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 4, chord: "I" },
          { time: 4, duration: 4, chord: "IV" },
          { time: 8, duration: 4, chord: "V7" },
          { time: 12, duration: 4, chord: "vi" },
          { time: 16, duration: 4, chord: "bVII" },
        ],
        sections: [{ time: 0, duration: 20, label: "Vr" }],
      }),
    );
    const q = raw.sections[0].chords.map((c) => `${c.root}:${c.quality}`);
    expect(q).toEqual(["C:maj", "F:maj", "G:7", "A:min", "Bb:maj"]);
  });

  it("handles figure notation: inversions, seventh figures, sus/h/dim/aug symbols", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 4, chord: "IV64" },
          { time: 4, duration: 4, chord: "vi42" },
          { time: 8, duration: 4, chord: "Id7" },
          { time: 12, duration: 4, chord: "Vs4" },
          { time: 16, duration: 4, chord: "Ih7" },
          { time: 20, duration: 4, chord: "Io" },
          { time: 24, duration: 4, chord: "V+11" },
          { time: 28, duration: 4, chord: "vi6" },
        ],
        sections: [{ time: 0, duration: 32, label: "Vr" }],
      }),
    );
    const q = raw.sections[0].chords.map((c) => `${c.root}:${c.quality}`);
    expect(q).toEqual([
      "F:maj", // IV64 → F major triad (bass figure dropped)
      "A:min7", // vi42 → A seventh-family chord in inversion
      "C:7", // Id7 → C dominant seventh
      "G:sus4",
      "C:m7b5", // Ih7 → half-diminished (h notation)
      "C:dim", // Io → diminished
      "G:aug", // +11 → augmented simplification
      "A:min", // vi6 → A minor triad
    ]);
    expect(raw.warnings.some((w) => w.includes("Figure notation simplified"))).toBe(true);
  });

  it("resolves applied chords to the dominant of the target degree", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 4, chord: "V/V" },
          { time: 4, duration: 4, chord: "V42/IV" },
        ],
        sections: [{ time: 0, duration: 8, label: "Vr" }],
      }),
    );
    const q = raw.sections[0].chords.map((c) => `${c.root}:${c.quality}`);
    expect(q).toEqual(["D:maj", "C:7"]); // V/V → D; V42/IV → C7 (dominant of F)
    expect(raw.warnings.some((w) => w.includes("applied chords"))).toBe(true);
  });

  it("continues chords through '.' cells and repeats through '*n'", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 1, chord: "I" },
          { time: 1, duration: 1, chord: "." },
          { time: 2, duration: 1, chord: "*2" },
          { time: 5, duration: 1, chord: "R" },
          { time: 6, duration: 1, chord: "IV" },
        ],
        sections: [{ time: 0, duration: 7, label: "Vr" }],
      }),
    );
    const shown = raw.sections[0].chords.map((c) => `${c.root}:${c.quality}@${c.startSec}-${c.endSec}`);
    // I at 0 extends through the "." cell (to 2) then repeats ×2 more cells (to 4);
    // the rest cell is skipped; IV follows untouched.
    expect(shown).toEqual(["C:maj@0-4", "F:maj@6-7"]);
  });

  it("follows inline key changes for subsequent numerals", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 4, chord: "I" },
          { time: 4, duration: 4, chord: "[E]" },
          { time: 8, duration: 4, chord: "I" },
          { time: 12, duration: 4, chord: "IV" },
        ],
        sections: [{ time: 0, duration: 16, label: "Vr" }],
      }),
    );
    const q = raw.sections[0].chords.map((c) => `${c.root}:${c.quality}`);
    expect(q).toEqual(["C:maj", "E:maj", "A:maj"]);
    expect(raw.warnings.some((w) => w.includes("key change"))).toBe(true);
  });

  it("expands section abbreviations and merges junk sections into the previous span", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [],
        sections: [
          { time: 0, duration: 4, label: "In" },
          { time: 4, duration: 2, label: "|" },
          { time: 6, duration: 20, label: "Vr*3" },
          { time: 26, duration: 2, label: "[12/8]" },
          { time: 28, duration: 10, label: "Zz" },
        ],
      }),
    );
    expect(raw.sections.map((s) => s.name)).toEqual(["Intro", "Verse", "Unlabeled"]);
    // the barline and meter-tag spans extend the previous real section
    expect(raw.sections[0].endSec).toBe(6);
    expect(raw.sections[1].endSec).toBe(28);
  });

  it("infers aeolian mode for minor-tonic songs", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        metadata: { title: "Test Song", artist: "Tester", key: "A", tempo: 30 },
        chords: [
          { time: 0, duration: 4, chord: "i" },
          { time: 4, duration: 4, chord: "iv" },
          { time: 8, duration: 4, chord: "V7" },
          { time: 12, duration: 4, chord: "i" },
        ],
        sections: [{ time: 0, duration: 16, label: "Vr" }],
      }),
    );
    expect(raw.key).toBe("A");
    expect(raw.mode).toBe("aeolian");
  });

  it("skips unknown tokens with an honest warning", () => {
    const raw = parseRockCorpusTdc(
      rockSong({
        chords: [
          { time: 0, duration: 4, chord: "I" },
          { time: 4, duration: 4, chord: "zzOzZ" },
        ],
        sections: [{ time: 0, duration: 8, label: "Vr" }],
      }),
    );
    expect(raw.sections[0].chords).toHaveLength(1);
    expect(raw.warnings.some((w) => w.includes("zzOzZ"))).toBe(true);
  });
});
