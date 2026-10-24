import { describe, expect, it } from "vitest";
import { asStepParam, clampParam, cycleValue, PARAM_SPECS, STEP_PARAMS } from "./stepParams";
import type { DrumBlockNote } from "../../../types/blueprint";

const note = (o: Partial<DrumBlockNote>): DrumBlockNote => ({ beat: 0, voice: "snare", velocity: 100, ...o });

describe("stepParams — the parameter lane model", () => {
  it("formats every parameter for display", () => {
    expect(PARAM_SPECS.vel.format(96, 1)).toBe("96");
    expect(PARAM_SPECS.nudge.format(2 / 32, 1)).toBe("+2");
    expect(PARAM_SPECS.nudge.format(-3 / 32, 1)).toBe("-3");
    expect(PARAM_SPECS.nudge.format(0, 1)).toBe("0");
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

  it("writes clamp into range", () => {
    const n = note({});
    PARAM_SPECS.prob.write(n, 5, 1);
    expect(n.prob).toBe(1);
    PARAM_SPECS.vel.write(n, 999, 1);
    expect(n.velocity).toBe(127);
    PARAM_SPECS.ratchet.write(n, 9, 1);
    expect(n.ratchet).toBe(4);
    expect(clampParam(PARAM_SPECS.nudge, -9)).toBe(-0.5);
    expect(clampParam(PARAM_SPECS.nudge, 9)).toBe(0.5);
  });

  it("cycles discrete params on click", () => {
    expect(cycleValue(PARAM_SPECS.ratchet, 1)).toBe(2);
    expect(cycleValue(PARAM_SPECS.ratchet, 4)).toBe(1);
    expect(cycleValue(PARAM_SPECS.flam, 0)).toBe(1);
    expect(cycleValue(PARAM_SPECS.flam, 1)).toBe(0);
  });

  it("exposes the six parameters in order (gate retired, voice added 2026-10-23)", () => {
    expect(STEP_PARAMS).toEqual(["vel", "nudge", "prob", "ratchet", "flam", "voice"]);
  });

  it("VOICE only offers the lane's own family, and cycles within it", () => {
    // HAT = closed · open · pedal; PERC = rim · clap · shaker · cowbell
    expect(cycleValue(PARAM_SPECS.voice, 0, "hat")).toBe(1);
    expect(cycleValue(PARAM_SPECS.voice, 2, "hat")).toBe(0);
    expect(cycleValue(PARAM_SPECS.voice, 1, "rim")).toBe(2);
    expect(cycleValue(PARAM_SPECS.voice, 3, "rim")).toBe(0);
    expect(PARAM_SPECS.voice.format(1, 1, "hat")).toBe("O.HAT");
    expect(PARAM_SPECS.voice.format(1, 1, "rim")).toBe("CLAP");
    expect(PARAM_SPECS.voice.format(2, 1, "rim")).toBe("SHAKER");
    expect(PARAM_SPECS.voice.format(3, 1, "rim")).toBe("COWBELL");
    // round-trips through the note's `voice` field
    const n = note({ voice: "closedHat" });
    PARAM_SPECS.voice.write(n, 1, 1, "hat");
    expect(n.voice).toBe("openHat");
    expect(PARAM_SPECS.voice.read(n, 1, "hat")).toBe(1);
    // a voice outside the lane reads as "not authored" rather than as index 0
    expect(PARAM_SPECS.voice.read(note({ voice: "kick" }), 1, "hat")).toBeUndefined();
  });

  it("reads a stale persisted chip selection as VEL", () => {
    expect(asStepParam("gate")).toBe("vel");
    expect(asStepParam(undefined)).toBe("vel");
    expect(asStepParam("ratchet")).toBe("ratchet");
  });
});
