import { chordToMidiNotes, pitchClass } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { applyPerformanceEffect, type PerfNote } from "./performanceEffects";
import { Soundfont2, type Soundfont2 as Soundfont2Instance } from "smplr";
import { SoundFont2 } from "soundfont2";

/** Standard 12-TET: A4 (MIDI 69) = 440Hz. */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Inverse of midiToFreq — used only to backfill a MIDI pitch for the
 *  legacy freq-only playChord() path, which predates sampler playback and
 *  has no pitch of its own to hand the sampler. */
function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

/** A chord's voicing as playable frequencies — octave 4 (same default as
 *  `chordToMidiNotes`) puts the root around MIDI 48-59, a comfortable
 *  register for a quick preview rather than the extension's export octave. */
export function chordToFreqs(chord: Chord): number[] {
  return chordToMidiNotes(pitchClass(chord.root), chord.quality, 4).map(midiToFreq);
}

export interface PerformedVoice {
  pitch: number;
  freq: number;
  startOffsetSec: number;
  durSec: number;
  velocity: number;
}

/** A chord's voicing with its own `performance` effect (strum/pulse/legato)
 *  already applied — the same transform chordClips.ts's export path uses,
 *  so preview audio matches what actually ships to Ableton. `startTime`/
 *  `duration` in the shared transform are nominally "beats", but for a
 *  one-shot preview hold there's no tempo context beyond `durSec` itself,
 *  so they're applied directly as seconds — consistent with how `strumMs`
 *  is already authored (divided by 1000 to a small offset) in the shared
 *  module. */
