import { describe, expect, it } from "vitest";
import { clampParam, cycleValue, PARAM_SPECS, STEP_PARAMS } from "./stepParams";
import type { DrumBlockNote } from "../../../types/blueprint";

const note = (o: Partial<DrumBlockNote>): DrumBlockNote => ({ beat: 0, voice: "snare", velocity: 100, ...o });

describe("stepParams — the parameter lane model", () => {
  it("formats every parameter for display", () => {
    expect(PARAM_SPECS.vel.format(96, 1)).toBe("96");
    expect(PARAM_SPECS.nudge.format(2 / 32, 1)).toBe("+2");
    expect(PARAM_SPECS.nudge.format(-3 / 32, 1)).toBe("-3");
    expect(PARAM_SPECS.nudge.format(0, 1)).toBe("0");
    expect(PARAM_SPECS.gate.format(150, 1)).toBe("150%");
    expect(PARAM_SPECS.prob.format(0.8, 1)).toBe("80%");
    expect(PARAM_SPECS.ratchet.format(2, 1)).toBe("×2");
    expect(PARAM_SPECS.flam.format(1, 1)).toBe("F");
    expect(PARAM_SPECS.flam.format(0, 1)).toBe("–");
  });

  it("reads only authored fields (undefined otherwise)", () => {
    expect(PARAM_SPECS.prob.read(note({}), 1)).toBeUndefined();
    expect(PARAM_SPECS.prob.read(note({ prob: 0.5 }), 1)).toBe(0.5);
    expect(PARAM_SPECS.flam.read(note({ flam: true }), 1)).toBe(1);
    expect(PARAM_SPECS.flam.read(note({}), 1)).toBeUndefined();
    expect(PARAM_SPECS.ratchet.read(note({ ratchet: 3 }), 1)).toBe(3);
  });

  it("gate round-trips percent through durBeats against the step grid", () => {
    const n = note({});
    PARAM_SPECS.gate.write(n, 200, 0.5);
    expect(n.durBeats).toBeCloseTo(1.0, 6);
    expect(PARAM_SPECS.gate.read(n, 0.5)).toBeCloseTo(200, 6);
    // the same note on a different grid reads as a different percent — the
    // length is absolute, the display is grid-relative
    expect(PARAM_SPECS.gate.read(n, 1)).toBeCloseTo(100, 6);
  });

  it("writes clamp into range", () => {
    const n = note({});
    PARAM_SPECS.prob.write(n, 5, 1);
    expect(n.prob).toBe(1);
    PARAM_SPECS.vel.write(n, 999, 1);
    expect(n.velocity).toBe(127);
    PARAM_SPECS.ratchet.write(n, 9, 1);
    expect(n.ratchet).toBe(4);
    expect(clampParam(PARAM_SPECS.gate, 5)).toBe(10);
    expect(clampParam(PARAM_SPECS.gate, 900)).toBe(400);
  });

  it("cycles discrete params on click", () => {
    expect(cycleValue(PARAM_SPECS.ratchet, 1)).toBe(2);
    expect(cycleValue(PARAM_SPECS.ratchet, 4)).toBe(1);
    expect(cycleValue(PARAM_SPECS.flam, 0)).toBe(1);
    expect(cycleValue(PARAM_SPECS.flam, 1)).toBe(0);
  });

  it("exposes all six parameters in order", () => {
    expect(STEP_PARAMS).toEqual(["vel", "nudge", "gate", "prob", "ratchet", "flam"]);
  });
});
