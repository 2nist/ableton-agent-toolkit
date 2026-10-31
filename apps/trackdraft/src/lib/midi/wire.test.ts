import { describe, expect, it } from "vitest";
import { channelToIndex, clampChannelIndex, pitchToWire, velocityToWire } from "./wire";

/**
 * The contract these replace: `pitch & 0x7f`.
 *
 * Every case below is a value that a mask would turn into a *different, valid*
 * note rather than an obvious error — which is why this has to be clamped in
 * one place and asserted once.
 */
describe("pitchToWire", () => {
  it("passes ordinary pitches through unchanged", () => {
    expect(pitchToWire(60)).toBe(60);
    expect(pitchToWire(0)).toBe(0);
    expect(pitchToWire(127)).toBe(127);
  });

  it("clamps above the range instead of wrapping to a low note", () => {
    // The audible bug: a voicing one octave over the top used to wrap to a
    // note near the bottom of the keyboard.
    expect(pitchToWire(128)).toBe(127);
    expect(pitchToWire(130)).toBe(127);
    expect(pitchToWire(200)).toBe(127);
  });

  it("clamps below the range instead of wrapping to a high note", () => {
    expect(pitchToWire(-1)).toBe(0);
    expect(pitchToWire(-24)).toBe(0);
  });

  it("rounds fractions and survives non-finite input", () => {
    expect(pitchToWire(60.4)).toBe(60);
    expect(pitchToWire(60.6)).toBe(61);
    expect(pitchToWire(Number.NaN)).toBe(0);
    expect(pitchToWire(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("velocityToWire", () => {
  it("keeps velocity in 1–127", () => {
    expect(velocityToWire(96)).toBe(96);
    expect(velocityToWire(1)).toBe(1);
    expect(velocityToWire(127)).toBe(127);
  });

  it("never emits 0 (which would be a note-off)", () => {
    expect(velocityToWire(0)).toBe(1);
    expect(velocityToWire(-5)).toBe(1);
  });

  it("clamps over-range and non-finite input", () => {
    expect(velocityToWire(999)).toBe(127);
    expect(velocityToWire(Number.NaN)).toBe(1);
  });
});

describe("channelToIndex", () => {
  it("converts the app's 1-based channel to the wire's 0-based nibble", () => {
    expect(channelToIndex(1)).toBe(0);
    expect(channelToIndex(10)).toBe(9);
    expect(channelToIndex(16)).toBe(15);
  });

  it("clamps out-of-range channels rather than aliasing another one", () => {
    // `0 & 0x0f` and `32 & 0x0f` both land on channel 1 — same class of bug.
    expect(channelToIndex(0)).toBe(0);
    expect(channelToIndex(17)).toBe(15);
    expect(channelToIndex(32)).toBe(15);
  });

  it("is not the identity — an already-0-based index belongs to the other helper", () => {
    // Pinned because getting this backwards shifts a whole stem down one
    // channel, which the export tests caught when this was first written.
    expect(channelToIndex(10)).toBe(9);
    expect(clampChannelIndex(10)).toBe(10);
    expect(clampChannelIndex(9)).toBe(9);
    expect(clampChannelIndex(99)).toBe(15);
  });
});
