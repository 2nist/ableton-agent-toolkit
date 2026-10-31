/**
 * Mic capture for the Melody tab — the browser wiring that turns a sung or
 * hummed take into pitch frames, plus the seconds→beats conversion that
 * places the finished notes on the song timeline.
 *
 * Wire-up: `getUserMedia` → `MediaStreamAudioSourceNode` → `AnalyserNode`,
 * then a lightweight timer pulls time-domain frames and runs YIN pitch
 * detection (`pitch.ts`) on each one. Frames feed `NoteSegmenter`, which
 * groups them into discrete notes. The analysis runs on the main thread at
 * ~30fps reading from an AnalyserNode — the classic simple approach. Latency
 * is a non-issue here (we're recording, not monitoring), so no AudioWorklet
 * is needed.
 *
 * Timing is captured as wall-clock *seconds* relative to record start — the
 * recorder doesn't know (or care) about the song's bpm or where the section
 * starts. `rawNotesToBeats` converts at stop time: the caller passes the
 * beat the transport was on when recording started and the bpm, and gets
 * notes positioned on the song timeline, ready for the quantize/fit knobs.
 */

import { detectPitch } from "./pitch";
import { NoteSegmenter, DEFAULT_SEGMENTER_CONFIG, type RawMelodyNote } from "./segmenter";
import type { MelodyNote } from "../../types/blueprint";
import { secondsPerBeat } from "../time/clock";

/** One telemetry frame surfaced to the UI (for a live pitch meter) while
 *  recording. */
export interface MelodyFrame {
  /** Seconds from record start. */
  seconds: number;
  /** Fractional MIDI note of the current frame, or null when unvoiced. */
  midi: number | null;
  /** YIN clarity in [0,1]. */
  clarity: number;
  /** Whether the frame crossed the voiced threshold. */
  voiced: boolean;
}

/** Capture cadence — how often a frame is analyzed (~30fps). */
const ANALYSIS_INTERVAL_MS = 33;
/** Analyser fftSize; the time-domain buffer passed to YIN is this long. */
const FFT_SIZE = 4096;
/** Vocal-range bounds passed to the pitch detector (E2–C7). */
const MIN_FREQ = 82.4;
const MAX_FREQ = 2093;
/** Default velocity stamped on captured melody notes (matches the chord
 *  export's block-chord velocity). */
export const DEFAULT_MELODY_VELOCITY = 96;

/**
 * Records a take from the microphone. Create one per take:
 *
 * ```
 * const rec = new MelodyRecorder();
 * rec.onFrame = (f) => pitchMeter(f.midi);
 * await rec.start();
 * // ... let the user hum ...
 * const raw = rec.stop(); // RawMelodyNote[] (seconds)
 * ```
 *
 * `start()` rejects (with a readable message) when the browser has no
 * `getUserMedia` or the user denies mic access. Callers must run `start()`
 * from a user gesture so the browser's autoplay policy permits the audio
 * context to run.
 */
export class MelodyRecorder {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  // `Float32Array<ArrayBuffer>` (not the ArrayBufferLike default) because
  // AnalyserNode.getFloatTimeDomainData requires a plain heap buffer.
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private startMs = 0;
  private sampleRate = 44100;
  private segmenter = new NoteSegmenter(DEFAULT_SEGMENTER_CONFIG);

  /** Optional live telemetry hook — fired on every analyzed frame. */
  onFrame: ((frame: MelodyFrame) => void) | null = null;

  get isRunning(): boolean {
    return this.timerId !== null;
  }

  /** Start capturing. Rejects when mic access is unavailable/denied. Safe
   *  to call once per instance; a second call is a no-op while running. */
  async start(): Promise<void> {
    if (this.isRunning) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser/context (needs a secure context like localhost or HTTPS).");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      this.audioCtx = new AudioContext();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      source.connect(this.analyser);
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.sampleRate = this.audioCtx.sampleRate;
      this.startMs = performance.now();
      this.segmenter.clear();
      this.timerId = setInterval(() => this.tick(), ANALYSIS_INTERVAL_MS);
    } catch (err) {
      // Tear down the stream we already acquired if the audio graph failed.
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      throw err;
    }
  }

  /** Stop capturing and return the segmented take (seconds-relative). */
  stop(): RawMelodyNote[] {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    const notes = this.segmenter.finish((performance.now() - this.startMs) / 1000);
    this.dispose();
    return notes;
  }

  /** Stop capture and release the mic + audio graph without returning a
   *  take (cancel). */
  dispose(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.buffer = null;
  }

  private tick(): void {
    if (!this.analyser || !this.buffer) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const frame = detectPitch(this.buffer, this.sampleRate, MIN_FREQ, MAX_FREQ);
    const seconds = (performance.now() - this.startMs) / 1000;
    const clarity = frame?.clarity ?? 0;
    const voiced = frame !== null && clarity >= DEFAULT_SEGMENTER_CONFIG.voicedClarity;
    const midi = voiced ? frame!.midi : null;
    this.onFrame?.({ seconds, midi, clarity, voiced });
    this.segmenter.feed(midi, seconds, clarity);
  }
}

/**
 * Convert a raw seconds-relative take into song-beat notes placed on the
 * timeline. `startBeat` is the song beat the transport was at when
 * recording began; each note is offset by that, so the take lands where it
 * was sung. Beats are rounded to two decimals (enough for the quantize
 * knob to clean up). Notes get the default velocity.
 */
export function rawNotesToBeats(raw: RawMelodyNote[], startBeat: number, bpm: number): MelodyNote[] {
  const secPerBeat = secondsPerBeat(bpm);
  return raw.map((n) => ({
    pitch: n.pitch,
    startTime: Math.round((startBeat + n.startSec / secPerBeat) * 100) / 100,
    duration: Math.max(0.1, Math.round((n.durationSec / secPerBeat) * 100) / 100),
    velocity: DEFAULT_MELODY_VELOCITY,
  }));
}

/** Convert a MIDI note number to a display name (e.g. 60 → "C4"). */
export function midiToNoteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[pc]}${octave}`;
}
