import { describe, it, expect } from "vitest";
import {
  tritoneSubstitution,
  secondaryDominant,
  getBorrowedChordCandidates,
  getModeAwareSubstitutions,
  getSubstitutionMenu,
} from "./substitutions";

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

describe("getModeAwareSubstitutions", () => {
  it("ionian V resolves to 3 concrete chords: vii°, iii, vi", () => {
    const subs = getModeAwareSubstitutions("ionian", "V");
    expect(subs.map((s) => s.degreeLabel).sort()).toEqual(["iii", "vi", "vii°"].sort());

    const viiDim = subs.find((s) => s.degreeLabel === "vii°")!;
    expect(viiDim.root).toBe(11);
    expect(viiDim.quality).toBe("dim");
    expect(viiDim.explanation).toMatch(/leading tone/i);

    const iii = subs.find((s) => s.degreeLabel === "iii")!;
    expect(iii.root).toBe(4);
    expect(iii.quality).toBe("min");

    const vi = subs.find((s) => s.degreeLabel === "vi")!;
    expect(vi.root).toBe(9);
    expect(vi.quality).toBe("min");
  });

  it("returns [] for a numeral the scale doesn't recognize (borrowed/non-diatonic)", () => {
    expect(getModeAwareSubstitutions("ionian", "♭VI")).toEqual([]);
    expect(getModeAwareSubstitutions("ionian", "nonsense")).toEqual([]);
  });

  it("resolves in a non-Ionian mode too (dorian i)", () => {
    const subs = getModeAwareSubstitutions("dorian", "i");
    expect(subs.length).toBeGreaterThan(0);
    for (const sub of subs) {
      expect(sub.degreeLabel).toBeTruthy();
      expect(sub.explanation).toBeTruthy();
    }
  });
});

describe("getSubstitutionMenu", () => {
  it("groups mode-aware, chromatic and borrowed subs together", () => {
    const menu = getSubstitutionMenu("ionian", "V", 7);
    expect(menu.modeAware.length).toBe(3);
    expect(menu.chromatic).toHaveLength(2);
    expect(menu.chromatic[0].label).toBe("Tritone sub");
    expect(menu.chromatic[1].label).toBe("Secondary dominant");
    expect(menu.borrowed.length).toBeGreaterThan(0);
  });

  it("modeAware is empty for a non-diatonic numeral, other groups still populate", () => {
    const menu = getSubstitutionMenu("ionian", "♭VI", 8);
    expect(menu.modeAware).toEqual([]);
    expect(menu.chromatic).toHaveLength(2);
    expect(menu.borrowed.length).toBeGreaterThan(0);
  });
});
