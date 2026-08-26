import { describe, expect, it } from "vitest";
import {
  clearAll,
  clearPage,
  copyPageInto,
  createPattern,
  deserialize,
  effectiveVelocity,
  getStep,
  MAX_STEPS,
  randomizePage,
  serialize,
  setLength,
  setStep,
  setVelocity,
  STEPS_PER_PAGE,
  stepsPerBeat,
  toggleAccent,
  toggleStep,
} from "../src/index.js";

describe("createPattern", () => {
  it("creates an all-empty pattern with the requested voices and length", () => {
    const p = createPattern(16, 32, "16");
    expect(p.voices).toBe(16);
    expect(p.length).toBe(32);
    expect(p.steps).toHaveLength(16);
    expect(p.steps[0]).toHaveLength(MAX_STEPS);
    expect(p.steps.every((row) => row.every((hit) => hit === null))).toBe(true);
  });

  it("clamps voices and length to valid ranges", () => {
    expect(createPattern(0).voices).toBe(1);
    expect(createPattern(99).voices).toBe(16);
    expect(createPattern(16, 0).length).toBe(1);
    expect(createPattern(16, 99).length).toBe(32);
  });
});

describe("editing", () => {
  it("toggles a step on then off", () => {
    let p = createPattern();
    expect(getStep(p, 0, 0)).toBeNull();
    p = toggleStep(p, 0, 0, 100);
    expect(getStep(p, 0, 0)).toEqual({ velocity: 100, accent: false });
    p = toggleStep(p, 0, 0);
    expect(getStep(p, 0, 0)).toBeNull();
  });

  it("re-enabling a toggled step restores the previous hit", () => {
    let p = createPattern();
    p = toggleStep(p, 3, 5, 90, true);
    p = toggleStep(p, 3, 5); // off
    p = toggleStep(p, 3, 5); // on again
    expect(getStep(p, 3, 5)).toEqual({ velocity: 90, accent: true });
  });

  it("ignores out-of-range edits", () => {
    const p = createPattern();
    expect(toggleStep(p, 16, 0)).toBe(p);
    expect(toggleStep(p, 0, 32)).toBe(p);
    expect(setStep(p, -1, 0, { velocity: 1, accent: false })).toBe(p);
  });

  it("setVelocity and toggleAccent only affect existing hits", () => {
    const p = createPattern();
    expect(setVelocity(p, 0, 0, 127)).toBe(p);
    expect(toggleAccent(p, 0, 0)).toBe(p);

    let q = toggleStep(p, 0, 0, 80);
    q = setVelocity(q, 0, 0, 120);
    expect(getStep(q, 0, 0)?.velocity).toBe(120);
    q = toggleAccent(q, 0, 0);
    expect(getStep(q, 0, 0)?.accent).toBe(true);
  });

  it("applies accent boost to velocity", () => {
    expect(effectiveVelocity({ velocity: 100, accent: false })).toBe(100);
    expect(effectiveVelocity({ velocity: 100, accent: true })).toBe(124);
    expect(effectiveVelocity({ velocity: 120, accent: true })).toBe(127);
  });
});

describe("pages", () => {
  it("clearPage clears exactly one page of 8 steps", () => {
    let p = createPattern();
    for (let step = 0; step < 16; step++) p = setStep(p, 0, step, { velocity: 90, accent: false });
    p = clearPage(p, 1);
    for (let step = 0; step < 8; step++) expect(getStep(p, 0, step)).not.toBeNull();
    for (let step = 8; step < 16; step++) expect(getStep(p, 0, step)).toBeNull();
  });

  it("clearAll clears everything", () => {
    let p = toggleStep(createPattern(), 0, 0);
    p = clearAll(p);
    expect(p.steps.every((row) => row.every((hit) => hit === null))).toBe(true);
  });

  it("copyPageInto copies one page's steps across all voices", () => {
    const src = createPattern();
    let target = createPattern();
    for (let v = 0; v < 4; v++) {
      // src: page 2 has hits on step 16 + v
      src.steps[v]![16] = { velocity: 80 + v, accent: v === 0 };
    }
    target = copyPageInto(target, src, 2);
    for (let v = 0; v < 4; v++) {
      expect(getStep(target, v, 16)).toEqual(src.steps[v]![16]);
      expect(getStep(target, v, 17)).toBeNull();
    }
  });

  it("randomizePage is seeded and only touches the requested page", () => {
    let p = createPattern();
    p = randomizePage(p, 0, 1.0, () => 0.5); // density 1 → every cell hit
    for (let v = 0; v < p.voices; v++) {
      for (let step = 0; step < STEPS_PER_PAGE; step++) {
        expect(getStep(p, v, step)).not.toBeNull();
      }
      for (let step = STEPS_PER_PAGE; step < STEPS_PER_PAGE + 2; step++) {
        expect(getStep(p, v, step)).toBeNull();
      }
    }
  });
});

describe("length / resolution", () => {
  it("setLength clamps", () => {
    const p = setLength(createPattern(), 64);
    expect(p.length).toBe(32);
    expect(setLength(p, 16).length).toBe(16);
  });

  it("stepsPerBeat reflects resolution", () => {
    expect(stepsPerBeat("16")).toBe(4);
    expect(stepsPerBeat("8")).toBe(2);
  });
});

describe("serialize / deserialize", () => {
  it("round-trips a pattern with hits and accents", () => {
    let p = createPattern(4, 16, "16", 30);
    p = toggleStep(p, 0, 0, 100, true);
    p = toggleStep(p, 1, 2, 64);
    p = toggleStep(p, 3, 15, 127);
    const data = serialize(p);
    expect(data.v).toBe(4);
    expect(data.l).toBe(16);
    expect(data.s).toBe(30);
    expect(data.notes[0]).toEqual([[0, 100, 1]]);
    expect(data.notes[1]).toEqual([[2, 64, 0]]);
    const back = deserialize(data);
    expect(back).toEqual(p);
  });

  it("deserializes a compact form (accents omitted when 0)", () => {
    const p = deserialize({ v: 2, l: 8, r: "8", s: 0, notes: [[[3, 90, 0]], []] });
    expect(getStep(p, 0, 3)).toEqual({ velocity: 90, accent: false });
    expect(getStep(p, 1, 0)).toBeNull();
  });
});
