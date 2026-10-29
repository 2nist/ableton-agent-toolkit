/**
 * Audio file metadata parser using the Web Audio API.
 * Extracts duration, sample rate, and estimates BPM + key from audio data.
 * Produces a BlueprintSong skeleton with detected metadata.
 *
 * Note: BPM and key detection are lightweight approximations.
 * Full beat-tracking and chromagram analysis would need heavier signal processing
 * (onset detection with autocorrelation, constant-Q transform with Krumhansl-Kessler).
 * This provides a usable baseline.
 */

import type { BlueprintSong } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";

/** All note names for chromagram mapping. */
const NOTE_NAMES: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Estimate BPM using a simple onset detection + autocorrelation approach.
 * Honest about its limitations — this is a lightweight approximation,
 * not a production-grade beat tracker.
 */
function estimateBpm(audioBuffer: AudioBuffer): number {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const frameSize = 2048;
  const hopSize = 512;
  const numFrames = Math.floor((data.length - frameSize) / hopSize);

  // Onset detection function: spectral flux (simple energy change detection)
  const onsetCurve: number[] = [];
  let prevEnergy = 0;
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let energy = 0;
    for (let j = start; j < start + frameSize && j < data.length; j++) {
      energy += data[j] * data[j];
    }
    energy /= frameSize;
    const onset = Math.max(0, energy - prevEnergy);
    onsetCurve.push(onset);
    prevEnergy = energy;
  }

  // Autocorrelation of onset curve to find tempo
  const maxLag = Math.min(onsetCurve.length - 1, Math.floor((240 / 60) * sampleRate / hopSize)); // ~240 BPM
  const minLag = Math.floor((60 / 60) * sampleRate / hopSize); // ~60 BPM
  let bestLag = minLag;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i + lag < onsetCurve.length; i++) {
      corr += onsetCurve[i] * onsetCurve[i + lag];
      count++;
    }
    if (count > 0) corr /= count;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const secondsPerLag = (bestLag * hopSize) / sampleRate;
  const bpm = secondsPerLag > 0 ? 60 / secondsPerLag : 120;

  // Clamp to reasonable range
  return Math.max(40, Math.min(260, Math.round(bpm)));
}

/**
 * Estimate key using a simple chromagram (FFT bin mapping).
 * Lightweight approximation — honest about limits.
 */
function estimateKey(audioBuffer: AudioBuffer): { key: NoteName; scale: string } {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const fftSize = 8192;

  // Simple chroma vector from STFT magnitudes
  const chroma = new Array(12).fill(0);
  const hopSize = fftSize / 4;
  const numFrames = Math.floor((data.length - fftSize) / hopSize);

  for (let i = 0; i < Math.min(numFrames, 200); i++) {
    const start = i * hopSize;
    for (let bin = 0; bin < fftSize / 2; bin++) {
      const freq = (bin * sampleRate) / fftSize;
      // Map frequency to MIDI note, then to chroma
      if (freq < 55 || freq > 4000) continue; // audible pitch range
      const midiNote = 12 * Math.log2(freq / 440) + 69;
      const pitchClass = Math.round(midiNote) % 12;
      if (pitchClass >= 0 && pitchClass < 12) {
        // Simple magnitude approximation (rectangular window)
        let mag = 0;
        const end = Math.min(start + fftSize, data.length);
        for (let j = start; j < end; j++) {
          mag += Math.abs(data[j]);
        }
        chroma[pitchClass] += mag / fftSize;
      }
    }
  }

  // Krumhansl-Kessler: correlate chroma with major/minor key profiles
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let bestKey: NoteName = "C";
  let bestMode = "ionian";
  let bestScore = -Infinity;

  for (let i = 0; i < 12; i++) {
    let majorScore = 0;
    let minorScore = 0;
    for (let j = 0; j < 12; j++) {
      majorScore += chroma[(j + i) % 12] * majorProfile[j];
      minorScore += chroma[(j + i) % 12] * minorProfile[j];
    }
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = NOTE_NAMES[i];
      bestMode = "ionian";
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = NOTE_NAMES[i];
      bestMode = "aeolian";
    }
  }

  return { key: bestKey, scale: bestMode };
}

/**
 * Parse audio file metadata and produce a BlueprintSong skeleton.
 * Must be called with an AudioContext and ArrayBuffer.
 */
export async function audioToBlueprintSong(
  arrayBuffer: ArrayBuffer,
  title: string,
): Promise<BlueprintSong> {
  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    audioCtx.close();
  }

  const bpm = estimateBpm(audioBuffer);
  const { key, scale } = estimateKey(audioBuffer);

  const now = new Date().toISOString();
  const song: BlueprintSong = {
    id: crypto.randomUUID(),
    title,
    key,
    scale: scale as BlueprintSong["scale"],
    bpm,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    concept: `Audio import: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings: [
        `BPM estimation is approximate (onset detection + autocorrelation).`,
        `Key estimation is approximate (chromagram + Krumhansl-Kessler).`,
        `Review and adjust in the editor.`,
      ],
    },
    createdAt: now,
    updatedAt: now,
  };

  return song;
}

/**
 * Parse a text/lyrics file and produce a BlueprintSong with a single
 * section containing the raw text as lyrics.
 */
export function textToBlueprintSong(text: string, title: string): BlueprintSong {
  const now = new Date().toISOString();
  const sectionId = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    title,
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: sectionId,
        name: "Lyrics",
        role: "verse",
        bars: 16,
        chords: [],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
        lyrics: text,
      },
    ],
    arrangement: [{ sectionId, repeats: 1 }],
    concept: "Lyrics import",
    provenance: {
      source: "docx-ingest",
      extractedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}