import { describe, expect, it } from "vitest";
import {
  advanceBySeconds,
  createClock,
  followLive,
  stepDurationSeconds,
  stepFromFractionalBeat,
} from "../src/index.js";

describe("stepDurationSeconds", () => {
  it("computes step length at 16th notes and 8th notes", () => {
    // 120 bpm → 0.5s per beat → 16th = 0.125s, 8th = 0.25s
    expect(stepDurationSeconds(120, "16")).toBeCloseTo(0.125);
    expect(stepDurationSeconds(120, "8")).toBeCloseTo(0.25);
  });

  it("never divides by zero for absurd bpm", () => {
    expect(stepDurationSeconds(0, "16")).toBeGreaterThan(0);
  });
});

describe("advanceBySeconds (free-run)", () => {
  it("holds position while stopped", () => {
    const clock = { ...createClock(120, "16"), step: 2 };
    expect(advanceBySeconds(clock, 1, 32)).toBe(clock);
  });

  it("advances exactly one step per 16th at 120 bpm", () => {
    let clock = { ...createClock(120, "16"), isPlaying: true };
    clock = advanceBySeconds(clock, 0.125, 32);
    expect(clock.step).toBe(1);
    expect(clock.phase).toBeCloseTo(0);
  });

  it("wraps around the pattern length", () => {
    let clock = { ...createClock(120, "16"), isPlaying: true };
    // 32 steps × 0.125s = 4s for a full pass; advance 4.25s → step 2 (after wrap)
    clock = advanceBySeconds(clock, 4.25, 32);
    expect(clock.step).toBe(2);
  });

  it("accumulates fractional phase", () => {
    let clock = { ...createClock(120, "16"), isPlaying: true };
    clock = advanceBySeconds(clock, 0.0625, 32); // half a 16th
    expect(clock.step).toBe(0);
    expect(clock.phase).toBeCloseTo(0.5);
  });
});

describe("followLive", () => {
  it("derives the step from a fractional beat", () => {
    let clock = createClock(120, "16");
    // beat 1.25 → 5 sixteenths → step 5
    clock = followLive(clock, 1.25, 32);
    expect(clock.step).toBe(5);
    expect(clock.phase).toBeCloseTo(0);
  });

  it("re-syncs when Live restarts (beat resets to 0)", () => {
    let clock = createClock(120, "16");
    clock = followLive(clock, 100, 32);
    expect(clock.step).toBe(16); // 100*4 = 400 % 32 = 16
    clock = followLive(clock, 0, 32);
    expect(clock.step).toBe(0);
  });

  it("handles 8th-note resolution", () => {
    let clock = createClock(120, "8");
    clock = followLive(clock, 2.5, 32); // 5 eighths → step 5
    expect(clock.step).toBe(5);
  });
});

describe("stepFromFractionalBeat", () => {
  it("matches followLive for the same inputs", () => {
    const direct = stepFromFractionalBeat(3.75, "16", 32);
    const viaClock = followLive(createClock(120, "16"), 3.75, 32);
    expect(direct.step).toBe(viaClock.step);
    expect(direct.phase).toBeCloseTo(viaClock.phase);
    // 3.75 * 4 = 15 sixteenths → step 15
    expect(direct.step).toBe(15);
  });
});
