/**
 * Tiny DSP kit for the drum transcriber — no dependencies beyond the
 * standard library (ffmpeg does the decoding, so the whole analyzer runs
 * under tsx). Everything here is pure and deterministic: the same samples
 * always produce the same numbers, which is what lets the synthetic-signal
 * tests pin the math.
 *
 * The pipeline is the classic 3-band drum transcriber:
 *   audio → per-frame band energies (kick / snare / hat) →
 *   per-band log-difference onset strength → adaptive peak picking →
 *   assign every onset to the nearest grid step.
 * The beat grid comes from the song blueprint (bpm + section bars), with
 * its phase and micro-tempo fitted against the onset envelope itself
 * (`fitBeatGrid`) — mp3s have encoder delay and humans are not click
 * tracks, so a pure bpm guess drifts.
 */

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/** Iterative radix-2 Cooley–Tukey FFT (in place). `n` must be a power of 2. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error(`fftInPlace: size ${n} is not a power of two`);

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const vr = re[b] * cwr - im[b] * cwi;
        const vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Band energies + onset strength
// ---------------------------------------------------------------------------

export type Band = readonly [number, number];

/** The classic three lanes: kick body / snare body / hats (Hz). */
export const DEFAULT_BANDS: Record<"kick" | "snare" | "hat", Band> = {
  kick: [30, 120],
  snare: [150, 500],
  hat: [6000, 10000],
};

export interface BandEnergyOptions {
  /** FFT size (power of 2). Default 1024 — 46 ms at 22.05 kHz; long enough
   *  to isolate the kick band from the snare's 200 Hz body (a 512 window
   *  leaks snare energy into the kick band and every backbeat reads as a
   *  kick). */
  fftSize?: number;
  /** Hop in samples. Default 110 — ≈5 ms at 22.05 kHz. */
  hop?: number;
}

export interface BandEnergies {
  /** Seconds per frame hop. */
  hopSec: number;
  /** Analysis window length in seconds (fftSize / sampleRate). */
  windowSec: number;
  frames: number;
  /** One Float64Array per band name — per-frame band power. */
  bands: Record<string, Float64Array>;
}

/**
 * Per-frame band power: Hann-windowed FFT every `hop` samples, power summed
 * over each band's bins. Log-flux on these later cancels any absolute
 * scaling, so no normalization is needed.
 */
export function bandEnergies(
  samples: Float32Array,
  sampleRate: number,
  bands: Record<string, Band> = DEFAULT_BANDS,
  opts: BandEnergyOptions = {},
): BandEnergies {
  const fftSize = opts.fftSize ?? 1024;
  const hop = opts.hop ?? 110;
  const names = Object.keys(bands);
  const frames = samples.length >= fftSize ? Math.floor((samples.length - fftSize) / hop) + 1 : 0;

  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

  const out: Record<string, Float64Array> = {};
  for (const name of names) out[name] = new Float64Array(Math.max(0, frames));

  // band → inclusive bin range (skip DC: a rumble offset would own bin 0)
  const binOf = (hz: number) => Math.max(1, Math.min(fftSize / 2 - 1, Math.round((hz * fftSize) / sampleRate)));
  const ranges = names.map((name) => [binOf(bands[name][0]), binOf(bands[name][1])] as const);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let f = 0; f < frames; f++) {
    const base = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[base + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let b = 0; b < names.length; b++) {
      const [lo, hi] = ranges[b];
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += re[k] * re[k] + im[k] * im[k];
      out[names[b]][f] = sum;
    }
  }

  return { hopSec: hop / sampleRate, windowSec: fftSize / sampleRate, frames, bands: out };
}

/**
 * Half-wave onset strength: the positive rise of log1p(amplitude).
 *
 * log1p on the AMPLITUDE (√power) is the trick that makes this robust:
 * a plain log-power difference from silence turns the tiniest band
 * leakage into a huge "onset" (log of a small number is still big when
 * eps is tiny), and a linearly floored difference misses quiet hits in
 * loud songs. log1p compresses both ends — leakage stays near zero while
 * a mid-level real hit still produces a clearly larger rise.
 */
