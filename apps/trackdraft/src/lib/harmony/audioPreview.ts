import { chordToMidiNotes, pitchClass } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

/** Standard 12-TET: A4 (MIDI 69) = 440Hz. */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A chord's voicing as playable frequencies — octave 4 (same default as
 *  `chordToMidiNotes`) puts the root around MIDI 48-59, a comfortable
 *  register for a quick preview rather than the extension's export octave. */
export function chordToFreqs(chord: Chord): number[] {
  return chordToMidiNotes(pitchClass(chord.root), chord.quality, 4).map(midiToFreq);
}

export interface ScheduledChord {
  index: number;
  startSec: number;
  durSec: number;
}

/** Cumulative start/duration in seconds for a one-pass progression at
 *  `bpm`, honoring fractional beats (a 0.5-beat chord is a real half-beat,
 *  not rounded away). Empty input yields an empty schedule. */
export function buildSchedule(chords: { beats: number }[], bpm: number): ScheduledChord[] {
  const secPerBeat = 60 / bpm;
  const schedule: ScheduledChord[] = [];
  let cursor = 0;
  chords.forEach((chord, index) => {
    const durSec = chord.beats * secPerBeat;
    schedule.push({ index, startSec: cursor, durSec });
    cursor += durSec;
  });
  return schedule;
}

/** How long one full pass of the progression takes, in seconds — the loop
 *  period `playProgression` advances its anchor by. */
function totalDurationSec(schedule: ScheduledChord[]): number {
  const last = schedule[schedule.length - 1];
  return last ? last.startSec + last.durSec : 0;
}

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

export interface PlayProgressionOptions {
  loop?: boolean;
  onChordStart?: (index: number) => void;
  onEnd?: () => void;
}

/** Minimal WebAudio synth for auditioning chords in the browser — no
 *  export path touches this; it exists purely so a writer can hear a
 *  progression without round-tripping through Ableton. One shared
 *  AudioContext, lazily created on first play (autoplay policies require a
 *  user-gesture-triggered context, and every caller here is a click
 *  handler, so lazy creation is always safe). */
class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private voices: Voice[] = [];
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private highlightTimeouts: ReturnType<typeof setTimeout>[] = [];
  private endTimeout: ReturnType<typeof setTimeout> | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private stopVoices(): void {
    const ctx = this.ctx;
    for (const voice of this.voices) {
      if (ctx) {
        voice.gain.gain.cancelScheduledValues(ctx.currentTime);
        voice.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      }
      voice.oscillator.stop(ctx ? ctx.currentTime + 0.1 : undefined);
    }
    this.voices = [];
  }

  /** Sound one chord (as frequencies) for roughly `durSec`, cutting off
   *  anything already sounding first. */
  playChord(freqs: number[], durSec = 1): void {
    const ctx = this.getContext();
    this.stopVoices();

    const now = ctx.currentTime;
    const attack = 0.01;
    const release = Math.min(0.15, durSec / 2);
    const peak = Math.min(0.25, 0.8 / Math.max(1, freqs.length));

    for (const freq of freqs) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + attack);
      gain.gain.setTargetAtTime(0, now + durSec - release, release / 3);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + durSec + release * 2);
      this.voices.push({ oscillator, gain });
    }
  }

  /** Loop (or play once) a section's progression at `bpm`, calling
   *  `onChordStart(index)` as each chord begins so the UI can highlight it.
   *  Uses a short-interval lookahead scheduler rather than one long
   *  `setTimeout` per chord so `stop()` can cut playback immediately
   *  instead of waiting out already-queued timers. */
  playProgression(chords: Chord[], bpm: number, options: PlayProgressionOptions = {}): void {
    this.stop();
    const schedule = buildSchedule(chords, bpm);
    if (schedule.length === 0) return;

    const loopDuration = totalDurationSec(schedule);
    const ctx = this.getContext();
    const startedAt = ctx.currentTime;
    const firedThisLoop = new Set<number>();
    let loopCount = 0;

    const tick = () => {
      const elapsed = ctx.currentTime - startedAt;
      const loopIndex = Math.floor(elapsed / loopDuration);
      if (loopIndex > loopCount) {
        firedThisLoop.clear();
        loopCount = loopIndex;
      }
      const positionInLoop = elapsed - loopIndex * loopDuration;

      for (const entry of schedule) {
        if (firedThisLoop.has(entry.index)) continue;
        if (entry.startSec - positionInLoop > 0.2) continue; // outside the lookahead window
        firedThisLoop.add(entry.index);

        const delayMs = Math.max(0, (entry.startSec - positionInLoop) * 1000);
        this.highlightTimeouts.push(
          setTimeout(() => {
            this.playChord(chordToFreqs(chords[entry.index]), entry.durSec);
            options.onChordStart?.(entry.index);
          }, delayMs),
        );
      }

      if (!options.loop && elapsed >= loopDuration) {
        this.stop();
        options.onEnd?.();
      }
    };

    tick();
    this.schedulerId = setInterval(tick, 100);
  }

  /** Silence everything and cancel all pending scheduling — called on
   *  explicit Stop, on unmount, and before starting a new progression. */
  stop(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    for (const timeout of this.highlightTimeouts) clearTimeout(timeout);
    this.highlightTimeouts = [];
    if (this.endTimeout !== null) {
      clearTimeout(this.endTimeout);
      this.endTimeout = null;
    }
    this.stopVoices();
  }
}

let sharedPlayer: PreviewPlayer | null = null;

/** One player per page — auditioning a chord always interrupts whatever
 *  was sounding, which is the desired behavior whether it's triggered from
 *  the palette, the hex wheel, a chord card, or Play on the progression. */
export function getPreviewPlayer(): PreviewPlayer {
  if (!sharedPlayer) sharedPlayer = new PreviewPlayer();
  return sharedPlayer;
}
