import { describe, expect, it } from "vitest";
import { synthesizeTransition, type TransitionInput } from "../src/transitions.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;

function baseGroove(): [number, number, number][] {
  // A plain 4/4-ish bar of hat pulses, one every 0.25 beats, for 2 beats.
  const notes: [number, number, number][] = [];
  for (let beat = 0; beat < 2; beat += 0.25) notes.push([beat, HAT, 80]);
  return notes;
}

function input(overrides: Partial<TransitionInput> = {}): TransitionInput {
  return { spanBeats: 2, gridBeats: 0.25, velocityTarget: 100, baseNotes: baseGroove(), ...overrides };
}

describe("synthesizeTransition — buildUp", () => {
  it("ends on a strong kick+snare hit at the very last grid step", () => {
    const notes = synthesizeTransition("buildUp", input());
    const lastBeat = Math.max(...notes.map((n) => n[0]));
    const pitchesAtLastBeat = notes.filter((n) => n[0] === lastBeat).map((n) => n[1]);
    // The roll's hat pulse can also land on the last step (its own density
    // reaches "every step" by the end) — kick+snare just need to be present.
    expect(pitchesAtLastBeat).toEqual(expect.arrayContaining([KICK, SNARE]));
    expect(notes.find((n) => n[0] === lastBeat && n[1] === KICK)![2]).toBe(100); // full velocityTarget
  });

  it("gets denser toward the end (more hits in the second half than the first)", () => {
    const notes = synthesizeTransition("buildUp", input());
    const firstHalf = notes.filter((n) => n[0] < 1 && n[1] === HAT).length;
    const secondHalf = notes.filter((n) => n[0] >= 1 && n[1] === HAT).length;
    expect(secondHalf).toBeGreaterThanOrEqual(firstHalf);
  });

  it("ignores baseNotes entirely — it's fresh material", () => {
    const withBase = synthesizeTransition("buildUp", input({ baseNotes: baseGroove() }));
    const withoutBase = synthesizeTransition("buildUp", input({ baseNotes: [] }));
    expect(withBase).toEqual(withoutBase);
  });
});

describe("synthesizeTransition — breakDown", () => {
  it("thins the base groove — fewer notes than the original", () => {
    const base = baseGroove();
    const notes = synthesizeTransition("breakDown", input({ baseNotes: base }));
    expect(notes.length).toBeLessThan(base.length);
  });

  it("fades velocity toward the end of the span", () => {
    const notes = synthesizeTransition("breakDown", input());
    const early = notes.filter((n) => n[0] < 0.5);
    const late = notes.filter((n) => n[0] >= 1.5);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.max(...late.map((n) => n[2]))).toBeLessThan(Math.max(...early.map((n) => n[2])));
  });

  it("returns nothing for an empty base groove rather than inventing material", () => {
    expect(synthesizeTransition("breakDown", input({ baseNotes: [] }))).toEqual([]);
  });
});

describe("synthesizeTransition — cut", () => {
  it("is a single sharp hit at beat 0, then silence for the rest of the span", () => {
    const notes = synthesizeTransition("cut", input());
    expect(notes.every((n) => n[0] === 0)).toBe(true);
    expect(notes.map((n) => n[1]).sort()).toEqual([KICK, SNARE]);
  });

  it("hits at the target velocity, not scaled down", () => {
    const notes = synthesizeTransition("cut", input({ velocityTarget: 115 }));
    expect(notes.every((n) => n[2] === 115)).toBe(true);
  });
});

describe("synthesizeTransition — dropOut", () => {
  it("silences the kick by default, keeping everything else", () => {
    const base: [number, number, number][] = [[0, KICK, 100], [0.5, SNARE, 90], [1, HAT, 70]];
    const notes = synthesizeTransition("dropOut", input({ baseNotes: base }));
    expect(notes.some((n) => n[1] === KICK)).toBe(false);
    expect(notes.some((n) => n[1] === SNARE)).toBe(true);
    expect(notes.some((n) => n[1] === HAT)).toBe(true);
  });

  it("respects an explicit dropVoices list", () => {
    const base: [number, number, number][] = [[0, KICK, 100], [0.5, SNARE, 90], [1, HAT, 70]];
    const notes = synthesizeTransition("dropOut", input({ baseNotes: base, dropVoices: ["snare", "hat"] }));
    expect(notes).toEqual([[0, KICK, 100]]);
  });

  it("returns nothing for an empty base groove", () => {
    expect(synthesizeTransition("dropOut", input({ baseNotes: [] }))).toEqual([]);
  });
});

describe("synthesizeTransition — meter-change pickup (nextGridBeats)", () => {
  it("replaces the final beat with hits spaced at the next meter's grid", () => {
    // Span 2 beats at grid 0.25 (4/4-ish); next section is triple-feel at 1/3 beat.
    const notes = synthesizeTransition("cut", input({ nextGridBeats: 1 / 3 }));
    const pickupWindow = notes.filter((n) => n[0] >= 1 && n[1] === HAT);
    expect(pickupWindow.length).toBeGreaterThan(1);
    // Roughly evenly spaced at the new grid, not the old one.
    const gaps = pickupWindow.slice(1).map((n, i) => n[0] - pickupWindow[i]![0]);
    for (const gap of gaps) expect(gap).toBeCloseTo(1 / 3, 5);
  });

  it("is composable with any of the four models, not just cut", () => {
    const notes = synthesizeTransition("buildUp", input({ nextGridBeats: 0.5 }));
    expect(notes.length).toBeGreaterThan(0);
  });

  it("does nothing extra when nextGridBeats is absent", () => {
    const withPickup = synthesizeTransition("cut", input({ nextGridBeats: undefined }));
    expect(withPickup.every((n) => n[0] === 0)).toBe(true);
  });
});

describe("synthesizeTransition — custom voices", () => {
  it("uses the provided voice pitches instead of the defaults", () => {
    const notes = synthesizeTransition("cut", input({ voices: { kick: 60, snare: 61, hat: 62 } }));
    expect(notes.map((n) => n[1]).sort()).toEqual([60, 61]);
  });
});
