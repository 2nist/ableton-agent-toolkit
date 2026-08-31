import { sectionSpans } from "../arrangement";
import { planChordStem, planBassStem, planDrumStem, type MidiNote } from "../midiExport";
import { planColorStem } from "../colorStem";
import { planMelodyStem } from "../melody/melodyStem";
import type { BlueprintSong } from "../../types/blueprint";

/** 1-based MIDI channels (1-16, matching how Ableton's UI numbers them) —
 *  one per generated stem, so each Ableton track can listen on its own
 *  channel of the same shared virtual port instead of everything landing
 *  on channel 1. Defaults match the template set's actual track order, so
 *  channel number = track number for the four tracks TrackDraft drives:
 *  `kit` (drums, ch.1), `crave` (bass, ch.2), `chord` (ch.3 — it already
 *  listens to all channels, so this works with no Ableton-side change;
 *  `kit`/`crave`/`color` need a one-time "MIDI From" repoint to this
 *  port, filtered to their own channel). */
export interface LiveMidiChannelMap {
  chords: number;
  bass: number;
  drums: number;
  color: number;
  /** Melody — the captured hum-to-MIDI line. Defaults to ch.5, matching
   *  the template's `melody` track. */
  melody: number;
}

export const DEFAULT_LIVE_MIDI_CHANNELS: LiveMidiChannelMap = {
  drums: 1,
  bass: 2,
  chords: 3,
  color: 4,
  melody: 5,
};

export interface MidiOutputInfo {
  id: string;
  name: string;
}

/** True in any browser context exposing the Web MIDI API (Chrome/Edge; not
 *  Safari/Firefox as of this writing) — callers use this to hide MIDI-out
 *  UI entirely rather than show a picker that can never list anything. */
export function midiOutSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

let midiAccess: MIDIAccess | null = null;

async function getMidiAccess(): Promise<MIDIAccess> {
  if (!midiAccess) midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  return midiAccess;
}

/** Every MIDI output port currently visible to the browser — includes both
 *  hardware interfaces and virtual buses (e.g. macOS's IAC Driver), which
 *  is what a DAW like Ableton actually listens on. */
export async function listMidiOutputs(): Promise<MidiOutputInfo[]> {
  const access = await getMidiAccess();
  return Array.from(access.outputs.values()).map((o) => ({ id: o.id, name: o.name ?? o.id }));
}

/** Resolves a port id (from `listMidiOutputs`) to the live `MIDIOutput`
 *  `LiveMidiScheduler.start` needs — reuses the same cached `MIDIAccess`
 *  `listMidiOutputs` populated, rather than requesting access again. */
export async function getMidiOutput(id: string): Promise<MIDIOutput | null> {
  const access = await getMidiAccess();
  return access.outputs.get(id) ?? null;
}

/** Sends one short MIDI note on a 1-based `channel` through `output` — a
 *  quick way to verify a port + channel actually reaches a Live track
 *  before hitting Play. Note on, then note off ~300ms later, both
 *  future-timestamped so they dispatch on time even if the tab is busy. */
export function sendTestNote(output: MIDIOutput, channel: number, pitch = 60, velocity = 100): void {
  const ch = Math.max(0, Math.min(15, channel - 1));
  const now = performance.now() + 50;
  const p = Math.max(0, Math.min(127, Math.round(pitch)));
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  output.send([0x90 | ch, p, v], now);
  output.send([0x80 | ch, p, 0], now + 300);
}

const LOOKAHEAD_MS = 400;
const SCHEDULER_INTERVAL_MS = 50;
const ALL_NOTES_OFF_CC = 123;

interface ScheduledNote {
  note: MidiNote;
  channel: number; // 1-based
}

/** Streams a song's chords/bass/drums out to a real MIDI output port in
 *  real time, timed off the song's own bpm — the live-performance
 *  counterpart to `midiExport.ts`'s static file export, reusing the exact
 *  same stem generators so a live take and an exported file always agree
 *  on what the song sounds like.
 *
 *  Uses a lookahead scheduler (classic Web Audio-style pattern, adapted
 *  for `MIDIOutput.send(data, timestamp)`'s future-timestamp support)
 *  rather than firing each note the instant its time arrives: a `setInterval`
 *  tick that only *fires late* would otherwise mean late notes, but here it
 *  just tops up a queue of already-correctly-timestamped messages the
 *  browser's own MIDI subsystem dispatches on time. `LOOKAHEAD_MS` is
 *  generous specifically so a backgrounded/unfocused tab (where browsers
 *  throttle timers) is far less likely to miss a note than with a tight
 *  lookahead — there's still a real limit to this if the tab gets throttled
 *  harder than the lookahead window, which no timer-based scheduler can
 *  fully rule out from a plain script running on the main thread. */
/** Start/loop options for `LiveMidiScheduler.start` — mirror
 *  `SongTransport.play()`'s PlayOptions so the backing MIDI can start at
 *  the same beat and loop the same region as the playhead (used when
 *  recording a melody against a section). */
export interface LiveSchedulerOptions {
  /** Song beat to start at (notes before this are skipped). Default 0. */
  startBeat?: number;
  /** When both set, only notes inside [loopStart, loopEnd) are played, and
   *  they repeat forever (folded into the loop) instead of stopping. */
  loopStart?: number;
  loopEnd?: number;
}

class LiveMidiScheduler {
  private output: MIDIOutput | null = null;
  private channelMap: LiveMidiChannelMap = DEFAULT_LIVE_MIDI_CHANNELS;
  private notes: ScheduledNote[] = [];
  private startedAtMs = 0;
  private secPerBeat = 0.5;
  private startBeat = 0;
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  private lastScheduledElapsed = 0;
  private lastNoteStart = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  get isRunning(): boolean {
    return this.timerId !== null;
  }

