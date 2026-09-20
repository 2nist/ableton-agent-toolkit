import { describe, expect, it } from "vitest";
import { fftInPlace, onsetStrength, pickPeaks } from "./dsp";
import { transcribe, velocityFromStrength } from "./transcribe";

const SR = 22050;

type Lane = "kick" | "snare" | "hat";
interface Hit { time: number; lane: Lane; amp?: number }

/** A band-contained synthetic kit: kick 70 Hz, snare 200/320 Hz, hat
 *  9 kHz — each squarely inside one analyzer band, so the test pins the
 *  pipeline, not the drum kit. */
function synth(hits: Hit[], seconds: number, lead = 0): Float32Array {
  const n = Math.floor((seconds + lead) * SR);
  const buf = new Float32Array(n);
  for (const h of hits) {
    const amp = h.amp ?? 1;
    const start = Math.floor((lead + h.time) * SR);
    const len = Math.floor(0.25 * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      let s = 0;
      if (h.lane === "kick") s = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.05);
      else if (h.lane === "snare") {
        s = (0.55 * Math.sin(2 * Math.PI * 200 * t) + 0.4 * Math.sin(2 * Math.PI * 320 * t)) * Math.exp(-t / 0.06);
      } else {
        s = Math.sin(2 * Math.PI * 9000 * t) * Math.exp(-t / 0.02);
      }
      buf[start + i] += amp * s * 0.5;
    }
  }
  return buf;
}

/** Two bars of 4/4 at 120 bpm: kick 1 & 3, snare 2 & 4, hats on 8ths. */
function twoBarKit(): Hit[] {
  const hits: Hit[] = [];
  for (const bar of [0, 2]) {
    hits.push({ time: bar, lane: "kick", amp: 1 });
    hits.push({ time: bar + 1, lane: "kick", amp: 0.9 });
    hits.push({ time: bar + 0.5, lane: "snare", amp: 0.9 });
    hits.push({ time: bar + 1.5, lane: "snare", amp: 1 });
    for (let e = 0; e < 8; e++) hits.push({ time: bar + e * 0.25, lane: "hat", amp: 0.5 });
  }
  return hits;
}

const OPTS = { sampleRate: SR, bpm: 120, beatsPerBar: 4, stepsPerBar: 16, totalBeats: 8 };

const stepsOf = (r: ReturnType<typeof transcribe>, lane: Lane, bar: number): number[] =>
  r.lanes[lane][bar].map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);

describe("drumAnalysis — DSP primitives", () => {
  it("FFT puts a sine in its bin", () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 1000 * i) / SR);
    fftInPlace(re, im);
    let best = 1;
    let bestP = -1;
    for (let k = 1; k < n / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (p > bestP) { bestP = p; best = k; }
    }
    expect(best).toBe(Math.round((1000 * n) / SR)); // bin 46
  });

  it("onsetStrength is a half-wave rise of log1p(amplitude)", () => {
    const stack = new Float64Array([1, 1, 10, 10, 1]);
    const sf = onsetStrength(stack);
    expect(sf[0]).toBe(0);
    expect(sf[1]).toBe(0);
    expect(sf[2]).toBeCloseTo(Math.log1p(Math.sqrt(10)) - Math.log1p(1), 6);
    expect(sf[3]).toBe(0);
    expect(sf[4]).toBe(0);
  });

  it("pickPeaks finds the spikes above the adaptive threshold", () => {
    const sf = new Float64Array(64);
    sf[10] = 5;
    sf[30] = 8;
    sf[31] = 2;
    const peaks = pickPeaks(sf, { k: 4 });
    expect(peaks.map((p) => p.frame)).toEqual([10, 30]);
    expect(peaks[1].strength).toBe(8);
  });

  it("velocityFromStrength floors at 20, saturates at 120", () => {
    expect(velocityFromStrength(0)).toBe(30);
    expect(velocityFromStrength(1)).toBe(120);
    expect(velocityFromStrength(5)).toBe(120);
  });
});

describe("drumAnalysis — transcription of a known kit", () => {
  it("recovers the grid: kick 1&3, snare 2&4, hats on eighths", () => {
    const r = transcribe(synth(twoBarKit(), 4), OPTS);
    expect(Math.abs(r.offset)).toBeLessThan(0.06);
    expect(Math.abs(r.scale - 1)).toBeLessThan(0.01);
    for (const bar of [0, 1]) {
      expect(stepsOf(r, "kick", bar)).toEqual([0, 8]);
      expect(stepsOf(r, "snare", bar)).toEqual([4, 12]);
      expect(stepsOf(r, "hat", bar)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    }
    expect(r.hits.kick).toBe(4);
    expect(r.hits.snare).toBe(4);
  });

  it("fits a leading silence instead of smearing the grid", () => {
    const r = transcribe(synth(twoBarKit(), 4, 0.15), OPTS);
    expect(r.offset).toBeGreaterThan(0.08);
    expect(r.offset).toBeLessThan(0.21);
    expect(stepsOf(r, "kick", 0)).toEqual([0, 8]);
    expect(stepsOf(r, "snare", 0)).toEqual([4, 12]);
  });

  it("survives a small tempo offset (grid fit corrects it)", () => {
    // the kit actually played at 122 bpm while the blueprint says 120, so
    // the fitted grid period must SHRINK: scale ≈ 120/122 ≈ 0.984
    const hits = twoBarKit().map((h) => ({ ...h, time: h.time * (120 / 122) }));
    const r = transcribe(synth(hits, 4), OPTS);
    expect(r.scale).toBeGreaterThan(0.98);
    expect(r.scale).toBeLessThan(0.99);
    expect(stepsOf(r, "kick", 0)).toEqual([0, 8]);
    expect(stepsOf(r, "snare", 0)).toEqual([4, 12]);
  });
});
