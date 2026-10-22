import { describe, expect, it } from "vitest";
import { parseMozartJcrd, parseMozartKey, parseMozartLabel, inversionFor } from "./parseMozart";

const F_MAJOR = { keyPc: 5, scale: "ionian" as const };
const C_MAJOR = { keyPc: 0, scale: "ionian" as const };

/** Root pitch class of a label, or a readable failure. */
function rootOf(label: string, key = C_MAJOR): number {
  const parsed = parseMozartLabel(label, key.keyPc, key.scale);
  if (!parsed) throw new Error(`unparsed: ${label}`);
  return parsed.rootPc;
}

describe("parseMozartKey", () => {
  it("reads the key out of the title", () => {
    expect(parseMozartKey("Piano Sonata no. 10 in C major")).toEqual({ keyName: "C", scale: "ionian" });
    expect(parseMozartKey("Piano Sonata no. 14 in C minor")).toEqual({ keyName: "C", scale: "aeolian" });
  });

  it("spells a flat key the way the title did", () => {
    expect(parseMozartKey("Piano Sonata no. 13 in B flat major")).toEqual({ keyName: "Bb", scale: "ionian" });
    expect(parseMozartKey("Piano Sonata no. 4 in E flat major")).toEqual({ keyName: "Eb", scale: "ionian" });
  });

  it("returns null rather than guessing when there is no key in the title", () => {
    expect(parseMozartKey("Untitled Sketch")).toBeNull();
  });
});

describe("inversionFor", () => {
  it("maps figured bass to the chord tone in the bass", () => {
    expect(inversionFor("")).toBe(0);
    expect(inversionFor("6")).toBe(1);
    expect(inversionFor("64")).toBe(2);
    expect(inversionFor("7")).toBe(0);
    expect(inversionFor("65")).toBe(1);
    expect(inversionFor("43")).toBe(2);
    expect(inversionFor("2")).toBe(3);
    expect(inversionFor("42")).toBe(3);
  });
});

describe("parseMozartLabel — plain numerals", () => {
  it("reads a root-position triad", () => {
    expect(parseMozartLabel("I", 0, "ionian")).toMatchObject({
      rootPc: 0, degree: 0, accidental: 0, quality: "maj", inversion: 0,
    });
  });

  it("makes a lowercase numeral minor", () => {
    expect(parseMozartLabel("vi", 0, "ionian")).toMatchObject({ rootPc: 9, quality: "min" });
  });

  it("sees a seventh in V7 and its inversions", () => {
    expect(parseMozartLabel("V7", 0, "ionian")).toMatchObject({ rootPc: 7, quality: "7" });
    // V2 is a seventh chord in third inversion, even though "2" has no 7 in it.
    expect(parseMozartLabel("V2", 0, "ionian")).toMatchObject({ quality: "7", inversion: 3 });
    expect(parseMozartLabel("V65", 0, "ionian")).toMatchObject({ quality: "7", inversion: 1 });
    expect(parseMozartLabel("V43", 0, "ionian")).toMatchObject({ quality: "7", inversion: 2 });
  });

  it("reads diminished and half-diminished", () => {
    expect(parseMozartLabel("viio7", 0, "ionian")).toMatchObject({ rootPc: 11, quality: "dim" });
    expect(parseMozartLabel("ii%65", 0, "ionian")).toMatchObject({ rootPc: 2, quality: "m7b5", inversion: 1 });
  });
});

describe("parseMozartLabel — parenthesised qualifiers", () => {
  it("does not mistake a qualifier for a seventh", () => {
    // CI(97) is a plain C major triad in C; reading "97" as figures would
    // turn it into a dominant seventh.
    expect(parseMozartLabel("CI(97)", 0, "ionian")).toMatchObject({
      rootPc: 0, quality: "maj", inversion: 0,
    });
  });

  it("ignores the decoration but keeps the figures before it", () => {
    expect(parseMozartLabel("FV6(4)", 5, "ionian")).toMatchObject({
      rootPc: 0, quality: "maj", inversion: 1,
    });
  });
});

