import { describe, expect, it } from "vitest";
import { chordFunctionLabel } from "./chordBuilder";

describe("chordFunctionLabel", () => {
  it("is null for a chord that is simply a degree of the section key", () => {
    expect(chordFunctionLabel({})).toBeNull();
    expect(chordFunctionLabel({ secondaryFunction: undefined })).toBeNull();
  });

  it("reads a secondary dominant as numeral over target", () => {
    expect(
      chordFunctionLabel({
        secondaryFunction: { numeral: "V7", targetDegree: 4, targetAccidental: 0 },
      }),
    ).toBe("V7/V");
  });

  it("keeps the target's accidental", () => {
    expect(
      chordFunctionLabel({
        secondaryFunction: { numeral: "V", targetDegree: 1, targetAccidental: -1 },
      }),
    ).toBe("V/♭II");
    expect(
      chordFunctionLabel({
        secondaryFunction: { numeral: "vii°", targetDegree: 1, targetAccidental: 1 },
      }),
    ).toBe("vii°/♯II");
  });

  it("labels a tonicisation of a minor-key degree by its numeral", () => {
    expect(
      chordFunctionLabel({
        secondaryFunction: { numeral: "vii°", targetDegree: 5, targetAccidental: 0 },
      }),
    ).toBe("vii°/VI");
  });
});