function chordToPerformedVoicing(chord: Chord, durSec: number): PerformedVoice[] {
  const midiNotes = chordToMidiNotes(pitchClass(chord.root), chord.quality, 4);
  const baseNotes: PerfNote[] = midiNotes.map((pitch) => ({
    pitch,
    startTime: 0,
    duration: durSec,
    velocity: 100,
  }));
  const performed = applyPerformanceEffect(baseNotes, chord.performance, chord.id);

  // Debug: confirm transforms are producing staggered output
  if (chord.performance?.style === "strum" && performed.length > 1) {
    const offsets = performed.map((n) => n.startTime.toFixed(3));
    const firstGap = performed.length > 1 ? (performed[1].startTime - performed[0].startTime).toFixed(3) : "n/a";
    console.log(`[audioPreview] strum applied: ${performed.length} notes, offsets=[${offsets.join(", ")}], first-gap=${firstGap}s`);
  }

  return performed.map((n) => ({
    pitch: n.pitch,
    freq: midiToFreq(n.pitch),
    startOffsetSec: n.startTime,
    durSec: n.duration,
    velocity: n.velocity,
  }));
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

export interface InstrumentOption {
  name: string;
  url: string;
}

/** Static catalog of the bundled .sf2 files, served as-is from `public/`
 *  (not bundled — soundfonts are too large to route through the JS module
 *  graph). Add an entry here (and drop the file in public/instruments/) to
 *  make a new one selectable in the instrument picker. */
export const AVAILABLE_INSTRUMENTS: InstrumentOption[] = [
  { name: "Sad Piano", url: encodeURI("/instruments/Sad Piano.sf2") },
  { name: "Hammond B3", url: encodeURI("/instruments/Hammond B3.sf2") },
  { name: "Cello (Karoryfer)", url: encodeURI("/instruments/CelloKaroryfer.sf2") },
  { name: "Saturn", url: encodeURI("/instruments/Saturn.sf2") },
  { name: "Distortion Bass", url: encodeURI("/instruments/Bread Breads Distortion Bass Guitar v1.1 FIXED.sf2") },
];

const DEFAULT_INSTRUMENT_URL = AVAILABLE_INSTRUMENTS[0].url;

/** Minimal WebAudio synth for auditioning chords in the browser — no
 *  export path touches this; it exists purely so a writer can hear a
 *  progression without round-tripping through Ableton. One shared
 *  AudioContext, lazily created on first play (autoplay policies require a
 *  user-gesture-triggered context, and every caller here is a click
 *  handler, so lazy creation is always safe).
 *
 *  Voices come from a real sampled instrument (a .sf2 soundfont, read
 *  directly via smplr's Soundfont2) once it finishes loading; until then,
 *  and if loading fails, playback falls back to the plain oscillator synth
 *  below so a chord always makes *some* sound immediately on first click. */
class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private voices: Voice[] = [];
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private highlightTimeouts: ReturnType<typeof setTimeout>[] = [];
  private endTimeout: ReturnType<typeof setTimeout> | null = null;
  private sampler: Soundfont2Instance | null = null;
  private samplerLoadPromise: Promise<void> | null = null;
  private currentInstrumentUrl: string = DEFAULT_INSTRUMENT_URL;
  private pendingVolume = 100;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Fetches, parses and readies the .sf2 at `url` as the active sampler.
   *  Shared by `ensureSampler` (first load) and `setInstrument` (switching
   *  later) — the only difference between them is what happens to whatever
   *  sampler was active before. */
  private loadInstrument(url: string): Promise<void> {
    const instance = Soundfont2(this.getContext(), {
      url,
      createSoundfont: (data) => new SoundFont2(data),
      volume: this.pendingVolume,
    });
    return instance.ready
      .then(() => {
        const firstInstrument = instance.instrumentNames[0];
        return firstInstrument ? instance.loadInstrument(firstInstrument) : undefined;
      })
      .then(() => {
        this.sampler = instance;
      })
      .catch((err) => {
        console.warn(`[PreviewPlayer] failed to load ${url}, using synth fallback`, err);
      });
  }

  /** Kicks off the sampler load once, the first time it's needed, and
   *  returns the (memoized) load promise so callers can wait on it instead
   *  of racing it — see `scheduleVoicing`. After a `setInstrument` switch,
   *  `samplerLoadPromise` already points at that load, so this is a no-op
   *  until the *next* fresh load is needed. */
  private ensureSampler(): Promise<void> {
    if (!this.samplerLoadPromise) {
      this.samplerLoadPromise = this.loadInstrument(this.currentInstrumentUrl);
    }
    return this.samplerLoadPromise;
  }

  /** Switch the sampled instrument to a different .sf2 (see
   *  `AVAILABLE_INSTRUMENTS`). Resolves once the new file is loaded and
   *  ready; the old instrument is disposed only once the new one has taken
   *  over, so a chord already sounding when you switch isn't cut off
   *  mid-note. Notes played *during* the switch use the oscillator
   *  fallback via the same wait-briefly-then-fallback path as first load. */
  setInstrument(url: string): Promise<void> {
    if (url === this.currentInstrumentUrl && this.samplerLoadPromise) return this.samplerLoadPromise;
    this.currentInstrumentUrl = url;
    const previous = this.sampler;
    this.sampler = null;
    this.samplerLoadPromise = this.loadInstrument(url).then(() => {
      if (previous !== this.sampler) previous?.dispose();
    });
    return this.samplerLoadPromise;
  }

  getCurrentInstrumentUrl(): string {
    return this.currentInstrumentUrl;
  }

  /** 0-127, MIDI-style volume — matches smplr's own scale. Applied
   *  immediately if a sampler is already loaded; otherwise remembered and
   *  passed as the `volume` construction option the next time one loads. */
  setVolume(volume: number): void {
    this.pendingVolume = volume;
    if (this.sampler) this.sampler.output.volume = volume;
  }

  getVolume(): number {
    return this.pendingVolume;
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
    this.sampler?.stop();
  }

  /** Schedules one voice per entry, each with its own start offset,
   *  duration and velocity — cutting off anything already sounding first.
   *  Shared by `playChord` (uniform voicing) and `playChordObject`
   *  (performance-effect-staggered voicing). Uses the sampled instrument
   *  once it's loaded; otherwise falls back to the oscillator synth below.
   *
   *  The very first call of a session races the sf2 load against the
   *  click that triggered it — without waiting, that first chord would
   *  always land on the oscillator fallback (wrong timbre) while every
   *  later chord, once `this.sampler` is populated, sounds correct. So a
   *  call made before loading finishes waits briefly for it instead of
   *  immediately falling back; a short grace period still guarantees
   *  sound if loading is slow or fails outright. */
  private scheduleVoicing(voicing: PerformedVoice[]): void {
    const samplerLoad = this.ensureSampler();
    if (this.sampler) {
      this.playVoicingNow(voicing);
      return;
    }
    let played = false;
    const playOnce = () => {
      if (played) return;
      played = true;
      this.playVoicingNow(voicing);
    };
    samplerLoad.then(playOnce);
    setTimeout(playOnce, 250);
  }

  private playVoicingNow(voicing: PerformedVoice[]): void {
    const ctx = this.getContext();
    this.stopVoices();

    const now = ctx.currentTime;

    if (this.sampler) {
      for (const v of voicing) {
        this.sampler.start({
          note: v.pitch,
          velocity: v.velocity,
          time: now + Math.max(0, v.startOffsetSec),
          duration: v.durSec,
        });
      }
      return;
    }

    const attack = 0.01;
    for (const v of voicing) {
      const startAt = now + Math.max(0, v.startOffsetSec);
      const release = Math.min(0.15, v.durSec / 2);
      const peak = Math.min(0.25, 0.8 / Math.max(1, voicing.length)) * (v.velocity / 100);

      const oscillator = ctx.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = v.freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peak, startAt + attack);
      gain.gain.setTargetAtTime(0, startAt + v.durSec - release, release / 3);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + v.durSec + release * 2);
      this.voices.push({ oscillator, gain });
    }
  }

  /** Sound one chord (as frequencies) for roughly `durSec`, cutting off
   *  anything already sounding first. */
  playChord(freqs: number[], durSec = 1): void {
    this.scheduleVoicing(
      freqs.map((freq) => ({ pitch: freqToMidi(freq), freq, startOffsetSec: 0, durSec, velocity: 100 })),
    );
  }

  /** Sound one chord the same way `playChord` does, but honoring its own
   *  `performance` effect (strum/pulse/legato) if it has one — so preview
   *  audio matches what the export pipeline actually renders. */
  playChordObject(chord: Chord, durSec = 1): void {
    this.scheduleVoicing(chordToPerformedVoicing(chord, durSec));
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
            this.playChordObject(chords[entry.index], entry.durSec);
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
