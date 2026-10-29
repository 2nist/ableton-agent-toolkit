/**
 * Shared transport control — the one implementation of "play this song /
 * stop" that both Studio's Play button and the header's global Play use, so
 * the two can never drift. Handles the clock source (internal playhead +
 * live MIDI out vs. following Ableton's transport over osc-bridge) and the
 * opted-in live MIDI scheduler.
 */

import { getSongTransport } from "./songTransport";
import { createAbletonSyncClock } from "./abletonSyncClock";
import { getAbletonClock } from "./abletonClock";
import {
  getLiveMidiScheduler,
  getMidiOutput,
  type LiveSchedulerOptions,
  type SchedulerClock,
} from "./liveMidiOut";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import {
  targetStreamsMidi,
  targetUsesAppClock,
  useDawTargetStore,
  type DawTarget,
} from "../../store/dawTargetStore";
import { sectionSpans } from "../arrangement";
import type { StemRoutingMap } from "../stems";
import type { BlueprintSong } from "../../types/blueprint";

/** Scheduler options every start needs from the current settings and the
 *  active target: the calibrated output latency, and whether the song's
 *  render offset applies (everything but Live — Live's clock carries its own
 *  calibration in `beatOffset`). */
function streamOptions(target: DawTarget, extra: LiveSchedulerOptions = {}): LiveSchedulerOptions {
  const { latencyMs } = useMidiSettingsStore.getState();
  return { ...extra, outputLatencyMs: latencyMs, applyOutputOffset: targetUsesAppClock(target) };
}

/** Bring Live's timeline to the song's tempo before streaming into it.
 *
 *  The app's own clock places notes by the song's bpm, so if Live is sitting
 *  at some other tempo every part lands on a different beat each pass — a
 *  104bpm song against a 143bpm set reads as the clock being off and
 *  stuttering, even though neither side is drifting. The Live target
 *  deliberately doesn't do this: there Live is the master and the clock
 *  follows it instead (see `abletonSyncClock`). No-op when the bridge isn't
 *  connected — there's nothing to set, and this must not wake a socket up. */
function alignLiveTempo(song: BlueprintSong): void {
  const clock = getAbletonClock();
  if (!clock.getState().connected) return;
  clock.sendCommand("/live/song/set/tempo", [song.bpm]);
}

/**
 * Start (or resume) playback for a song, into whatever the current target is.
 * - Live: follow Live's transport via osc-bridge, and stream the song's parts
 *   into it on that same clock. Live is the master here — the notes carry
 *   Live's position, so a take lands on Live's grid instead of drifting
 *   against it (see `abletonSyncClock`).
 * - Other DAW: the app's own clock plus live MIDI out (when a port is
 *   selected and reachable), with Live's tempo matched to the song's first so
 *   the stream lands on Live's grid. If the transport is paused, resumes from
 *   the paused beat; otherwise plays from the top.
 * - File only: the app's own clock and nothing on the wire.
 *
 * Returns true when playback started (or needs no MIDI port); false when a
 * selected port was stale and playback was rolled back — the caller can
 * surface that (e.g. alert) rather than fail silently.
 */
export async function playSong(song: BlueprintSong, target: DawTarget): Promise<boolean> {
  const transport = getSongTransport();
  transport.clockSource = targetUsesAppClock(target) ? "internal" : "ableton";
  clearStagedRefresh();

  if (target === "live") {
    transport.syncToAbleton(song);
    // Follow-only when no port is selected (the previous behavior).
    const { midiOutputId, routing } = useMidiSettingsStore.getState();
    if (!midiOutputId) return true;
    const output = await getMidiOutput(midiOutputId);
    // A stale port still leaves the playhead following Live, which is
    // useful on its own — but the streaming the user asked for isn't
    // happening, so say so rather than pretend it started.
    if (!output) return false;
    getLiveMidiScheduler().start(song, output, routing, streamOptions(target, { clock: createAbletonSyncClock(song) }));
    return true;
  }

  // Grab the paused beat BEFORE play() consumes it, so the live MIDI
  // scheduler can resume from the same place as the playhead.
  const resumeBeat = transport.isPaused() ? transport.getPausedBeat() : null;
  transport.play(song); // resumes from resumeBeat when set
  if (!targetStreamsMidi(target)) return true; // File only — silent playhead
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return true; // no port → silent playhead, as before
  const output = await getMidiOutput(midiOutputId);
  if (!output) {
    // The saved port id is stale (Web MIDI ids change between browser
    // restarts) — don't leave a silent playhead running while the user
    // thinks it's about to sound.
    transport.stop();
    return false;
  }
  alignLiveTempo(song);
  getLiveMidiScheduler().start(
    song,
    output,
    routing,
    streamOptions(target, resumeBeat != null ? { startBeat: resumeBeat } : {}),
  );
  return true;
}

