import { getPreviewPlayer } from "../harmony/audioPreview";
import { playDrumHits, inferPatternForSection } from "./drumPreview";
import { getSharedAudioContext } from "./audioContext";
import { sectionSpans, type SectionSpan } from "../arrangement";
import { getAbletonClock } from "./abletonClock";
import type { BlueprintSong } from "../../types/blueprint";

/** How far ahead of an event's precise intended time its `setTimeout` is
 *  allowed to fire — submitting to WebAudio a little early means small
 *  JS-timer jitter (a `setTimeout` running a few ms late, a busy tab)
 *  doesn't shift the *audible* result, since the actual start time is the
 *  precise one computed from the shared AudioContext, not "whenever this
 *  callback happened to run." 100ms covers typical GC pauses and React
 *  re-render cycles; firing this much early is itself inaudible. */
const SCHEDULE_LOOKAHEAD_MS = 100;

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

/** Walks a song's full arrangement (`sectionSpans`) and plays every
 *  section's chords *and* drums in sequence, offset by that section's
 *  `startBeat` — the "whole track" version of
 *  `PreviewPlayer.playProgression`, which only ever knew about one
 *  section's chords at a time, with no concept of drums at all. Reuses
 *  `PreviewPlayer.playChordObject`/`playDrumHits` as the actual
 *  sound-triggering primitives (same sampler/DrumMachine, same
 *  performance-effect and pattern/variant resolution as every other
 *  preview in the app) rather than duplicating voice scheduling here —
 *  this class only owns *when*, not *how*, something sounds.
 *
 *  Chords and drums schedule against the *same* shared AudioContext
 *  (`audioContext.ts` — previously each maintained its own, independently
 *  created, with no relationship between their clocks) and against a
 *  single precise time reference (`audioStartTime`, snapshotted once at
 *  `play()`) rather than each event computing its own "now" at whatever
 *  imprecise moment its `setTimeout` happens to fire. Every `setTimeout`
 *  fires `SCHEDULE_LOOKAHEAD_MS` *before* an event's intended time and
 *  hands WebAudio that exact precomputed time, so ordinary JS-timer
 *  jitter doesn't shift the audible result — this is the standard
 *  "schedule ahead, let the audio clock do the precise part" pattern
 *  ("A Tale of Two Clocks"), not a naive "fire and let it land whenever."
 *
 *  The position ticks that drive the playhead/popout read the *same*
 *  shared AudioContext clock too (`ctx.currentTime - audioStartTime`),
 *  not a separate `performance.now()` estimate — so what the UI shows is
 *  the same clock the audio is actually scheduled against, not a
 *  close-but-different approximation of it. Ticks are broadcast on a
 *  `BroadcastChannel` so a same-origin popout window (a separate JS
 *  realm — no shared React/Zustand state) can follow along without a
 *  server round-trip. */
class SongTransport {
  private channel: BroadcastChannel | null = null;
  private schedulerId: ReturnType<typeof requestAnimationFrame> | null = null;
  private chordTimeouts: ReturnType<typeof setTimeout>[] = [];
  private audioStartTime = 0;
  private spans: SectionSpan[] = [];
  private isPlaying = false;
  private tickListeners = new Set<(tick: TransportTick) => void>();
  private abletonUnsub: (() => void) | null = null;
  /** The Ableton beat that counts as "song beat 0" — set by `calibrate()`.
   *  Nothing maps Ableton's raw transport position to "beats into this
   *  song" automatically, so this is a one-click manual anchor: click it
   *  right as the song starts playing in Live. */
  private abletonOffsetBeat = 0;

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