  /** Whether the current schedule is looping a region (a section loop). */
  get isLooping(): boolean {
    return this.loopStart !== null && this.loopEnd !== null;
  }

  /** The active loop region, or null when not looping — lets a live re-plan
   *  preserve the loop instead of dropping back to a one-shot play. */
  get loopRegion(): { start: number; end: number } | null {
    return this.isLooping ? { start: this.loopStart!, end: this.loopEnd! } : null;
  }

  start(
    song: BlueprintSong,
    output: MIDIOutput,
    channelMap: LiveMidiChannelMap = DEFAULT_LIVE_MIDI_CHANNELS,
    opts: LiveSchedulerOptions = {},
  ): void {
    this.stop();
    this.output = output;
    this.channelMap = channelMap;

    const spans = sectionSpans(song);
    const scheduled: ScheduledNote[] = [
      ...planChordStem(spans).map((note) => ({ note, channel: channelMap.chords })),
      ...planBassStem(spans).map((note) => ({ note, channel: channelMap.bass })),
      ...planDrumStem(spans, song).map((note) => ({ note, channel: channelMap.drums })),
      ...planColorStem(spans).map((note) => ({ note, channel: channelMap.color })),
      ...planMelodyStem(spans).map((note) => ({ note, channel: channelMap.melody })),
    ];
    scheduled.sort((a, b) => a.note.startTime - b.note.startTime);
    this.notes = scheduled;
    this.lastNoteStart = scheduled.length ? scheduled[scheduled.length - 1].note.startTime : 0;

    this.secPerBeat = 60 / song.bpm;
    this.startBeat = Math.max(0, opts.startBeat ?? 0);
    this.loopStart = opts.loopStart ?? null;
    this.loopEnd = opts.loopEnd ?? null;
    this.startedAtMs = performance.now();
    // First window covers [startBeat - lookahead, startBeat + lookahead).
    this.lastScheduledElapsed = this.startBeat - LOOKAHEAD_MS / 1000 / this.secPerBeat;
    this.timerId = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  private tick(): void {
    if (!this.output) return;
    const elapsedBeats = this.startBeat + (performance.now() - this.startedAtMs) / 1000 / this.secPerBeat;
    const windowEndBeats = elapsedBeats + LOOKAHEAD_MS / 1000 / this.secPerBeat;
    const from = this.lastScheduledElapsed;
    const looping = this.loopStart !== null && this.loopEnd !== null;

    for (const { note, channel } of this.notes) {
      let t = note.startTime;
      if (looping) {
        // Only the loop region's notes play; each occurrence is scheduled
        // as the elapsed clock crosses its beat on every pass.
        if (t < this.loopStart! || t >= this.loopEnd!) continue;
        const span = this.loopEnd! - this.loopStart!;
        if (t < from) t += Math.ceil((from - t) / span) * span;
      } else if (t <= from) {
        continue;
      }
      if (t > from && t <= windowEndBeats) {
        this.send(note, channel, t);
      }
    }
    this.lastScheduledElapsed = windowEndBeats;

    // Nothing left to schedule and the last note-off has already been
    // queued — stop polling, but leave already-sent future messages alone
    // (the browser dispatches them on their own timestamps regardless).
    if (!looping && windowEndBeats >= this.lastNoteStart) this.stopPolling();
  }

  private send(note: MidiNote, channel: number, atBeat: number): void {
    if (!this.output) return; // tick() guards too, but this runs on its own
    const ch = Math.max(0, Math.min(15, channel - 1)); // MIDI wire format is 0-based
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
    const onAtMs = this.startedAtMs + (atBeat - this.startBeat) * this.secPerBeat * 1000;
    const offAtMs = onAtMs + Math.max(0.02, note.duration) * this.secPerBeat * 1000;

    this.output.send([0x90 | ch, pitch, velocity], onAtMs);
    this.output.send([0x80 | ch, pitch, 0], offAtMs);
  }

  private stopPolling(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Silence every channel this session uses — necessary because pending
   *  note-on messages already queued with the browser's MIDI subsystem
   *  (from lookahead) would otherwise still fire after a pause/stop with no
   *  matching note-off. */
  private allNotesOff(): void {
    if (!this.output) return;
    const channels = new Set([this.channelMap.chords, this.channelMap.bass, this.channelMap.drums, this.channelMap.color, this.channelMap.melody]);
    for (const channel of channels) {
      const ch = Math.max(0, Math.min(15, channel - 1));
      this.output.send([0xb0 | ch, ALL_NOTES_OFF_CC, 0]);
    }
  }

  /** Pause — stop scheduling and silence anything sounding. The transport
   *  holds the position; resuming is a fresh `start()` from its paused beat
   *  (see transportControl.playSong). */
  pause(): void {
    this.stopPolling();
    this.allNotesOff();
  }

  /** Stops scheduling new notes and immediately silences every channel this
   *  session used, resetting for a fresh start. */
  stop(): void {
    this.stopPolling();
    this.allNotesOff();
    this.output = null;
    this.notes = [];
    this.startBeat = 0;
    this.loopStart = null;
    this.loopEnd = null;
    this.lastScheduledElapsed = 0;
    this.lastNoteStart = 0;
  }
}

let sharedScheduler: LiveMidiScheduler | null = null;

/** One live-MIDI scheduler per page, same singleton pattern as
 *  `getSongTransport()` — starting playback always means "play this song
 *  now," replacing whatever was scheduled before. */
export function getLiveMidiScheduler(): LiveMidiScheduler {
  if (!sharedScheduler) sharedScheduler = new LiveMidiScheduler();
  return sharedScheduler;
}
