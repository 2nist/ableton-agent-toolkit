import { describe, expect, it } from "vitest";
import {
  beginLearn,
  ccToFaderIndex,
  ccToParamValue,
  clearSlot,
  createEffectsState,
  endLearn,
  faderIndexToCc,
  paramValueToCc,
  remapCcToUnit,
  setSlot,
  slotsFromParameters,
} from "../src/index.js";

describe("fader indexing", () => {
  it("maps faders 0-7 to CC 48-55 and master (8) to CC 56", () => {
    expect(faderIndexToCc(0)).toBe(48);
    expect(faderIndexToCc(7)).toBe(55);
    expect(faderIndexToCc(8)).toBe(56);
    expect(faderIndexToCc(9)).toBeNull();
  });

  it("maps CCs back to fader indices", () => {
    expect(ccToFaderIndex(48)).toBe(0);
    expect(ccToFaderIndex(55)).toBe(7);
    expect(ccToFaderIndex(56)).toBe(8);
    expect(ccToFaderIndex(47)).toBeNull();
    expect(ccToFaderIndex(57)).toBeNull();
  });
});

describe("value conversion", () => {
  it("converts CC to parameter range", () => {
    expect(ccToParamValue(0, 0, 1)).toBeCloseTo(0);
    expect(ccToParamValue(127, 0, 1)).toBeCloseTo(1);
    expect(ccToParamValue(64, 0, 128)).toBeCloseTo(64.503, 1);
  });

  it("round-trips value → CC → value", () => {
    expect(paramValueToCc(ccToParamValue(33, -1, 1), -1, 1)).toBe(33);
  });

  it("remaps a narrow fader range onto the full 0-1 (was 1/127th before)", () => {
    // A fader that only sends ~0-1: full throw must become the whole 0-1 range.
    expect(remapCcToUnit(0, 0, 1)).toBe(0);
    expect(remapCcToUnit(1, 0, 1)).toBe(1);
    // A normal 0-127 fader stays linear.
    expect(remapCcToUnit(64, 0, 127)).toBeCloseTo(64 / 127);
    // A mid-range-only fader (60-70) still maps its full throw.
    expect(remapCcToUnit(60, 60, 70)).toBe(0);
    expect(remapCcToUnit(70, 60, 70)).toBe(1);
    expect(remapCcToUnit(65, 60, 70)).toBeCloseTo(0.5);
    // Clamps outside the learned range.
    expect(remapCcToUnit(50, 60, 70)).toBe(0);
    expect(remapCcToUnit(80, 60, 70)).toBe(1);
  });
});

describe("slots", () => {
  it("assigns, clears and learns slots", () => {
    let state = createEffectsState();
    expect(state.slots.every((s) => s === null)).toBe(true);

    const slot = { fader: 2, track: 0, device: 0, param: 2, label: "Cutoff", min: 0, max: 1 };
    state = setSlot(state, 2, slot);
    expect(state.slots[2]).toMatchObject({ label: "Cutoff" });

    state = beginLearn(state, 2);
    expect(state.learnFader).toBe(2);
    state = endLearn(state);
    expect(state.learnFader).toBeNull();

    state = clearSlot(state, 2);
    expect(state.slots[2]).toBeNull();
  });

  it("builds default slots from device parameters", () => {
    const params = Array.from({ length: 10 }, (_, i) => ({ name: `Macro ${i + 1}`, min: 0, max: 1 }));
    const slots = slotsFromParameters(1, 0, params, { name: "Global", min: 0, max: 1 });
    // First 8 faders get params 0-7; master gets param 8.
    expect(slots[0]).toMatchObject({ fader: 0, track: 1, label: "Macro 1" });
    expect(slots[7]).toMatchObject({ fader: 7, label: "Macro 8" });
    expect(slots[8]).toMatchObject({ fader: 8, label: "Global", param: 8 });
    expect(slots[6]!.label).toBe("Macro 7");
  });

  it("leaves slots null when there are no parameters", () => {
    const slots = slotsFromParameters(0, 0, []);
    expect(slots.every((s) => s === null)).toBe(true);
  });
});
