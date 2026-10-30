import { sectionSpans } from "../arrangement";
import { planChordStem, planBassStem, planDrumStem, planDrumCcStem, type MidiNote } from "../midiExport";
import { planColorStem } from "../colorStem";
import { planMelodyStem } from "../melody/melodyStem";
import { LIVE_ROUTING, STEM_IDS, clampChannel, type StemId, type StemRoutingMap } from "../stems";
import type { BlueprintSong } from "../../types/blueprint";

/** Per-stem routing for the live MIDI out — the same shape the file export
 *  takes (see `lib/stems.ts`), so one editor can describe both paths. Only
 *  `channel` matters here; `instrumentName`/`gmProgram` are file metadata
 *  and are deliberately not sent as program changes mid-stream (that would
 *  stomp on whatever the user already loaded in their DAW).
 *
 *  Defaults are the Live template's track order, where channel number =
 *  track number: `kit` (drums, ch.1), `crave` (bass, ch.2), `chord` (ch.3 —
 *  it already listens to all channels, so this works with no Ableton-side
 *  change; `kit`/`crave`/`color` need a one-time "MIDI From" repoint to this
 *  port, filtered to their own channel). */
export const DEFAULT_LIVE_MIDI_CHANNELS: StemRoutingMap = LIVE_ROUTING.stems;

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

/** The cached `MIDIAccess`, requested on first use — shared with the
 *  self-test in `midiSelfTest.ts` so both use one permission grant. */
