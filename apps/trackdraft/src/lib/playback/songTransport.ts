import { sectionSpans, type SectionSpan } from "../arrangement";
import { getAbletonClock } from "./abletonClock";
import { beatsPerBar } from "../../types/blueprint";
import type { BlueprintSong } from "../../types/blueprint";

/** A song-wide playback position, emitted on every tick while playing and
 *  once more (isPlaying: false) when play stops or reaches the end. */
export interface TransportTick {
  beat: number;
  isPlaying: boolean;
  /** Index into the `SectionSpan[]` that was current when the tick fired,
   *  or -1 when stopped/before the first span. Consumers that already have
   *  their own `sectionSpans(song)` (e.g. ArrangementTimeline) can index
   *  straight into it rather than re-deriving which span this is. */
  sectionIndex: number;
}

/** Playback position/loop for `SongTransport.play()` — lets a caller start
 *  at a specific beat (seek, e.g. to a section) and/or loop within a region
 *  (e.g. loop just the section being recorded). All optional: omitting
 *  everything is exactly the historical play-from-the-top-once. */
export interface PlayOptions {
  /** Beat to start playback at. Default 0 (song start). */
  startBeat?: number;
  /** When both `loopStart`/`loopEnd` are set and `loopEnd` is inside the
   *  song, playback wraps from `loopEnd` back to `loopStart` forever
   *  instead of stopping at the end of the song. */
  loopStart?: number;
  loopEnd?: number;
  /** Loop even when the region reaches the song end (a section that spans
   *  the whole song) — used by the section-loop button, where "loop this
   *  part until I turn it off" means exactly that, forever. */
  forceLoop?: boolean;
}

/** Shared by any cross-window consumer (currently just the lyric/chord
 *  popout) that needs to subscribe without going through `getSongTransport()`
 *  itself — a popout window is a separate page load with its own JS realm,
 *  so it can't hold a reference to this module's singleton. */
export const TRANSPORT_CHANNEL_NAME = "trackdraft-transport";

/** Which span (if any) contains `beat` — linear scan is fine here; a song's
 *  span count is small (tens, not thousands) and this only runs on a 100ms
 *  tick, not per frame. */
function sectionIndexAt(spans: SectionSpan[], beat: number): number {
  return spans.findIndex((s) => beat >= s.startBeat && beat < s.startBeat + s.durationBeats);
}

/** Walks a song's full arrangement (`sectionSpans`) and advances a
 *  song-relative beat position at display refresh rate — a silent
 *  playhead for reviewing arrangement/timing while editing. TrackDraft
 *  itself no longer makes sound (see `syncToAbleton` below and the
 *  project's MIDI-only direction): actual audio always comes from
 *  Ableton once a song's chords/drums are committed there, so this
 *  clock's only job is *position*, not *sound*.
 *
 *  Ticks are broadcast on a `BroadcastChannel` so a same-origin popout
 *  window (a separate JS realm — no shared React/Zustand state) can
 *  follow along without a server round-trip. */
class SongTransport {
  private channel: BroadcastChannel | null = null;
  private schedulerId: ReturnType<typeof requestAnimationFrame> | null = null;
  private startedAtMs = 0;
  private spans: SectionSpan[] = [];
  private isPlaying = false;
  /** Seconds per beat of the loaded song (for pause's beat math). */
  private secPerBeat = 0.5;
  /** Song length in beats of the current playback pass (end-of-song stop). */
  private totalBeats = 0;
  /** Loop region of the current playback pass (no loop when 0/0). */
  private loopStart = 0;
  private loopEnd = 0;
  private looping = false;
  /** Beat to resume from after pause — null when stopped (play from top). */
  private pausedBeat: number | null = null;
  /** A one-shot callback queued to run at the next bar boundary (live edits
   *  apply on the grid, not mid-note). Cleared on pause/stop/play. */
  private nextBarCb: (() => void) | null = null;
  private nextBarAt = -1;
  private tickListeners = new Set<(tick: TransportTick) => void>();
  private abletonUnsub: (() => void) | null = null;
  /** Which clock is driving — set by StudioView from the persisted store
   *  before calling play()/syncToAbleton(). */
  clockSource: "internal" | "ableton" = "internal";

  private getChannel(): BroadcastChannel {
    if (!this.channel) this.channel = new BroadcastChannel(TRANSPORT_CHANNEL_NAME);
    return this.channel;
  }