export function onsetStrength(energy: Float64Array): Float64Array {
  const out = new Float64Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    const d = Math.log1p(Math.sqrt(energy[i])) - Math.log1p(Math.sqrt(energy[i - 1]));
    out[i] = d > 0 ? d : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Peak picking
// ---------------------------------------------------------------------------

export interface Peak {
  /** Frame index into the onset-strength array. */
  frame: number;
  strength: number;
}

export interface PickPeakOptions {
  /** Threshold = median + k · MAD-based sigma. Default 6. */
  k?: number;
}

/**
 * Adaptive onset peaks: local maxima of the strength above BOTH a robust
 * noise threshold (median + k·σ_MAD) and a fraction of the strong-onset
 * level (p99.5 · 0.2). The median/MAD keeps quiet songs honest; the
 * percentile floor stops near-silent leakage ripples from registering as
 * hits in cleanly recorded material where σ_MAD collapses to ~0.
 */
export function pickPeaks(sf: Float64Array, opts: PickPeakOptions = {}): Peak[] {
  const k = opts.k ?? 6;
  if (sf.length < 3) return [];
  const med = median(sf);
  const mad = median(absDeviation(sf, med));
  const floor = quantile(sf, 0.995) * 0.2;
  const thr = Math.max(med + k * Math.max(mad * 1.4826, 1e-9), floor);
  const peaks: Peak[] = [];
  for (let i = 1; i < sf.length - 1; i++) {
    if (sf[i] <= thr) continue;
    if (sf[i] > sf[i - 1] && sf[i] >= sf[i + 1]) peaks.push({ frame: i, strength: sf[i] });
  }
  return peaks;
}

function median(values: Float64Array): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function absDeviation(values: Float64Array, med: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.abs(values[i] - med);
  return out;
}

/** The value at `q` quantile (0..1) of a copy of `values`. */
export function quantile(values: Float64Array, q: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Beat-grid phase fit
// ---------------------------------------------------------------------------

export interface BeatGrid {
  /** Seconds from the start of the audio to beat 0 of the song grid. */
  offset: number;
  /** Multiplicative tempo correction — actual = blueprint bpm × scale. */
  scale: number;
  /** Mean envelope value at the fitted beat positions (debug/quality hint). */
  score: number;
}

export interface FitOptions {
  /** Search range for the tempo correction, ± this fraction. Default 0.015. */
  tempoRangePct?: number;
  /** Coarse offset resolution as a fraction of a beat. Default 0.01. */
  offsetStepPct?: number;
}

/**
 * Fit the blueprint's beat grid to the audio: exhaustive-ish search for
 * (offset, tempo scale) maximizing the onset envelope sampled at the beat
 * positions. Two passes — coarse then refined around the winner — which is
 * plenty: humans drift ≪1‰ and mp3 delay is constant.
 */
export function fitBeatGrid(
  sf: Float64Array,
  hopSec: number,
  bpm: number,
  beats: number,
  opts: FitOptions = {},
): BeatGrid {
  const period = 60 / bpm;
  const dur = sf.length * hopSec;
  const usable = Math.max(1, Math.min(beats, Math.floor(dur / (period * 0.98)) - 1));

  const sample = (t: number): number => {
    const x = t / hopSec;
    if (x <= 0 || x >= sf.length - 1) return 0;
    const i = Math.floor(x);
    const f = x - i;
    return sf[i] * (1 - f) + sf[i + 1] * f;
  };
  const scoreAt = (offset: number, scale: number): number => {
    let sum = 0;
    for (let beat = 0; beat < usable; beat++) sum += sample(offset + beat * period * scale);
    return sum / usable;
  };

  const range = opts.tempoRangePct ?? 0.015;
  const offStepPct = opts.offsetStepPct ?? 0.01;

  let best: BeatGrid = { offset: 0, scale: 1, score: -1 };
  const coarseScales = Math.round((range * 2) / 0.001) + 1;
  const coarseOffsets = Math.round(1 / offStepPct);
  for (let si = 0; si < coarseScales; si++) {
    const scale = 1 - range + si * 0.001;
    for (let oi = 0; oi < coarseOffsets; oi++) {
      const offset = (oi * period * offStepPct) % period;
      const score = scoreAt(offset, scale);
      if (score > best.score) best = { offset, scale, score };
    }
  }

  // refine: ±1 coarse step at a quarter resolution
  for (let si = -5; si <= 5; si++) {
    const scale = best.scale + si * 0.0002;
    for (let oi = -5; oi <= 5; oi++) {
      const offset = best.offset + oi * period * offStepPct * 0.2;
      if (offset < 0) continue;
      const score = scoreAt(offset, scale);
      if (score > best.score) best = { offset, scale, score };
    }
  }
  return best;
}