describe("parseMozartLabel — local keys and tonicisation", () => {
  it("takes the root from the local key prefix", () => {
    // FV(64): the local key is F, so its V is C.
    expect(rootOf("FV(64)", F_MAJOR)).toBe(0);
    // DminV(64): V of D minor is A.
    expect(rootOf("DminV(64)", F_MAJOR)).toBe(9);
  });

  it("resolves a slash target within the local key", () => {
    // AV/ii in F: the local key is A, ii of A is B minor, V of B is F#.
    expect(rootOf("AV/ii", F_MAJOR)).toBe(6);
    // A bare V/ii in F: ii is Gm, V of G is D.
    expect(rootOf("V/ii", F_MAJOR)).toBe(2);
    // viio6/V in C: the target is G, and its leading tone is F#.
    expect(rootOf("viio6/V", C_MAJOR)).toBe(6);
  });

  it("reads a chain right to left", () => {
    // V/V/ii in C: ii = D, V of D = A, V of A = E.
    expect(rootOf("V/V/ii", C_MAJOR)).toBe(4);
  });

  it("treats a flat after a bare key letter as belonging to the numeral", () => {
    // FbVI in F major is F + ♭VI = Db, not F-flat major.
    expect(rootOf("FbVI", F_MAJOR)).toBe(1);
  });

  it("reads a leading-tone chord a semitone under its target", () => {
    // From Sonata no. 12: FV(64) → F#viio7/vi → Fvi(64) → vi. The target is
    // D minor, so this is C#dim7 — a semitone below D, not the diatonic C.
    expect(rootOf("F#viio7/vi", F_MAJOR)).toBe(1);
    expect(rootOf("viio7/vi", F_MAJOR)).toBe(1);
    // A flat seventh is a subtonic, not a leading tone — keep it literal.
    expect(rootOf("bvii", C_MAJOR)).toBe(10);
  });

  it("reads augmented sixths and Neapolitans as chromatic", () => {
    const italian = parseMozartLabel("It6", 5, "ionian");
    expect(italian).toMatchObject({ quality: "aug", chromatic: true });
    expect(italian!.rootPc).toBe(1); // ♭VI of F
    const neapolitan = parseMozartLabel("Cnan", 0, "ionian");
    expect(neapolitan).toMatchObject({ quality: "maj", chromatic: true, rootPc: 1 }); // ♭II of C
  });

  it("expresses the chord against the sonata key, not the local one", () => {
    // FV(64) is a C major chord; in the sonata's F major that is degree 4 (V).
    const parsed = parseMozartLabel("FV(64)", 5, "ionian")!;
    expect(parsed.rootPc).toBe(0);
    expect(parsed.degree).toBe(4);
    expect(parsed.accidental).toBe(0);
  });

  it("refuses a label it cannot read instead of inventing a chord", () => {
    expect(parseMozartLabel("", 0, "ionian")).toBeNull();
    expect(parseMozartLabel("xyz", 0, "ionian")).toBeNull();
  });
});

describe("parseMozartJcrd", () => {
  const raw = {
    title: "Piano Sonata no. 16 in C major",
    artist: "Unknown Artist",
    bpm: 120,
    time_signature: "2/4",
    source: "JAMS Dataset",
    sections: [
      { id: "chord_1", start_ms: 0, duration_ms: 2000, chords: ["I"] },
      { id: "chord_2", start_ms: 1000, duration_ms: 500, chords: ["V"] },
      { id: "chord_3", start_ms: 2000, duration_ms: 500, chords: ["I"] },
      { id: "chord_4", start_ms: 3000, duration_ms: 1000, chords: ["IV"] },
    ],
  };

  it("builds one song with the key from the title", () => {
    const song = parseMozartJcrd(raw);
    expect(song.key).toBe("C");
    expect(song.scale).toBe("ionian");
    expect(song.bpm).toBe(120);
    expect(song.timeSignatureNumerator).toBe(2);
    expect(song.timeSignatureDenominator).toBe(4);
    expect(song.sections).toHaveLength(1);
    expect(song.arrangement).toHaveLength(1);
  });

  it("takes each chord's length from the next onset, not its own duration", () => {
    // The spans overlap in this conversion (chord_1 lasts 2000ms but chord_2
    // starts at 1000ms). At 120bpm a beat is 500ms, so the chords are 2, 2 and
    // 2 beats — derived from the onsets at 0, 1000 and 2000ms.
    const song = parseMozartJcrd(raw);
    const beats = song.sections[0].chords.map((chord) => chord.beats);
    // 0→1000→2000 ms are two beats each; the last chord has no successor, so
    // it gets one beat (its own duration is ignored for the same reason).
    expect(beats).toEqual([2, 2, 2, 1]);
  });

  it("keeps the original annotation on every chord", () => {
    const song = parseMozartJcrd(raw);
    expect(song.sections[0].chords.map((chord) => chord.extendedSuffix)).toEqual(["I", "V", "I", "IV"]);
    expect(song.sections[0].chords.map((chord) => chord.romanNumeral)).toEqual(["I", "V", "I", "IV"]);
  });

  it("merges a chord that continues into the next span", () => {
    const song = parseMozartJcrd({
      ...raw,
      sections: [
        { start_ms: 0, chords: ["I"] },
        { start_ms: 1000, chords: ["I"] },
        { start_ms: 2000, chords: ["V"] },
      ],
    });
    expect(song.sections[0].chords.map((chord) => chord.romanNumeral)).toEqual(["I", "V"]);
    expect(song.sections[0].chords[0].beats).toBe(4);
  });

  it("warns instead of failing when the key cannot be read", () => {
    const song = parseMozartJcrd({ ...raw, title: "Etude" });
    expect(song.key).toBe("C");
    expect(song.provenance?.warnings?.some((w) => w.includes("could not read the key"))).toBe(true);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseMozartJcrd(null)).toThrow();
  });
});
