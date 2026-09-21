import { describe, it, expect } from "vitest";
import { detectModeSuggestion, isChordDiatonic } from "./modeInference";
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
