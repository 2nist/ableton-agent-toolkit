import { describe, expect, it } from "vitest";
import { meterLabel, tempoFromDrag, TEMPO_MAX, TEMPO_MIN } from "./clock";

describe("tempoFromDrag", () => {
  it("moves a BPM every three pixels", () => {
    expect(tempoFromDrag(120, 0)).toBe(120);
    expect(tempoFromDrag(120, 3)).toBe(121);
    expect(tempoFromDrag(120, -9)).toBe(117);
  });

  it("rounds to whole BPM, so a scrub never lands on 120.4", () => {
    expect(tempoFromDrag(120, 1)).toBe(120);
    expect(tempoFromDrag(120, 2)).toBe(121);
    expect(Number.isInteger(tempoFromDrag(97, 7))).toBe(true);
  });

  it("cannot be dragged below the floor or above the ceiling", () => {
    expect(tempoFromDrag(120, -10_000)).toBe(TEMPO_MIN);
    expect(tempoFromDrag(120, 10_000)).toBe(TEMPO_MAX);
  });

  it("is symmetric — dragging back returns the tempo you started with", () => {
    expect(tempoFromDrag(120, 45)).toBe(135);
    expect(tempoFromDrag(120, 45 - 45)).toBe(120);
  });
});

describe("meterLabel", () => {
  it("writes the meter the way musicians say it", () => {
    expect(
      meterLabel({
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
      }),
    ).toBe("4/4");
    expect(
      meterLabel({
        timeSignatureNumerator: 7,
        timeSignatureDenominator: 8,
      }),
    ).toBe("7/8");
  });

  it("survives a nonsense meter rather than printing 0/0", () => {
    expect(
      meterLabel({
        timeSignatureNumerator: 0,
        timeSignatureDenominator: 0,
      }),
    ).toBe("1/1");
  });
});
