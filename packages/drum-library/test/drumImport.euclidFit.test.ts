import { describe, expect, it } from "vitest";
import { fitEuclid, libraryOnsets, stepsToString, type OnsetFn } from "../src/drumImport/euclidFit.js";

const pat = (s: string): boolean[] => [...s].map((c) => c === "x");

describe("libraryOnsets — pinned to the repo agent's probe run of euclidOnsetSteps", () => {
  it("reproduces the probe output exactly", () => {
    expect(libraryOnsets({ k: 3, n: 8, rotation: 0 })).toEqual([0, 3, 5]);
    expect(libraryOnsets({ k: 3, n: 8, rotation: 1 })).toEqual([1, 4, 6]);
    expect(libraryOnsets({ k: 2, n: 16, rotation: 4 })).toEqual([4, 12]);
    expect(libraryOnsets({ k: 5, n: 8, rotation: 0 })).toEqual([0, 2, 3, 5, 6]);
    expect(libraryOnsets({ k: 4, n: 16, rotation: 0 })).toEqual([0, 4, 8, 12]);
  });

  it("is NOT the textbook necklace (E(3,8) is x..x.x.. here, not x..x..x.)", () => {
    expect(stepsToString(pat("x..x.x.."))).toBe("x..x.x..");
    expect(libraryOnsets({ k: 3, n: 8, rotation: 0 })).toEqual([0, 3, 5]);
  });
});

describe("fitEuclid — the backbeat vocabulary", () => {
  it("four on the floor is E(4,16)", () => {
    const f = fitEuclid(pat("x...x...x...x..."))!;
    expect([f.k, f.n, f.rotation, f.error]).toEqual([4, 16, 0, 0]);
  });

  it("snare on 2 and 4 is E(2,16) rotated by 4", () => {
    const f = fitEuclid(pat("....x.......x..."))!;
    expect([f.k, f.n, f.rotation, f.exact]).toEqual([2, 16, 4, true]);
  });

  it("straight eighth hats are E(8,16)", () => {
    const f = fitEuclid(pat("x.x.x.x.x.x.x.x."))!;
    expect([f.k, f.n, f.rotation, f.exact]).toEqual([8, 16, 0, true]);
  });

  it("reports the miss for a non-Euclidean groove", () => {
    const f = fitEuclid(pat("x.....x.x.x....."))!;
    expect(f.exact).toBe(false);
    expect(f.error).toBeGreaterThan(0);
  });

  it("returns null for silence", () => {
    expect(fitEuclid(pat("................"))).toBeNull();
  });
});

describe("fitEuclid — round trip and convention", () => {
  it("recovers an exact fit for every pattern the app can generate", () => {
    for (let n = 1; n <= 12; n++) {
      for (let k = 1; k <= n; k++) {
        for (let rotation = 0; rotation < n; rotation++) {
          const on = new Set(libraryOnsets({ k, n, rotation }));
          const steps = Array.from({ length: n }, (_, i) => on.has(i));
          const f = fitEuclid(steps)!;
          expect(f.exact).toBe(true);
          // whatever params it reports must regenerate the same steps
          expect(libraryOnsets(f)).toEqual([...on].sort((a, b) => a - b));
        }
      }
    }
  });

  it("reports rotation in the onset function's own convention", () => {
    const steps = pat(".x..x.x."); // E(3,8) rotated by 1: [1,4,6]
    expect(fitEuclid(steps)!.rotation).toBe(1);

    const reversed: OnsetFn = ({ k, n, rotation }) =>
      libraryOnsets({ k, n, rotation: 0 })
        .map((s) => (((s - rotation) % n) + n) % n)
        .sort((a, b) => a - b);
    const f = fitEuclid(steps, { onsets: reversed })!;
    expect(f.exact).toBe(true);
    expect(f.rotation).toBe(7); // mirrored: same steps, opposite direction
  });
});