/**
 * Seek — jump the internal clock's playback position to `beat`: playing
 * continues from there; paused/stopped starts from there (a ruler click is
 * an audition gesture). No-op under the Live target — Live is the master,
 * seek it there. The live MIDI scheduler re-starts from the same beat when
 * a port is available (silent playhead if the port is stale — the seek
 * itself still lands).
 */
export async function seekTo(song: BlueprintSong, target: DawTarget, beat: number): Promise<void> {
  if (target === "live") return;
  const transport = getSongTransport();
  clearStagedRefresh();
  const to = Math.max(0, beat);
  transport.play(song, { startBeat: to });
  if (!targetStreamsMidi(target)) return;
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;
  getLiveMidiScheduler().start(song, output, routing, streamOptions(target, { startBeat: to }));
}

/** Pause playback — freeze the playhead (and silence the live MIDI out);
 *  `playSong` will resume from the held beat. */
export function pauseSong(): void {
  clearStagedRefresh();
  getSongTransport().pause();
  getLiveMidiScheduler().pause();
}

/** Stop playback — the transport and any live MIDI scheduling; resets to
 *  the top (a paused position is cleared). */
export function stopSong(): void {
  clearStagedRefresh();
  getSongTransport().stop();
  getLiveMidiScheduler().stop();
}

/**
 * Re-plan the live MIDI scheduler at the NEXT BAR BOUNDARY, so edits made
 * while playing land cleanly on the grid instead of cutting a note mid-
 * phrase — drums/harmony/melody changes are heard on the next bar (drums
 * via their live draft, even before Apply). Multiple edits within a bar
 * coalesce into a single re-plan; the transport's current loop region is
 * preserved. No-op when not playing, no MIDI port, or the scheduler isn't
 * running.
 */

/** One live-edit re-plan staged for the next bar — a single slot, so edits
 *  inside a bar fold together and the latest song wins when it fires. */
let stagedRefresh: {
  atBeat: number;
  song: BlueprintSong;
  output: MIDIOutput;
  routing: StemRoutingMap;
  target: DawTarget;
  loop: { start: number; end: number } | null;
  /** The external clock the re-plan must keep following (Live), or null when
   *  the app's own clock is driving (the re-plan then re-bases it at
   *  `atBeat`, as it always did). */
  clock: SchedulerClock | null;
} | null = null;

/** Drop any pending staged re-plan — and the transport callback that would
 *  fire it. Playback restarts (play/loop/stop/pause) must leave no orphan
 *  behind: a later `liveRefresh` must not fold into a dead slot (it would
 *  return without re-registering, silently swallowing the edit), a newly
 *  engaged section loop must not be clobbered by an old one, and an
 *  abandoned callback must not re-start the scheduler from a cancelled
 *  stage. `cancelNextBar` is the half that used to be left implicit. */
function clearStagedRefresh(): void {
  stagedRefresh = null;
  getSongTransport().cancelNextBar();
}

