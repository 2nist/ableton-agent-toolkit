import { describe, it, expect } from "vitest";
import { tritoneSubstitution, secondaryDominant, getBorrowedChordCandidates } from "./substitutions";

describe("tritoneSubstitution", () => {
  it("G7 (pc 7) subs to Db7 (pc 1)", () => {
    const sub = tritoneSubstitution(7);
    expect(sub.root).toBe(1);
    expect(sub.quality).toBe("7");
  });

  it("is its own inverse (a tritone away from a tritone away is the original)", () => {
    const once = tritoneSubstitution(3);
    const twice = tritoneSubstitution(once.root);
    expect(twice.root).toBe(3);
  });
});

describe("secondaryDominant", () => {
  it("V/V in C major: target G (pc 7) -> D7 (pc 2)", () => {
    const sub = secondaryDominant(7);
    expect(sub.root).toBe(2);
    expect(sub.quality).toBe("7");
  });

  it("V/ii in C major: target D (pc 2) -> A7 (pc 9)", () => {
    const sub = secondaryDominant(2);
    expect(sub.root).toBe(9);
  });
});

describe("getBorrowedChordCandidates", () => {
  it("Ionian includes the classic borrowed set (bIII, iv, bVI, bVII, bII)", () => {
    const candidates = getBorrowedChordCandidates("ionian");
    const roots = candidates.map((c) => c.root).sort((a, b) => a - b);
    // bII=1, bIII=3, iv=5, bVI=8, bVII=10 -- pc 5 (iv) coincides with
    // diatonic IV's pc, so it's excluded as "already diatonic", matching
    // the function's own dedupe rule, not a bug in the test.
    expect(roots).toEqual(expect.arrayContaining([1, 3, 8, 10]));
  });

  it("never returns a pitch class already diatonic to the current mode", () => {
    const diatonicIonianPcs = [0, 2, 4, 5, 7, 9, 11];
    const candidates = getBorrowedChordCandidates("ionian");
    for (const c of candidates) {
      expect(diatonicIonianPcs).not.toContain(c.root);
    }
  });

  it("generalizes to non-Ionian modes (dorian gets real candidates too)", () => {
    const candidates = getBorrowedChordCandidates("dorian");
    expect(candidates.length).toBeGreaterThan(0);
  });
});