export async function getMidiAccess(): Promise<MIDIAccess> {
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

/** Every MIDI *input* port visible to the browser. Only the self-test uses
 *  these: a virtual bus like IAC appears as both an output and an input, so
 *  writing to the output and reading the input proves the whole OS-level
 *  route works without needing a DAW open. */
export async function listMidiInputs(): Promise<MidiOutputInfo[]> {
  const access = await getMidiAccess();
  return Array.from(access.inputs.values()).map((i) => ({ id: i.id, name: i.name ?? i.id }));
}

/** Resolves a port id (from `listMidiOutputs`) to the live `MIDIOutput`
 *  `LiveMidiScheduler.start` needs — reuses the same cached `MIDIAccess`
 *  `listMidiOutputs` populated, rather than requesting access again. */
export async function getMidiOutput(id: string): Promise<MIDIOutput | null> {
  const access = await getMidiAccess();
  return access.outputs.get(id) ?? null;
}

/**
 * Saved per-stem port ids → live output ports (external hardware).
 *
 * A stem with no override, or whose saved port has disappeared, is simply
 * absent from the map — `LiveMidiScheduler` then sends it to the master port,
 * so unplugging a synth never silences the rest of the arrangement.
 */
export async function resolveStemOutputs(
  overrides: Partial<Record<StemId, string>>,
): Promise<Partial<Record<StemId, MIDIOutput>>> {
  const entries = await Promise.all(
    STEM_IDS.map(async (stem) => {
      const id = overrides[stem];
      if (!id) return null;
      const output = await getMidiOutput(id);
      return output ? ([stem, output] as const) : null;
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [StemId, MIDIOutput] => entry !== null),
  );
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
/** How far *behind* a fresh schedule's position a note may still be caught.
 *  Opening a window exactly at the current position would drop a chord that
 *  started on the downbeat you hit Play on — the beat has already gone by
 *  the time the first tick runs. Notes due within this long still fire
 *  (immediately, a few ms late) instead of being silently skipped. */
const START_CATCH_UP_MS = 60;
const ALL_NOTES_OFF_CC = 123;
/** Backward position dips smaller than this many beats are clock jitter —
 *  e.g. a late beat message re-anchoring a hair behind the interpolation —
 *  not a seek. Treating them as seeks fired all-notes-off plus a full
 *  rebase on every beat under Ableton sync, chopping sustained notes into
 *  per-beat stubs (the "live-sync stutter"). Real seeks — a Live loop
 *  wrap, a jump — move at least a beat and still rebase. */
const SEEK_TOLERANCE_BEATS = 0.5;

interface ScheduledCc {
  beat: number;
  cc: number;
  value: number;
  /** 1-based stem channel. */
  channel: number;
  /** The port this message leaves on — the drums stem may have its own. */
  output: MIDIOutput;
}

interface ScheduledNote {
  note: MidiNote;
  channel: number; // 1-based
  /** The port this note leaves on (per-stem override, else the master). */
  output: MIDIOutput;
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
  /** Loop the same region as the playhead (used when recording a melody
   *  against a section). */
  loopStart?: number;
  loopEnd?: number;
  /** Slave the schedule to an external clock instead of the app's own
   *  free-running one — e.g. Ableton's transport (see `abletonSyncClock`).
   *  Note timestamps then come from `timeAt()`, the scheduling window
   *  tracks `position()`, and a null position (the master stopped, or
   *  hasn't reported one yet) silences everything and waits instead of
   *  guessing. The scheduler owns the clock: `stop()` disposes it. */
  clock?: SchedulerClock;
  /** User-calibrated output latency in ms — positive delays every note.
   *  Without the Live clock re-anchoring on every beat, this is the only
   *  thing standing between "streamed into another DAW" and "audibly late".
   *  Clamped to a sane ±500ms; default 0. */
  outputLatencyMs?: number;
  /** Apply the song's `outputOffsetBeats` render shift to the streamed notes
   *  (see the field's docs). Callers set this for every target except Live —
   *  Live's clock already carries the calibration in `beatOffset`. */
  applyOutputOffset?: boolean;
  /** Per-stem OUTPUT PORTS — external hardware. A stem listed here leaves on
   *  its own interface; every other stem follows the master `output` passed
   *  to `start()`. Resolved by the caller (Web MIDI ids → live ports), so the
   *  scheduler stays free of async port lookups. */
  stemOutputs?: Partial<Record<StemId, MIDIOutput>>;
}

/** Where the scheduler gets its time — the only thing that decides *when* a
 *  note is sent. Two implementations: the app's own wall clock (the
 *  default, used when TrackDraft itself is the transport) and Ableton's
 *  reported transport position (`abletonSyncClock`), which is what makes a
 *  live take streamed into Live land on Live's grid instead of drifting
 *  against it. */
export interface SchedulerClock {
  /** Current song-relative beat, or null when there's no position to report
   *  (the master isn't playing, or hasn't said where it is yet). */
  position(): number | null;
  /** `performance.now()`-domain timestamp at which song beat `beat` occurs,
   *  or null when no timestamp can be derived right now. */
  timeAt(beat: number): number | null;
  /** Release subscriptions/state — called by the scheduler's `stop()`. */
  dispose?(): void;
}

class LiveMidiScheduler {
  private output: MIDIOutput | null = null;
  private routing: StemRoutingMap = DEFAULT_LIVE_MIDI_CHANNELS;
  private notes: ScheduledNote[] = [];
  /** Per-lane controller automation, already flattened to absolute beats. */
  private ccs: ScheduledCc[] = [];
  private clock: SchedulerClock | null = null;
  /** True when `clock` is external (Ableton) — the master owns the window,
   *  its loop, and when the schedule ends. */
  private synced = false;
  /** Set while the master reports no position (stopped) — see `hold()`. */
  private held = false;
  private secPerBeat = 0.5;
  /** Calibrated output latency in ms (see `outputLatencyMs`). */
  private latencyMs = 0;
  private startBeat = 0;
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  /** End of the already-scheduled window; null = rebase on the next tick. */
  private lastScheduledElapsed: number | null = null;
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
    output: MIDIOutput | null,
    routing: StemRoutingMap = DEFAULT_LIVE_MIDI_CHANNELS,
    opts: LiveSchedulerOptions = {},
  ): void {
    // A re-plan can hand back the very clock it's already running on (see
    // `activeClock`) — that clock must survive the teardown, or the re-plan
    // would dispose the subscription it's about to keep following.
    this.teardown(opts.clock ?? null);
    this.output = output;
    this.routing = routing;

    const spans = sectionSpans(song);
    // Rendered output shifts by `outputOffsetBeats` (see the blueprint
    // field): some catalog songs' grid sits a beat off the reference
    // recording, and the notes move to lock with the record. The file export
    // has always applied that shift. When the target isn't Live, the stream
    // applies it too — otherwise exporting and streaming the same song
    // disagree by a beat with nothing on screen to explain why. Under the
    // Live clock the shift would fight `beatOffset`'s calibration, so it's
    // opt-in per start (see `LiveSchedulerOptions.applyOutputOffset`).
    //
    // Clamped at 0 exactly like the export, so a note shifted before the top
    // plays on the downbeat rather than being dropped by `windowedStart`.
    const outputOffset = opts.applyOutputOffset ? (song.outputOffsetBeats ?? 0) : 0;
    const stem = (notes: MidiNote[], id: StemId): ScheduledNote[] => {
      // The hardware split: a stem with its own port leaves there, the rest
      // follow the master. No master and no override means that stem is
      // simply silent — a hardware-only rig can leave the master Off.
      const target = opts.stemOutputs?.[id] ?? output;
      if (!target) return [];
      return notes.map((note) => ({
        note: outputOffset === 0 ? note : { ...note, startTime: Math.max(0, note.startTime + outputOffset) },
        channel: clampChannel(routing[id].channel),
        output: target,
      }));
    };
    const scheduled: ScheduledNote[] = [
      ...stem(planChordStem(spans, song), "chords"),
      ...stem(planBassStem(spans, song), "bass"),
      ...stem(planDrumStem(spans, song), "drums"),
      ...stem(planColorStem(spans, song), "color"),
      ...stem(planMelodyStem(spans, song), "melody"),
    ];
    scheduled.sort((a, b) => a.note.startTime - b.note.startTime);
    this.notes = scheduled;
    // Per-lane CC — same beat frame as the notes (output offset included), on
    // the drums channel. Built by the shared `planDrumCcStem`, so the .mid and
    // this stream send identical messages.
    const drumsChannel = clampChannel(routing.drums.channel);
    const drumsOutput = opts.stemOutputs?.drums ?? output;
    this.ccs = drumsOutput
      ? planDrumCcStem(spans, song).map((c) => ({
          beat: outputOffset === 0 ? c.beat : Math.max(0, c.beat + outputOffset),
          cc: c.cc,
          value: c.value,
          channel: drumsChannel,
          output: drumsOutput,
        }))
      : [];
    this.lastNoteStart = scheduled.length ? scheduled[scheduled.length - 1].note.startTime : 0;

    this.secPerBeat = 60 / song.bpm;
    this.latencyMs = Math.max(-500, Math.min(500, Math.round(opts.outputLatencyMs ?? 0)));
    this.startBeat = Math.max(0, opts.startBeat ?? 0);
    this.loopStart = opts.loopStart ?? null;
    this.loopEnd = opts.loopEnd ?? null;
    this.synced = opts.clock !== undefined;
    this.held = false;
    this.clock = opts.clock ?? this.internalClock();
    // The window is opened from the first *real* position rather than
    // assumed up front: under an external clock there may not be a position
    // yet (the master can still be stopped), and guessing one would fire a
    // burst of catch-up notes the moment it starts.
    this.lastScheduledElapsed = null;
    this.timerId = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  /** The app's own clock — song beat `startBeat` is "now", advancing at the
   *  song's bpm in real time. The default, and the previous behavior. */
  private internalClock(): SchedulerClock {
    const startedAtMs = performance.now();
    const { startBeat, secPerBeat } = this;
    return {
      position: () => startBeat + (performance.now() - startedAtMs) / 1000 / secPerBeat,
      timeAt: (beat) => startedAtMs + (beat - startBeat) * secPerBeat * 1000,
    };
  }

  /** The *external* clock this schedule is slaved to, if any — a staged
   *  live re-plan passes it back in so the re-plan keeps following the same
   *  master instead of silently dropping back to the app's own clock. Null
   *  when the app's own clock is driving: re-basing that one at the new
   *  start beat is what a re-plan has always done, and it must not be
   *  mistaken for an external clock. */
  get activeClock(): SchedulerClock | null {
    return this.synced ? this.clock : null;
  }

  private tick(): void {
    if (!this.clock) return;
    const pos = this.clock.position();
    if (pos === null) {
      // The master stopped (or hasn't reported a position yet) — hold
      // everything and wait rather than guessing where it is.
      this.hold();
      return;
    }
    this.held = false;

    const lookaheadBeats = LOOKAHEAD_MS / 1000 / this.secPerBeat;
    const windowEndBeats = pos + lookaheadBeats;
    let from = this.lastScheduledElapsed;
    // A sub-beat backward dip is clock jitter — a late beat message
    // re-anchoring behind the interpolation — not a seek: everything up to
    // `from` is already queued and fires on its own timestamps, so just
    // wait for the clock to catch back up (milliseconds). Silencing here
    // was the every-beat all-notes-off stutter under Ableton sync.
    if (from !== null && windowEndBeats < from && from - windowEndBeats < SEEK_TOLERANCE_BEATS) {
      return;
    }
    if (from === null || windowEndBeats < from) {
      // First tick, or the master genuinely jumped backwards past what we
      // already queued (a seek, or a loop wrap in Live): rebase the window.
      const seeking = from !== null;
      // Anything the abandoned window queued is silenced first — those
      // messages can't be unsent, and firing them late sounds worse than
      // not firing them at all.
      if (seeking) this.allNotesOff();
      // After a seek, start from the new position (notes from before it
      // don't belong). Opening a *schedule* reaches back a little further,
      // so a chord sitting on the very beat we started on still sounds.
      const reach = this.synced ? START_CATCH_UP_MS / 1000 / this.secPerBeat : lookaheadBeats;
      from = seeking ? pos : pos - reach;
    }

    for (const scheduled of this.notes) {
      const at = this.windowedStart(scheduled.note.startTime, from, windowEndBeats);
      if (at !== null) this.send(scheduled, at);
    }
    for (const c of this.ccs) {
      const at = this.windowedStart(c.beat, from, windowEndBeats);
      if (at !== null) this.sendCc(c, at);
    }
    this.lastScheduledElapsed = windowEndBeats;

    // Nothing left to schedule and the last note-off has already been
    // queued — stop polling, but leave already-sent future messages alone
    // (the browser dispatches them on their own timestamps regardless).
    // A synced schedule never stops itself: the master owns when it ends.
    if (!this.synced && !this.isLooping && windowEndBeats >= this.lastNoteStart) this.stopPolling();
  }

  /** Silence and wait for the master. Dropping the window is the point: the
   *  next position we see opens a fresh one, so a gap while the transport
   *  was stopped can't fire a catch-up burst. */
  private hold(): void {
    if (this.held) return;
    this.allNotesOff();
    this.held = true;
    this.lastScheduledElapsed = null;
  }

  /** The beat a note should sound at, when it falls inside the scheduling
   *  window `(from, windowEnd]` — null when it doesn't. A self-clocked loop
   *  region also *folds* the beat forward, so one note recurs on every
   *  pass; a synced clock needs none of that, because the master's own
   *  position rewinds and this window simply follows it. */
  private windowedStart(beat: number, from: number, windowEnd: number): number | null {
    const { loopStart, loopEnd } = this;
    if (loopStart !== null && loopEnd !== null) {
      if (beat < loopStart || beat >= loopEnd) return null;
      if (!this.synced && beat <= from) {
        const span = loopEnd - loopStart;
        beat += Math.ceil((from - beat) / span) * span;
      }
    }
    return beat > from && beat <= windowEnd ? beat : null;
  }

  private send(scheduled: ScheduledNote, atBeat: number): void {
    const { note, channel, output } = scheduled;
    if (!output || !this.clock) return; // tick() guards too, but this runs on its own
    const scheduledAtMs = this.clock.timeAt(atBeat);
    if (scheduledAtMs === null) return;
    // Calibrated latency shifts both ends together, so note lengths are
    // untouched — only when the whole stream lands.
    const onAtMs = scheduledAtMs + this.latencyMs;
    const ch = Math.max(0, Math.min(15, channel - 1)); // MIDI wire format is 0-based
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
    const offAtMs = onAtMs + Math.max(0.02, note.duration) * this.secPerBeat * 1000;

    output.send([0x90 | ch, pitch, velocity], onAtMs);
    output.send([0x80 | ch, pitch, 0], offAtMs);
  }

  private sendCc(c: ScheduledCc, atBeat: number): void {
    if (!c.output || !this.clock) return;
    const at = this.clock.timeAt(atBeat);
    if (at === null) return;
    const ch = Math.max(0, Math.min(15, c.channel - 1));
    c.output.send(
      [0xb0 | ch, Math.max(0, Math.min(127, Math.round(c.cc))), Math.max(0, Math.min(127, Math.round(c.value)))],
      at + this.latencyMs,
    );
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
    const channels = new Set([
      this.routing.chords.channel,
      this.routing.bass.channel,
      this.routing.drums.channel,
      this.routing.color.channel,
      this.routing.melody.channel,
    ]);
    // Every port this session actually wrote to — silencing only the master
    // would leave a hardware synth holding a note after Stop.
    const outputs = new Set<MIDIOutput>();
    if (this.output) outputs.add(this.output);
    for (const n of this.notes) outputs.add(n.output);
    for (const c of this.ccs) outputs.add(c.output);
    for (const out of outputs) {
      for (const channel of channels) {
        const ch = Math.max(0, Math.min(15, channel - 1));
        out.send([0xb0 | ch, ALL_NOTES_OFF_CC, 0]);
      }
    }
  }

  /** Pause — stop scheduling and silence anything sounding. The transport
   *  holds the position; resuming is a fresh `start()` from its paused beat
   *  (see transportControl.playSong). The clock goes with it: a resumed
   *  schedule is a new one, and an external clock's subscription shouldn't
   *  outlive the schedule using it. */
  pause(): void {
    this.stopPolling();
    this.allNotesOff();
    this.clock?.dispose?.();
    this.clock = null;
  }

  /** Stops scheduling new notes and immediately silences every channel this
   *  session used, resetting for a fresh start. */
  stop(): void {
    this.teardown(null);
  }

  /** Reset everything for a fresh schedule. `preserveClock` is exempt from
   *  disposal — `start()` passes the clock it's about to reuse (see
   *  `activeClock`), `stop()` passes null to dispose everything. */
  private teardown(preserveClock: SchedulerClock | null): void {
    this.stopPolling();
    this.allNotesOff();
    if (this.clock && this.clock !== preserveClock) this.clock.dispose?.();
    this.clock = null;
    this.synced = false;
    this.held = false;
    this.output = null;
    this.notes = [];
    this.ccs = [];
    this.startBeat = 0;
    this.loopStart = null;
    this.loopEnd = null;
    this.lastScheduledElapsed = null;
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