  /** Subscribe to ticks from within the same tab (e.g. the Studio playhead
   *  or a Play/Stop button's state) — lower-latency than round-tripping
   *  through the BroadcastChannel, which every tick also still posts to
   *  for any popout window listening. Returns an unsubscribe function. */
  onTick(listener: (tick: TransportTick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /** Start a silent playhead scrub through `song` — no audio, see the class
   *  doc. Any playback already in progress (this song or another) is
   *  stopped first. If `clockSource` is "ableton" this is a no-op —
   *  Ableton sync must use syncToAbleton(). An explicit `opts.startBeat`
   *  seeks; without one, a paused beat is resumed (see `pause()`). */
  play(song: BlueprintSong, opts: PlayOptions = {}): void {
    if (this.clockSource === "ableton") return;
    // Capture the resume position BEFORE stop() (which clears it): an
    // explicit startBeat wins, otherwise a paused beat resumes.
    const resumeBeat = opts.startBeat !== undefined ? Math.max(0, opts.startBeat) : (this.pausedBeat ?? 0);
    this.stop();
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return;

    this.secPerBeat = 60 / song.bpm;
    const lastSpan = this.spans[this.spans.length - 1];
    this.totalBeats = lastSpan.startBeat + lastSpan.durationBeats;
    if (this.totalBeats <= 0) return;

    const startBeat = resumeBeat;
    this.loopStart = opts.loopStart ?? startBeat;
    this.loopEnd = opts.loopEnd ?? this.totalBeats;
    const hasRegion = this.loopEnd > this.loopStart;
    this.looping = hasRegion && (opts.forceLoop === true || this.loopEnd < this.totalBeats);

    // Seek: anchor the wall clock so beat `startBeat` is "now".
    this.startedAtMs = performance.now() - startBeat * this.secPerBeat * 1000;
    this.isPlaying = true;

    // Playhead position ticks at display refresh rate (60fps) so the
    // visual cursor moves smoothly, not at a choppy 10Hz. The
    // BroadcastChannel still fires at ~60fps too — the popout window
    // handles that rate fine.
    const tickLoop = () => {
      if (!this.isPlaying) return;
      const beat = this.currentBeat();
      // Fire a bar-queued callback (e.g. a staged live edit) at its boundary
      // before the end-of-song check, so it still runs right at the finish.
      if (this.nextBarCb !== null && beat >= this.nextBarAt) {
        const cb = this.nextBarCb;
        this.nextBarCb = null;
        cb();
      }
      if (beat >= this.totalBeats) {
        this.stop();
        return;
      }
      this.emit({ beat, isPlaying: true, sectionIndex: sectionIndexAt(this.spans, beat) });
      this.schedulerId = requestAnimationFrame(tickLoop);
    };

    this.schedulerId = requestAnimationFrame(tickLoop);
  }

  /** The playhead beat right now — the same folded value the tick loop
   *  emits (a looped playback folds back into its loop region). */
  private currentBeat(): number {
    let beat = (performance.now() - this.startedAtMs) / 1000 / this.secPerBeat;
    if (this.looping && beat >= this.loopEnd) {
      const span = this.loopEnd - this.loopStart;
      beat = this.loopStart + ((beat - this.loopStart) % span);
    }
    return beat;
  }

  /** Freeze the playhead at its current beat — `play()` without an explicit
   *  `startBeat` will resume from here. No-op when not playing, or when
   *  following Ableton's clock (we can't pause the external transport). */
  pause(): void {
    if (!this.isPlaying || this.clockSource === "ableton") return;
    const beat = this.currentBeat();
    this.pausedBeat = beat;
    this.nextBarCb = null;
    if (this.schedulerId !== null) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }
    this.isPlaying = false;
    this.emit({ beat, isPlaying: false, sectionIndex: sectionIndexAt(this.spans, beat) });
  }

  /** Whether playback is paused — `play()` will resume from the held beat
   *  rather than the top. */
  isPaused(): boolean {
    return this.pausedBeat !== null;
  }

  /** The playhead beat right now — folded for loops. Only meaningful while
   *  playing (used by the live MIDI scheduler to re-plan from the current
   *  position after an edit); returns the paused beat when paused, else 0. */
  getBeat(): number {
    if (this.isPlaying) return this.currentBeat();
    return this.pausedBeat ?? 0;
  }

  /** The beat of the next bar boundary after the current playhead — where
   *  a live edit should land so the change hits the grid instead of mid-
   *  note. Uses the current section's beats-per-bar; never returns a beat
   *  past the song end (or the loop region's end when looping). */
  getNextBarBeat(): number {
    let beat = this.currentBeat();
    const span = this.spans[sectionIndexAt(this.spans, beat)];
    let next = this.totalBeats;
    if (span) {
      const bpb = Math.max(1, beatsPerBar(span.section));
      next = span.startBeat + (Math.floor((beat - span.startBeat) / bpb) + 1) * bpb;
    }
    if (this.looping) next = Math.min(next, this.loopEnd - 0.001);
    next = Math.min(next, this.totalBeats - 0.001);
    return Math.max(beat + 0.001, next);
  }

  /** Queue `cb` to run at the start of the next bar after the current
   *  playhead — the "apply on the grid" point for live edits. A second
   *  call replaces the first (coalescing edits within a bar). Cleared by
   *  pause()/stop()/play(). */
  onNextBar(cb: () => void): void {
    this.nextBarCb = cb;
    this.nextBarAt = this.getNextBarBeat();
  }

  /** The beat playback will resume from, or null when not paused. */
  getPausedBeat(): number | null {
    return this.pausedBeat;
  }

  /** Follow Ableton's transport instead of playing audio here — no chords
   *  are triggered (Ableton is already sounding them); this only turns
   *  Ableton's raw beat position into song-relative ticks on the same
   *  `{ beat, isPlaying, sectionIndex }` shape `play()` emits, so every
   *  consumer (playhead, popout) works identically either way. Connects
   *  `abletonClock` if it isn't already (safe to call repeatedly — it
   *  no-ops once connected). The offset comes from `song.beatOffset ?? 0`
   *  so it survives page refreshes. Call `calibrate()` to anchor it.
   *
   *  `osc-bridge` only pushes a message once per *whole* beat — there is
   *  no fractional/sub-beat position in the wire protocol (confirmed: its
   *  own `apc-sequencer` client has the same gap, flagged there as
   *  "full phase-lock needs osc-bridge songTime"). Emitting only on each
   *  real message made this mode's playhead visibly step once per beat
   *  instead of moving continuously — jarring next to `play()`'s smooth
   *  60fps internal clock, and the likely source of "the timing feels
   *  buggy" reports specifically when following real Ableton playback.
   *  Fixed the same way any networked-clock UI handles a sparse position
   *  feed: keep emitting exactly on every real update (so the position is
   *  always eventually correct, never just guessed), and *additionally*
   *  extrapolate a smooth estimate on every animation frame in between,
   *  using the song's own bpm as the assumed rate — reasonable since
   *  Ableton's tempo is normally driven *from* this song's bpm via the
   *  blueprint push path, and safely self-correcting either way: each
   *  real beat message resets the estimate's anchor, so any drift from a
   *  slightly-off bpm assumption never accumulates past one beat. */
  syncToAbleton(song: BlueprintSong): void {
    this.stop();
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return;

    const offset = song.beatOffset ?? 0;
    const secPerBeat = 60 / song.bpm;
    const clock = getAbletonClock();
    clock.connect();
    this.isPlaying = true;

    // Interpolation anchor: the last real beat message and the wall-clock
    // moment it arrived. `reallyPlaying` gates the animation loop so a
    // paused transport doesn't keep extrapolating forward from a stale beat.
    let lastBeat: number | null = null;
    let lastBeatAtMs = 0;
    let reallyPlaying = false;

    const tickLoop = () => {
      if (!this.isPlaying) return;
      if (reallyPlaying && lastBeat !== null) {
        const estimatedAbletonBeat = lastBeat + (performance.now() - lastBeatAtMs) / (secPerBeat * 1000);
        const beat = Math.max(0, estimatedAbletonBeat - offset);
        this.emit({ beat, isPlaying: true, sectionIndex: sectionIndexAt(this.spans, beat) });
      }
      this.schedulerId = requestAnimationFrame(tickLoop);
    };

    this.abletonUnsub = clock.onChange((state) => {
      if (!this.isPlaying) return;
      reallyPlaying = state.isPlaying;
      if (state.abletonBeat === null) {
        lastBeat = null;
        this.emit({ beat: 0, isPlaying: state.isPlaying, sectionIndex: -1 });
        return;
      }
      lastBeat = state.abletonBeat;
      lastBeatAtMs = performance.now();
      const beat = Math.max(0, state.abletonBeat - offset);
      this.emit({ beat, isPlaying: state.isPlaying, sectionIndex: sectionIndexAt(this.spans, beat) });
    });

    this.schedulerId = requestAnimationFrame(tickLoop);
  }

  /** Anchor "song beat 0" to Ableton's current transport position. Returns
   *  the new offset (Ableton beat) so StudioView can persist it to the
   *  song. A no-op returning null if nothing's been received from the
   *  bridge yet — there's nothing meaningful to anchor to. */
  calibrate(): number | null {
    const beat = getAbletonClock().getState().abletonBeat;
    return beat;
  }

  /** Stop playback (self-clock or Ableton-synced) — safe to call whether
   *  or not playback is currently running (unmount/cleanup calls this
   *  unconditionally). Resets the playhead to the top: any paused position
   *  is cleared, so the next `play()` starts from the beginning.
   *  Deliberately does *not* disconnect `abletonClock` — that connection
   *  is meant to persist across stop/resync so reconnecting doesn't need a
   *  fresh handshake every time playback toggles. */
  stop(): void {
    this.pausedBeat = null;
    this.nextBarCb = null;
    if (this.schedulerId !== null) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }
    if (this.abletonUnsub) {
      this.abletonUnsub();
      this.abletonUnsub = null;
    }

    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (wasPlaying) {
      this.emit({ beat: 0, isPlaying: false, sectionIndex: -1 });
    }
  }

  private emit(tick: TransportTick): void {
    for (const listener of this.tickListeners) listener(tick);
    this.getChannel().postMessage(tick);
  }
}

let sharedTransport: SongTransport | null = null;

/** One transport per page — Studio Play always means "play this song,"
 *  interrupting whatever was already playing rather than layering on
 *  top of it. */
export function getSongTransport(): SongTransport {
  if (!sharedTransport) sharedTransport = new SongTransport();
  return sharedTransport;
}
