import { describe, it, expect } from "vitest";
import { detectPitch, frequencyToMidi } from "./pitch";

const SR = 44100;

/** Synthesize `seconds` of a sine wave at `freq` Hz into a Float32Array. */
function sine(freq: number, seconds: number, amplitude = 0.5): Float32Array {
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return buf;
}

/** White noise — the canonical "not a pitch" test. */
function noise(seconds: number): Float32Array {
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (Math.random() * 2 - 1) * 0.5;
  }
  return buf;
}

describe("frequencyToMidi", () => {
  it("maps A4 (440Hz) to 69 and C4 to 60", () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 3);
    expect(frequencyToMidi(261.626)).toBeCloseTo(60, 1);
  });
  it("returns -Infinity for non-positive frequencies", () => {
    expect(frequencyToMidi(0)).toBe(-Infinity);
  });
});

describe("detectPitch (YIN)", () => {
  it("detects a clean 440Hz tone", () => {
    const frame = detectPitch(sine(440, 0.25), SR);
    expect(frame).not.toBeNull();
    expect(frame!.frequency).toBeCloseTo(440, 0);
    expect(frame!.clarity).toBeGreaterThan(0.9);
    expect(frame!.midi).toBeCloseTo(69, 0);
  });

  it("detects a low hum (110Hz) and a high tone (880Hz) across the vocal range", () => {
    const low = detectPitch(sine(110, 0.25), SR);
    expect(low!.frequency).toBeCloseTo(110, 0);
    const high = detectPitch(sine(880, 0.25), SR);
    expect(high!.frequency).toBeCloseTo(880, 0);
  });

  it("reads silence as unvoiced (null)", () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
  });

  it("reads pure noise as unvoiced (null)", () => {
    expect(detectPitch(noise(0.25), SR)).toBeNull();
  });

  it("stays within a semitone of a slightly detuned tone (vibrato-ish 445Hz)", () => {
    // 445Hz is ~+19 cents off A4 — YIN should land between A4 and A#4,
    // not double the octave.
    const frame = detectPitch(sine(445, 0.25), SR)!;
    expect(frame.frequency).toBeGreaterThan(420);
    expect(frame.frequency).toBeLessThan(470);
  });
});
