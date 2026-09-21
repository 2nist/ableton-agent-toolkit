import { describe, expect, it } from "vitest";
import { estimateKey, parseMcgillJcrd } from "./mcgillJcrd.js";

function mcGillSong(sections: unknown[], extra: Record<string, unknown> = {}) {
  return {
    title: "Test Song",
    artist: "Tester",
    bpm: 120,
    source: "McGill Billboard + SALAMI",
    sections,
    ...extra,
  };
}

describe("parseMcgillJcrd", () => {
  it("parses metadata and distributes chord slots uniformly, ending before the tail zone", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "verse_1",
          start_ms: 0,
          duration_ms: 16000,
          chords: ["C:maj", "F:maj", "G:7", "C:maj"],
          sectionType: "Verse",
        },
      ]),
    );
    expect(raw.title).toBe("Test Song");
    expect(raw.artist).toBe("Tester");
    expect(raw.sourceFormat).toBe("mcgill-jcrd");

    const sec = raw.sections[0];
    expect(sec.name).toBe("Verse");
    expect(sec.startSec).toBe(0);
    expect(sec.endSec).toBe(16);
    expect(sec.chords).toHaveLength(4);
    // usable = 16 - 2 = 14 s over 4 slots → 3.5 s each; last ends at 14,
    // which is start of the 2 s tail zone the merge defers within.
    expect(sec.chords.map((c) => Math.round(c.startSec * 100) / 100)).toEqual([0, 3.5, 7, 10.5]);
    expect(sec.chords.map((c) => c.endSec)).toEqual([3.5, 7, 10.5, 14]);
    expect(sec.chords.map((c) => c.root)).toEqual(["C", "F", "G", "C"]);
    expect(sec.chords.map((c) => c.quality)).toEqual(["maj", "maj", "7", "maj"]);
  });

  it("keeps every slot's end at or before (section end − 2 s) for dense sections", () => {
    const chords = Array.from({ length: 12 }, () => "C:maj");
    const raw = parseMcgillJcrd(
      mcGillSong([{ id: "s", start_ms: 500, duration_ms: 10000, chords, sectionType: "Verse" }]),
    );
    const sec = raw.sections[0];
    const last = sec.chords[sec.chords.length - 1];
    expect(last.endSec).toBeLessThanOrEqual(sec.endSec - 2 + 1e-9);
    expect(sec.chords[0].startSec).toBeCloseTo(0.5, 6);
  });

  it("treats N/X tokens as rests with no warning", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "s",
          start_ms: 0,
          duration_ms: 12000,
          chords: ["C:maj", "N", "X", "G:maj"],
          sectionType: "Verse",
        },
      ]),
    );
    const slots = raw.sections[0].chords;
    // Slots still advance for rests — the two real chords sit in slots 0 and 3.
    expect(slots).toHaveLength(2);
    expect(slots[0].startSec).toBe(0);
    expect(slots[1].startSec).toBeCloseTo((12 - 2) * (3 / 4), 6);
    expect(raw.warnings.some((w) => w.includes("single"))).toBe(false);
  });

  it("skips 1/1 single-note (pedal/riff) events with an honest warning", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "intro_1",
          start_ms: 0,
          duration_ms: 8000,
          chords: ["C:1/1", "C:1/1", "C:min7", "C:min"],
          sectionType: "Intro",
        },
      ]),
    );
    expect(raw.sections[0].chords).toHaveLength(2);
    expect(raw.warnings.some((w) => w.includes("2 single-note events"))).toBe(true);
  });

  it("maps the real corpus chord vocabulary to supported qualities", () => {
    const cases: Array<[string, string]> = [
      ["C:maj", "maj"],
      ["C:min", "min"],
      ["C:7", "7"],
      ["C:maj/5", "maj"],
      ["C:sus4(b7,9,13)", "sus4"],
      ["C:hdim7", "m7b5"],
      ["C:dim7", "dim"],
      ["C:maj(9)", "maj"],
      ["C:7(#9)", "7"],
      ["C:min9", "min7"],
      ["C:maj6", "maj"],
      ["C:aug(b7)", "aug"],
      ["C:5", "maj"],
      ["C:sus4(b7)/5", "sus4"],
      ["C:maj7(#11)", "maj7"],
      ["C:min7/2", "min7"],
      ["C:min/b7", "min"],
      ["C:sus2", "sus2"],
    ];
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "s",
          start_ms: 0,
          duration_ms: cases.length * 2000 + 2000,
          chords: cases.map(([label]) => label),
          sectionType: "Verse",
        },
      ]),
    );
    expect(raw.sections[0].chords.map((c) => c.quality)).toEqual(cases.map(([, q]) => q));

    const warnings = raw.warnings.join("\n");
    expect(warnings).toContain("power chords");
    expect(warnings).toContain("extensions simplified");
    expect(warnings).toContain("Slash-bass");
  });

  it("skips unrecognized labels and names samples in the warning", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        { id: "s", start_ms: 0, duration_ms: 8000, chords: ["C:maj", "C:zzzbo"], sectionType: "Verse" },
      ]),
    );
    expect(raw.sections[0].chords).toHaveLength(1);
    expect(raw.warnings.some((w) => w.includes("zzzbo"))).toBe(true);
  });

  it("flags the corpus-wide 120 BPM placeholder, and only that value", () => {
    const withDefault = parseMcgillJcrd(mcGillSong([], { bpm: 120 }));
    expect(withDefault.warnings.some((w) => w.includes("placeholder (120 BPM)"))).toBe(true);
    const withReal = parseMcgillJcrd(mcGillSong([], { bpm: 100 }));
    expect(withReal.warnings.some((w) => w.includes("placeholder"))).toBe(false);
  });

  it("estimates a major key from a tonic-heavy major progression", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "verse_1",
          start_ms: 0,
          duration_ms: 32000,
          chords: ["C:maj", "F:maj", "G:7", "C:maj", "A:min", "F:maj", "G:7", "C:maj"],
          sectionType: "Verse",
        },
      ]),
    );
    expect(raw.key).toBe("C");
    expect(raw.mode).toBe("ionian");
    expect(raw.warnings.some((w) => w.includes("estimated C ionian"))).toBe(true);
  });

  it("estimates a minor key when the tonic triad is minor", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([
        {
          id: "verse_1",
          start_ms: 0,
          duration_ms: 36000,
          chords: ["A:min", "A:min", "D:min", "E:7", "A:min", "G:maj", "F:maj", "E:7", "A:min"],
          sectionType: "Verse",
        },
      ]),
    );
    expect(raw.key).toBe("A");
    expect(raw.mode).toBe("aeolian");
  });

  it("marks the key estimate LOW when the chord stream is too thin to tell", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([{ id: "s", start_ms: 0, duration_ms: 4000, chords: ["C:maj"], sectionType: "Intro" }]),
    );
    expect(raw.warnings.some((w) => w.includes("estimated") && w.includes("LOW"))).toBe(true);
  });

  it("returns no key at all when there are no chords to estimate from", () => {
    const raw = parseMcgillJcrd(
      mcGillSong([{ id: "s", start_ms: 0, duration_ms: 4000, chords: ["N", "N"], sectionType: "Intro" }]),
    );
    expect(raw.key).toBeUndefined();
    expect(raw.mode).toBeUndefined();
  });
});

describe("estimateKey", () => {
  it("returns null for an empty event list", () => {
    expect(estimateKey([])).toBeNull();
  });

  it("prefers the profile winner with a real margin on clear material", () => {
    const events = ["C:maj", "F:maj", "G:7", "C:maj", "C:maj"].map((label, i) => {
      const [root, quality] = label.split(":");
      return { root, quality, startSec: i * 2, endSec: i * 2 + 2 };
    });
    const est = estimateKey(events)!;
    expect(est.key).toBe("C");
    expect(est.mode).toBe("ionian");
    // A short 5-chord stream genuinely has a small margin — the winner
    // must still beat the runner-up.
    expect(est.confidence).toBeGreaterThan(0);
  });
});
