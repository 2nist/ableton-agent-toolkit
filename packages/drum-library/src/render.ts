import { VOICE_FALLBACKS, voiceOf, type KitVoice } from "./kit.js";
import type { AudioBuffer } from "./wav.js";
import type { DrumNote } from "./types.js";

export interface RenderOptions {
  bpm: number;
  sampleRate?: number;
  /** Extra time after the last hit so decays aren't cut off. */
  tailSeconds?: number;
  /**
   * Exponent mapping velocity to amplitude: `gain = (velocity/127) ** curve`.
   *
   * 2 is the sampler convention and the default. A linear mapping (1) makes
   * quiet hits far too loud — a real ghost-note-to-accent spread is around
   * 30dB, and linear gain over a typical jazz take's velocity range produces
   * barely 9dB, which is why everything then sounds hammered at full tilt.
   *
   * There is deliberately no floor under this. Ghost notes are *meant* to sit
   * on the edge of audibility; propping them up destroys the dynamic contrast
   * that distinguishes a human performance from a programmed one.
   */
  velocityCurve?: number;
}

export interface RenderResult extends AudioBuffer {
  /** Hits that had no sample to play, by voice — a kit missing a ride, say. */
  unmapped: Map<KitVoice, number>;
  /**
   * Hits whose MIDI note isn't in the kit map at all, by pitch. Reported
   * separately because these are silently absent from the audio while also
   * being invisible to `unmapped` — a groove can lose hits to an
   * unrecognised articulation and simply sound thinner than it is.
   */
  unmappedPitches: Map<number, number>;
  peak: number;
}

/**
 * Mix a groove into audio using one-shot samples.
 *
 * Onsets are placed at their exact fractional sample position rather than
 * snapped to any grid: the microtiming *is* the groove, and rounding it away
 * would make a laid-back funk take sound identical to a quantised one — the
 * precise failure that made the previous pattern library worthless.
 */
export function renderGroove(
  notes: DrumNote[],
  samples: Map<KitVoice, AudioBuffer>,
  options: RenderOptions,
): RenderResult {
  const sampleRate = options.sampleRate ?? 44100;
  const tailSeconds = options.tailSeconds ?? 1.5;
  const velocityCurve = options.velocityCurve ?? 2;
  const secondsPerBeat = 60 / options.bpm;

  const unmapped = new Map<KitVoice, number>();
  const unmappedPitches = new Map<number, number>();
  if (notes.length === 0) {
    return { sampleRate, samples: new Float32Array(0), unmapped, unmappedPitches, peak: 0 };
  }

  const lastBeat = Math.max(...notes.map((note) => note.beat));
  const length = Math.ceil((lastBeat * secondsPerBeat + tailSeconds) * sampleRate);
  const output = new Float32Array(length);

  for (const note of notes) {
    const voice = voiceOf(note.pitch);
    if (!voice) {
      unmappedPitches.set(note.pitch, (unmappedPitches.get(note.pitch) ?? 0) + 1);
      continue;
    }

    const sample = resolveVoice(voice, samples);
    if (!sample) {
      unmapped.set(voice, (unmapped.get(voice) ?? 0) + 1);
      continue;
    }

    const gain = (note.velocity / 127) ** velocityCurve;

    const start = note.beat * secondsPerBeat * sampleRate;
    mixInto(output, sample.samples, start, gain);
  }

  let peak = 0;
  for (const value of output) peak = Math.max(peak, Math.abs(value));

  return { sampleRate, samples: output, unmapped, unmappedPitches, peak };
}

function resolveVoice(voice: KitVoice, samples: Map<KitVoice, AudioBuffer>): AudioBuffer | null {
  const direct = samples.get(voice);
  if (direct) return direct;
  for (const fallback of VOICE_FALLBACKS[voice] ?? []) {
    const candidate = samples.get(fallback);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Add a one-shot into the output at a fractional sample offset, using linear
 * interpolation so sub-sample timing survives. At 44.1kHz one sample is
 * ~0.02ms, far below audibility on its own — but rounding every onset in a
 * groove biases the whole feel toward the grid.
 */
function mixInto(output: Float32Array, sample: Float32Array, start: number, gain: number): void {
  const base = Math.floor(start);
  const fraction = start - base;

  for (let i = 0; i < sample.length; i++) {
    const target = base + i;
    if (target < 0 || target >= output.length) continue;
    const current = sample[i];
    const next = i + 1 < sample.length ? sample[i + 1] : 0;
    output[target] += (current * (1 - fraction) + next * fraction) * gain;
  }
}

/** Scale to a target peak. Only attenuates — quiet material is left alone. */
export function normalise(buffer: RenderResult, targetPeak = 0.89): void {
  if (buffer.peak <= targetPeak || buffer.peak === 0) return;
  const scale = targetPeak / buffer.peak;
  for (let i = 0; i < buffer.samples.length; i++) buffer.samples[i] *= scale;
  buffer.peak = targetPeak;
}
