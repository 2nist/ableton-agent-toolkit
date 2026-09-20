/**
 * Guards against drift from the real library. These import the actual
 * functions, so they only mean something inside packages/drum-library.
 */
import { describe, expect, it } from "vitest";
import { euclidOnsetSteps } from "../src/section.js";
import { motionModelFor } from "../src/blocks.js";
import { libraryOnsets } from "../src/drumImport/euclidFit.js";
import { transitionVector } from "../src/drumImport/gridToBlocks.js";

describe("libraryOnsets ≡ euclidOnsetSteps", () => {
  it("agrees over k, n, rotation — including the clamped and negative cases", () => {
    for (let n = 1; n <= 24; n++) {
      for (let k = 0; k <= n + 2; k++) {
        for (let rotation = -3; rotation <= n + 3; rotation++) {
          expect(libraryOnsets({ k, n, rotation })).toEqual(euclidOnsetSteps({ k, n, rotation }));
        }
      }
    }
  });
});

describe("transitionVector gestures compile to the intended transition models", () => {
  it("build → buildUp (sprint)", () => {
    for (const ratio of [1.15, 1.5, 2, 3]) {
      const t = transitionVector(ratio, 20, true)!;
      expect(motionModelFor(t)).toEqual({ model: "buildUp", flavor: 2 });
    }
  });

  it("crescendo → buildUp (slow burn)", () => {
    const t = transitionVector(1, 12, true)!;
    expect(motionModelFor(t)).toEqual({ model: "buildUp", flavor: 3 });
  });

  it("break → dropOut", () => {
    const t = transitionVector(0, 0, true)!;
    expect(motionModelFor(t)).toEqual({ model: "dropOut", flavor: 1 });
  });

  it("thin → breakDown (long fade)", () => {
    for (const ratio of [0.85, 0.5, 0.2]) {
      const t = transitionVector(ratio, 4, false)!;
      expect(motionModelFor(t)).toEqual({ model: "breakDown", flavor: 2 });
    }
  });
});