  /** Start playing `song` from the top. Any playback already in progress
   *  (this song or another) is stopped first. */
  play(song: BlueprintSong): void {
    this.stop();
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return;

    const secPerBeat = 60 / song.bpm;
    const lastSpan = this.spans[this.spans.length - 1];
    const totalBeats = lastSpan.startBeat + lastSpan.durationBeats;
    if (totalBeats <= 0) return;

    const ctx = getSharedAudioContext();
    this.audioStartTime = ctx.currentTime;
    this.isPlaying = true;

    // Schedules `fn(preciseAudioTime)` to run `SCHEDULE_LOOKAHEAD_MS`
    // before `beat`'s exact moment, handing it the *precomputed* time
    // (relative to `audioStartTime`, fixed at the top of this method) —
    // not whatever `ctx.currentTime` reads when the timeout callback
    // itself actually runs, which is only ever approximately on-beat.
    const scheduleAt = (beat: number, fn: (preciseTime: number) => void) => {
      const preciseTime = this.audioStartTime + beat * secPerBeat;
      const delayMs = Math.max(0, (preciseTime - ctx.currentTime) * 1000 - SCHEDULE_LOOKAHEAD_MS);
      this.chordTimeouts.push(
        setTimeout(() => {
          if (this.isPlaying) {
            // Clamp to current time: if the JS thread was blocked and this
            // timeout fired late, handing WebAudio a past-tense time would
            // still be audibly late — Math.max gets "now" instead, the
            // earliest time WebAudio can honor.
            fn(Math.max(preciseTime, getSharedAudioContext().currentTime));
          }
        }, delayMs),
      );
    };

    const player = getPreviewPlayer();
    for (const span of this.spans) {
      let cursorBeat = 0;
      for (const chord of span.section.chords) {
        const chordBeats = chord.beats;
        scheduleAt(span.startBeat + cursorBeat, (preciseTime) => {
          player.playChordObject(chord, chordBeats * secPerBeat, preciseTime);
        });
        cursorBeat += chord.beats;
      }

      // Drums for the section, starting when it does — same
      // explicit-override-else-heuristic resolution `drumClips.ts` uses for
      // export (so Studio playback previews what Ableton will actually
      // get), and tiled by `resolveDrumHits` to fill the section's full
      // bar length rather than one loop then silence.
      const pattern = span.section.drumPattern ?? inferPatternForSection(span.section);
      scheduleAt(span.startBeat, (preciseTime) => {
        void playDrumHits(pattern, span.section.drumVariantIndex, span.section, secPerBeat, preciseTime);
      });
    }

    // Playhead position ticks at display refresh rate (60fps) so the
    // visual cursor moves smoothly, not at a choppy 10Hz. The
    // BroadcastChannel still fires at ~60fps too — the popout window
    // handles that rate fine and it looks dramatically better than a
    // jumpy 100ms update.
    const tickLoop = () => {
      if (!this.isPlaying) return;
      const beat = (ctx.currentTime - this.audioStartTime) / secPerBeat;
      if (beat >= totalBeats) {
        this.stop();
        return;
      }
      this.emit({ beat, isPlaying: true, sectionIndex: sectionIndexAt(this.spans, beat) });
      this.schedulerId = requestAnimationFrame(tickLoop);
    };

    this.schedulerId = requestAnimationFrame(tickLoop);
  }

  /** Follow Ableton's transport instead of playing audio here — no chords
   *  are triggered (Ableton is already sounding them); this only turns
   *  Ableton's raw beat position into song-relative ticks on the same
   *  `{ beat, isPlaying, sectionIndex }` shape `play()` emits, so every
   *  consumer (playhead, popout) works identically either way. Connects
   *  `abletonClock` if it isn't already (safe to call repeatedly — it
   *  no-ops once connected). Call `calibrate()` once Ableton is actually
   *  playing the song, to anchor "song beat 0" to wherever Ableton's
   *  transport is at that moment. */
  syncToAbleton(song: BlueprintSong): void {
    this.stop();
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return;

    const clock = getAbletonClock();
    clock.connect();
    this.isPlaying = true;
    this.abletonUnsub = clock.onChange((state) => {
      if (!this.isPlaying) return;
      if (state.abletonBeat === null) {
        this.emit({ beat: 0, isPlaying: state.isPlaying, sectionIndex: -1 });
        return;
      }
      const beat = Math.max(0, state.abletonBeat - this.abletonOffsetBeat);
      this.emit({ beat, isPlaying: state.isPlaying, sectionIndex: sectionIndexAt(this.spans, beat) });
    });
  }

  /** Anchor "song beat 0" to Ableton's current transport position. A
   *  no-op (offset stays 0) if nothing's been received from the bridge
   *  yet — there's nothing meaningful to anchor to. */
  calibrate(): void {
    const beat = getAbletonClock().getState().abletonBeat;
    if (beat !== null) this.abletonOffsetBeat = beat;
  }

  /** Stop playback (self-clock or Ableton-synced) and silence everything
   *  self-clock might have triggered — safe to call whether or not
   *  playback is currently running (unmount/cleanup calls this
   *  unconditionally, same as `PreviewPlayer.stop()`). Deliberately does
   *  *not* disconnect `abletonClock` — that connection is meant to
   *  persist across stop/resync so reconnecting doesn't need a fresh
   *  handshake every time playback toggles. */
  stop(): void {
    if (this.schedulerId !== null) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }
    for (const t of this.chordTimeouts) clearTimeout(t);
    this.chordTimeouts = [];
    if (this.abletonUnsub) {
      this.abletonUnsub();
      this.abletonUnsub = null;
    }

    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (wasPlaying) {
      getPreviewPlayer().stop();
      this.emit({ beat: 0, isPlaying: false, sectionIndex: -1 });
    }
  }

  private emit(tick: TransportTick): void {
    for (const listener of this.tickListeners) listener(tick);
    this.getChannel().postMessage(tick);
  }
}

let sharedTransport: SongTransport | null = null;

/** One transport per page, same reasoning as `getPreviewPlayer()` — Studio
 *  Play always means "play this song," interrupting whatever was already
 *  playing rather than layering on top of it. */
export function getSongTransport(): SongTransport {
  if (!sharedTransport) sharedTransport = new SongTransport();
  return sharedTransport;
}
