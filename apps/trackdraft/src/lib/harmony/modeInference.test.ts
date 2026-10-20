import { describe, it, expect } from "vitest";
import { borrowedChordIds, chordHomes, detectModeSuggestion, isChordDiatonic } from "./modeInference";
import type { Chord } from "../../types/blueprint";

let n = 0;
function chord(root: string, quality: Chord["quality"], romanNumeral = "I"): Chord {
  return { id: `c${++n}`, root: root as Chord["root"], quality, romanNumeral, beats: 4 };
}

describe("detectModeSuggestion", () => {
  it("stays silent when every chord is diatonic", () => {
    const chords = [chord("C", "maj", "I"), chord("F", "maj", "IV"), chord("G", "7", "V")];
    expect(detectModeSuggestion(chords, "C", "ionian")).toBeNull();
  });

  it("suggests lydian for a raised-4th chord (II major) in C major", () => {
    // D major in C major = D F# A. F# (#4) is foreign to C ionian and covered
    // ONLY by C lydian (C D E F# G A B) — aeolian/phrygian/etc. lack F#.
    const chords = [chord("C", "maj", "I"), chord("D", "maj", "II")];
    const s = detectModeSuggestion(chords, "C", "ionian");
    expect(s).not.toBeNull();
    expect(s!.scale).toBe("lydian");
    expect(s!.label).toContain("Lydian");
  });

  it("stays silent on ambiguous common interchange (multiple modes cover it)", () => {
    // A single bIII (Eb) in C major fits aeolian AND phrygian AND others.
    const chords = [chord("C", "maj", "I"), chord("D#", "maj", "bIII")];
    expect(detectModeSuggestion(chords, "C", "ionian")).toBeNull();
  });

  it("stays silent on genuinely chromatic clusters no single mode explains", () => {
    const chords = [chord("C", "maj", "I"), chord("C#", "dim", "#i"), chord("F#", "aug", "#IV")];
    expect(detectModeSuggestion(chords, "C", "ionian")).toBeNull();
  });

  it("returns a stable candidateId for acknowledgment keying", () => {
    const chords = [chord("C", "maj", "I"), chord("D", "maj", "II")];
    const a = detectModeSuggestion(chords, "C", "ionian");
    const b = detectModeSuggestion(chords, "C", "ionian");
    expect(a!.candidateId).toBe(b!.candidateId);
    // Resolving the foreign tone (now diatonic in lydian) -> no suggestion.
    expect(detectModeSuggestion(chords, "C", "lydian")).toBeNull();
  });

  it("reports the out-of-key chords by name", () => {
    const chords = [chord("C", "maj", "I"), chord("F", "maj", "IV"), chord("D", "maj", "II")];
    const s = detectModeSuggestion(chords, "C", "ionian");
    expect(s!.chordNames.length).toBe(1);
  });
});

describe("isChordDiatonic", () => {
  it("true for in-key chords", () => {
    expect(isChordDiatonic(chord("C", "maj"), "C", "ionian")).toBe(true);
    expect(isChordDiatonic(chord("A", "min"), "C", "ionian")).toBe(true);
    expect(isChordDiatonic(chord("G", "7"), "C", "ionian")).toBe(true);
  });

  it("false for out-of-key chords", () => {
    expect(isChordDiatonic(chord("G#", "maj"), "C", "ionian")).toBe(false); // Ab
    expect(isChordDiatonic(chord("C#", "maj"), "C", "ionian")).toBe(false); // Db
  });

  it("respects the section's own mode", () => {
    // Ab major IS diatonic in C aeolian.
    expect(isChordDiatonic(chord("G#", "maj"), "C", "aeolian")).toBe(true);
  });
});

describe("chordHomes", () => {
  const C = { key: "C" as const, scale: "ionian" as const };

  it("gives the fallback home to every chord when there are no regions", () => {
    const chords = [chord("C", "maj"), chord("F", "maj")];
    const homes = chordHomes(chords, undefined, C);
    expect(homes.size).toBe(2);
    for (const home of homes.values()) expect(home).toMatchObject({ key: "C", scale: "ionian" });
  });

  it("switches home at the region boundary, using each chord's own beat", () => {
    const chords = [chord("C", "maj"), chord("F", "maj"), chord("G", "maj"), chord("D", "maj")];
    const regions = [
      { startBeat: 0, key: "C" as const, scale: "ionian" as const, source: "authored" as const },
      { startBeat: 8, key: "G" as const, scale: "ionian" as const, source: "authored" as const },
    ];
    const homes = chordHomes(chords, regions, C);
    expect(homes.get(chords[0].id)!.key).toBe("C");
    expect(homes.get(chords[1].id)!.key).toBe("C");
    expect(homes.get(chords[2].id)!.key).toBe("G");
    expect(homes.get(chords[3].id)!.key).toBe("G");
  });
});

describe("borrowedChordIds", () => {
  const C = { key: "C" as const, scale: "ionian" as const };

  it("flags an outside chord when the section has one home", () => {
    const chords = [chord("C", "maj"), chord("G#", "maj")];
    expect([...borrowedChordIds(chords, undefined, C)]).toEqual([chords[1].id]);
  });

  it("does not flag the new key's own chords after a modulation", () => {
    // C F in C, then G D in G: D major is F#-bearing and outside C, but it is
    // the V of G — the whole point of a modulation is that it is not borrowed.
    const chords = [chord("C", "maj"), chord("F", "maj"), chord("G", "maj"), chord("D", "maj")];
    const regions = [
      { startBeat: 0, key: "C" as const, scale: "ionian" as const, source: "authored" as const },
      { startBeat: 8, key: "G" as const, scale: "ionian" as const, source: "authored" as const },
    ];
    expect(borrowedChordIds(chords, undefined, C).has(chords[3].id)).toBe(true);
    expect(borrowedChordIds(chords, regions, C).size).toBe(0);
  });

  it("still flags a genuinely outside chord inside a modulated region", () => {
    const chords = [chord("C", "maj"), chord("G", "maj"), chord("G#", "maj")];
    const regions = [
      { startBeat: 0, key: "C" as const, scale: "ionian" as const, source: "authored" as const },
      { startBeat: 4, key: "G" as const, scale: "ionian" as const, source: "authored" as const },
    ];
    expect([...borrowedChordIds(chords, regions, C)]).toEqual([chords[2].id]);
  });

  it("leaves substitutions alone — they are deliberate", () => {
    const sub: Chord = { ...chord("G#", "maj"), isSubstitution: true };
    expect(borrowedChordIds([sub], undefined, C).size).toBe(0);
  });
});
