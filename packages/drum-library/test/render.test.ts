import { describe, expect, it } from "vitest";
import { renderGroove } from "../src/render.js";
import type { AudioBuffer } from "../src/wav.js";
import type { KitVoice } from "../src/kit.js";
import type { DrumNote } from "../src/types.js";

const KICK = 36;
const SNARE = 38;
const RIDE = 51;

/** A one-shot that is a constant 1.0 for a few samples, so gain is readable off the output. */
function flatSample(length = 8): AudioBuffer {
  return { sampleRate: 44100, samples: new Float32Array(length).fill(1) };
}

function kit(voices: KitVoice[]): Map<KitVoice, AudioBuffer> {
  return new Map(voices.map((voice) => [voice, flatSample()]));
}

/** Peak level of a single isolated hit rendered on its own. */
function peakOf(note: DrumNote, velocityCurve?: number): number {
  const result = renderGroove([note], kit(["kick", "snare", "ride"]), {
    bpm: 120,
    tailSeconds: 0.01,
    velocityCurve,
  });
  let peak = 0;
  for (const value of result.samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

describe("velocity", () => {
  it("renders a ghost note far quieter than an accent", () => {
    // The bug this guards: a linear map with a lifted floor squashed a jazz
    // take's real 21–120 velocity range into ~9dB, so every hit arrived
    // sounding like it was struck at full force. Real ghost-to-accent
    // contrast is roughly 30dB.
    const ghost = peakOf({ beat: 0, pitch: SNARE, velocity: 21 });
    const accent = peakOf({ beat: 0, pitch: SNARE, velocity: 120 });
    const decibels = 20 * Math.log10(accent / ghost);
    expect(decibels).toBeGreaterThan(24);
  });

  it("puts velocity 127 at full level", () => {
    expect(peakOf({ beat: 0, pitch: KICK, velocity: 127 })).toBeCloseTo(1, 5);
  });

  it("does not prop quiet hits up off the floor", () => {
    // A floor under the gain curve is what flattened dynamics before.
    expect(peakOf({ beat: 0, pitch: KICK, velocity: 5 })).toBeLessThan(0.01);
  });

  it("is monotonic in velocity", () => {
    const levels = [10, 30, 60, 90, 127].map((velocity) =>
      peakOf({ beat: 0, pitch: RIDE, velocity }),
    );
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
  });

  it("honours an explicit curve", () => {
    // Linear is still reachable for comparison, it is just not the default.
    const linear = peakOf({ beat: 0, pitch: KICK, velocity: 64 }, 1);
    const squared = peakOf({ beat: 0, pitch: KICK, velocity: 64 }, 2);
    expect(linear).toBeCloseTo(64 / 127, 3);
    expect(squared).toBeCloseTo((64 / 127) ** 2, 3);
  });
});

describe("timing", () => {
  it("places hits at their exact beat position", () => {
    const result = renderGroove(
      [
        { beat: 0, pitch: KICK, velocity: 127 },
        { beat: 1, pitch: SNARE, velocity: 127 },
      ],
      kit(["kick", "snare"]),
      { bpm: 120, tailSeconds: 0.01 },
    );
    // At 120bpm a beat is 0.5s = 22050 samples.
    expect(result.samples[0]).toBeGreaterThan(0.9);
    expect(result.samples[22050]).toBeGreaterThan(0.9);
    expect(result.samples[11025]).toBe(0);
  });

  it("preserves sub-grid microtiming rather than snapping to the beat", () => {
    // If onsets were rounded to the grid, a laid-back take would render
    // identically to a quantised one and the whole feel premise would be
    // untestable by ear.
    const onGrid = renderGroove([{ beat: 1, pitch: KICK, velocity: 127 }], kit(["kick"]), {
      bpm: 120,
      tailSeconds: 0.01,
    });
    const behind = renderGroove([{ beat: 1.05, pitch: KICK, velocity: 127 }], kit(["kick"]), {
      bpm: 120,
      tailSeconds: 0.01,
    });
    const firstHit = (buffer: Float32Array) => buffer.findIndex((value) => Math.abs(value) > 0.5);
    expect(firstHit(behind.samples)).toBeGreaterThan(firstHit(onGrid.samples));
  });
});

describe("unmapped voices", () => {
  it("reports hits with no sample instead of dropping them silently", () => {
    // A kit with no ride would otherwise render as a sparser groove than the
    // drummer actually played.
    const result = renderGroove(
      [{ beat: 0, pitch: RIDE, velocity: 100 }],
      new Map<KitVoice, AudioBuffer>(),
      { bpm: 120, tailSeconds: 0.01 },
    );
    expect(result.unmapped.get("ride")).toBe(1);
  });

  it("substitutes a related voice when one is available", () => {
    // Vintage machines often lack an open hat entirely; falling back to the
    // closed hat keeps the groove's shape intact.
    const result = renderGroove([{ beat: 0, pitch: 46, velocity: 127 }], kit(["closedHat"]), {
      bpm: 120,
      tailSeconds: 0.01,
    });
    expect(result.unmapped.size).toBe(0);
    expect(result.peak).toBeGreaterThan(0.9);
  });
});

describe("empty input", () => {
  it("produces no audio rather than throwing", () => {
    const result = renderGroove([], kit(["kick"]), { bpm: 120 });
    expect(result.samples.length).toBe(0);
    expect(result.peak).toBe(0);
  });
});