export async function liveRefresh(song: BlueprintSong): Promise<void> {
  const transport = getSongTransport();
  const scheduler = getLiveMidiScheduler();
  if (!transport.getIsPlaying() || !scheduler.isRunning) return;
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) return;
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;

  // A re-plan is already queued for this bar — fold the edit into it and
  // let the latest song apply when the boundary arrives. This mutates the
  // SAME stage object the queued callback captured (identity, not a copy),
  // so the fold is what fires; a cancelled stage is nulled instead, which
  // the callback detects.
  if (stagedRefresh) {
    stagedRefresh.song = song;
    return;
  }

  const atBeat = transport.getNextBarBeat();
  // The callback captures THIS stage by identity. Resolving through the
  // module slot instead let a callback whose stage had already been
  // replaced or cancelled apply whatever happened to be in the slot when
  // the bar boundary arrived — a re-plan for an edit the user had undone.
  const stage = { atBeat, song, output, routing, target, loop: scheduler.loopRegion, clock: scheduler.activeClock };
  stagedRefresh = stage;
  transport.onNextBar(() => {
    if (stagedRefresh !== stage) return;
    stagedRefresh = null;
    const s = stage;
    // The target may have changed mid-bar (e.g. switched to File only).
    if (!targetStreamsMidi(s.target)) return;
    const opts = streamOptions(s.target, { startBeat: s.atBeat });
    if (s.loop) {
      opts.loopStart = s.loop.start;
      opts.loopEnd = s.loop.end;
    }
    if (s.clock) opts.clock = s.clock;
    scheduler.start(withDrumDraft(s.song), s.output, s.routing, opts);
  });
}

/**
 * Loop just `sectionId` of `song` — seek to its start and wrap that span
 * forever until `resumeUnlooped`/Stop. Internal clock only (Ableton owns
 * its own transport). Returns false if no section matched.
 */
export async function playSectionLoop(song: BlueprintSong, sectionId: string): Promise<boolean> {
  const transport = getSongTransport();
  transport.clockSource = "internal";
  clearStagedRefresh();
  const spans = sectionSpans(song);
  const span = spans.find((s) => s.sectionId === sectionId) ?? spans[0];
  if (!span) return false;
  const opts = {
    startBeat: span.startBeat,
    loopStart: span.startBeat,
    loopEnd: span.startBeat + span.durationBeats,
  };
  // forceLoop: loop even when the section spans the whole song — "loop this
  // part until I turn it off" means forever, not until the song ends.
  transport.play(song, { ...opts, forceLoop: true });
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) return true;
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return true;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return false;
  getLiveMidiScheduler().start(song, output, routing, streamOptions(target, opts));
  return true;
}

/** Resume normal (non-looping) playback from the current position. */
export async function resumeUnlooped(song: BlueprintSong): Promise<void> {
  const transport = getSongTransport();
  transport.clockSource = "internal";
  clearStagedRefresh();
  const beat = transport.getBeat();
  transport.play(song, { startBeat: beat });
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) return;
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;
  getLiveMidiScheduler().start(song, output, routing, streamOptions(target, { startBeat: beat }));
}

/**
 * Loop an arbitrary bar range of `song` — seek to `startBeat` and wrap
 * [startBeat, endBeat) forever until `resumeUnlooped`/Stop. This is the
 * ruler-drag gesture: draw a region on the bar ruler, hear it. Internal
 * clock only (callers guard against the Ableton clock — Live owns its own
 * transport).
 */
export async function playLoopRegion(song: BlueprintSong, startBeat: number, endBeat: number): Promise<void> {
  const transport = getSongTransport();
  transport.clockSource = "internal";
  clearStagedRefresh();
  const from = Math.max(0, startBeat);
  const to = Math.max(from + 0.25, endBeat);
  const opts = { startBeat: from, loopStart: from, loopEnd: to };
  transport.play(song, { ...opts, forceLoop: true });
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) return;
  const { midiOutputId, routing } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;
  getLiveMidiScheduler().start(song, output, routing, streamOptions(target, opts));
}

/** Overlay the drums editor's live draft (if one exists) onto the song, so
 *  a drum pattern being shaped in the Pattern tab is auditioned in the mix
 *  in real time — before Apply commits it to the blueprint. */
function withDrumDraft(song: BlueprintSong): BlueprintSong {
  const { sectionId, section } = useDrumsDraftStore.getState();
  if (!sectionId || !section) return song;
  return {
    ...song,
    sections: song.sections.map((sec) => (sec.id === sectionId ? section : sec)),
  };
}
