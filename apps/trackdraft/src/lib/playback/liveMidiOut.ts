import { sectionSpans } from "../arrangement";
import { planChordStem, planBassStem, planDrumStem, type MidiNote } from "../midiExport";
import type { BlueprintSong } from "../../types/blueprint";

/** 1-based MIDI channels (1-16, matching how Ableton's UI numbers them) —
 *  one per generated stem, so each Ableton track can listen on its own
 *  channel of the same shared virtual port instead of everything landing
 *  on channel 1. Defaults match drumstudio1.als's actual track order (1
 *  kit, 2 crave, 3 chord, ...), so channel number = track number for the
 *  three tracks TrackDraft drives: `kit` (drums, ch.1), `crave` (bass,
 *  ch.2), `chord` (ch.3 — it already listens to all channels, so this
 *  works with no Ableton-side change; `kit`/`crave` need a one-time "MIDI
 *  From" repoint to this port, filtered to their own channel). */
export interface LiveMidiChannelMap {
  chords: number;
  bass: number;
  drums: number;
}

export const DEFAULT_LIVE_MIDI_CHANNELS: LiveMidiChannelMap = { drums: 1, bass: 2, chords: 3 };

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
class LiveMidiScheduler {
  private output: MIDIOutput | null = null;
  private channelMap: LiveMidiChannelMap = DEFAULT_LIVE_MIDI_CHANNELS;
  private notes: ScheduledNote[] = [];
  private startedAtMs = 0;
  private secPerBeat = 0.5;
  private nextIndex = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  get isRunning(): boolean {
    return this.timerId !== null;
  }

  start(song: BlueprintSong, output: MIDIOutput, channelMap: LiveMidiChannelMap = DEFAULT_LIVE_MIDI_CHANNELS): void {
    this.stop();
    this.output = output;
    this.channelMap = channelMap;

    const spans = sectionSpans(song);
    const scheduled: ScheduledNote[] = [
      ...planChordStem(spans).map((note) => ({ note, channel: channelMap.chords })),
      ...planBassStem(spans).map((note) => ({ note, channel: channelMap.bass })),
      ...planDrumStem(spans, song.concept).map((note) => ({ note, channel: channelMap.drums })),
    ];
    scheduled.sort((a, b) => a.note.startTime - b.note.startTime);
    this.notes = scheduled;

    this.secPerBeat = 60 / song.bpm;
    this.startedAtMs = performance.now();
    this.nextIndex = 0;
    this.timerId = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  private tick(): void {
    if (!this.output) return;
    const elapsedMs = performance.now() - this.startedAtMs;
    const windowEndBeats = (elapsedMs + LOOKAHEAD_MS) / 1000 / this.secPerBeat;

    while (this.nextIndex < this.notes.length && this.notes[this.nextIndex].note.startTime <= windowEndBeats) {
      const { note, channel } = this.notes[this.nextIndex];
      this.nextIndex++;

      const ch = Math.max(0, Math.min(15, channel - 1)); // MIDI wire format is 0-based
      const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
      const onAtMs = this.startedAtMs + note.startTime * this.secPerBeat * 1000;
      const offAtMs = onAtMs + Math.max(0.02, note.duration) * this.secPerBeat * 1000;

      this.output.send([0x90 | ch, pitch, velocity], onAtMs);
      this.output.send([0x80 | ch, pitch, 0], offAtMs);
    }

    // Nothing left to schedule and the last note-off has already been
    // queued — stop polling, but leave already-sent future messages alone
    // (the browser dispatches them on their own timestamps regardless).
    if (this.nextIndex >= this.notes.length) this.stopPolling();
  }

  private stopPolling(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Stops scheduling new notes and immediately silences every channel this
   *  session used — necessary because pending note-on messages already
   *  queued with the browser's MIDI subsystem (from lookahead) would
   *  otherwise still fire after a manual stop with no matching note-off. */
  stop(): void {
    this.stopPolling();
    if (this.output) {
      const channels = new Set([this.channelMap.chords, this.channelMap.bass, this.channelMap.drums]);
      for (const channel of channels) {
        const ch = Math.max(0, Math.min(15, channel - 1));
        this.output.send([0xb0 | ch, ALL_NOTES_OFF_CC, 0]);
      }
    }
    this.output = null;
    this.notes = [];
    this.nextIndex = 0;
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
