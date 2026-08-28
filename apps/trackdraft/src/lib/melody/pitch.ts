/**
 * Monophonic pitch detection for the Melody tab's audio-to-MIDI pipeline.
 *
 * Implements the YIN algorithm (de Cheveigné & Kawahara, 2002) — a
 * time-domain autocorrelation-style method that's the standard choice for
 * real-time single-voice pitch tracking: robust to the small pitch
 * deviations and vibrato a sung or hummed line produces, cheap enough to
 * run per-analysis-frame on a modest hop, and easy to reason about (the
 * `clarity` output doubles as a voiced/unvoiced gate).
 *
 * The functions here are pure — they take a `Float32Array` of samples and
 * a sample rate and return a pitch. The mic capture + note segmentation
 * that feeds them lives in `recorder.ts`.
 */

/** A detected pitch frame, or null when the buffer reads as unvoiced. */
export interface PitchFrame {
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** YIN confidence in [0,1] — how periodic the frame is. Roughly 0.9+
   *  for a clean sung tone, lower for breath, noise, or consonants. */
  clarity: number;
  /** Fractional MIDI note number of `frequency` — the caller decides how
   *  to round, so vibrato/glissando stay smooth. */
  midi: number;
}

/** Absolute-threshold cutoff for the first YIN pass (lower = stricter —
 *  fewer false positives, but a quiet or breathy tone may read unvoiced). */
const YIN_THRESHOLD = 0.15;

/** Convert a frequency to a fractional MIDI note number (69 = A4 = 440Hz). */
export function frequencyToMidi(frequency: number): number {
  if (frequency <= 0) return -Infinity;
  return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * Run YIN pitch detection on a monophonic buffer. Returns null when the
 * frame is unvoiced — not periodic enough to trust a pitch (silence,
 * breath, a consonant).
 *
 * `minFrequency`/`maxFrequency` bound the search lag so the detector
 * ignores subharmonics and room rumble. Defaults span a wide vocal range
 * (E2–C7).
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minFrequency = 82.4, // E2 — bottom of the bass clef, safely under any hum
  maxFrequency = 2093, // C7 — top soprano / whistle
): PitchFrame | null {
  const n = samples.length;
  if (n < 64) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minFrequency));
  if (maxLag <= minLag) return null;

  // Difference function: d(tau) = sum over j of (x[j] - x[j+tau])^2,
  // normalized by the window length per lag so long lags aren't favored
  // just because they sum over fewer terms.
  const diff = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let sum = 0;
    const window = n - tau;
    for (let j = 0; j < window; j++) {
      const delta = samples[j] - samples[j + tau];
      sum += delta * delta;
    }
    diff[tau] = sum / window;
  }

  // Cumulative mean normalized difference: d'(0) = 1 and
  // d'(tau) = d(tau) * tau / sum(d(1..tau)). Normalizing by the running
  // average is what makes YIN amplitude-robust — a loud frame and a quiet
  // frame of the same pitch land on the same d' curve.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
  }

  // Absolute threshold: the first lag where d' dips below the cutoff.
  let tauEstimate = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null; // no periodic candidate → unvoiced

  // Walk forward to the bottom of the valley the threshold crossing sits on
  // (YIN step 3, valley form). A clean tone's d' descends *gradually* into
  // its fundamental valley, so the 0.15 crossing can land tens of samples
  // before the true minimum — a fixed ±N neighborhood search would grab
  // the descending edge instead of the valley and read the pitch sharp
  // (measured: 440Hz → 450). Walking while d' keeps falling lands on the
  // valley bottom, which is exactly the fundamental period.
  let tauMin = tauEstimate;
  while (tauMin + 1 <= maxLag && cmnd[tauMin + 1] < cmnd[tauMin]) tauMin++;
  const bestValue = cmnd[tauMin];

  // Parabolic interpolation around the minimum for sub-sample precision
  // (YIN step 4) — this is what keeps a 440Hz tone reading 440, not 439.
  let tau = tauMin;
  const left = cmnd[tau - 1] ?? cmnd[tau];
  const center = cmnd[tau];
  const right = cmnd[tau + 1] ?? cmnd[tau];
  const denom = 2 * (2 * center - left - right);
  if (denom !== 0) {
    const delta = (right - left) / denom;
    if (delta > -1 && delta < 1) tau += delta;
  }

  const frequency = sampleRate / tau;
  const clarity = Math.max(0, Math.min(1, 1 - bestValue));
  return { frequency, clarity, midi: frequencyToMidi(frequency) };
}
