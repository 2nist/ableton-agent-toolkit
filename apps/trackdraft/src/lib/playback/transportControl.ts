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
  midiOutSupported,
  resolveStemOutputs,
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
import { createWallClock, getMidiClockSender } from "./midiClockOut";
import { sectionSpans } from "../arrangement";
import type { StemId, StemRoutingMap } from "../stems";
import type { BlueprintSong } from "../../types/blueprint";

/** Scheduler options every start needs from the current settings and the
 *  active target: the calibrated output latency, and whether the song's
 *  render offset applies (everything but Live — Live's clock carries its own
 *  calibration in `beatOffset`).
 *
 *  Exported because the melody recorder starts the scheduler itself; it must
 *  build the same options or the take is recorded against a backing track
 *  that is calibrated differently from every other surface. */
export function streamOptions(target: DawTarget, extra: LiveSchedulerOptions = {}): LiveSchedulerOptions {
  const { latencyMs } = useMidiSettingsStore.getState();
  return { ...extra, outputLatencyMs: latencyMs, applyOutputOffset: targetUsesAppClock(target) };
}

/**
 * What a start should stream into: the master port plus every stem that has
 * its own hardware port.
 *
 * A stem with no override (or whose saved port has vanished) follows the
 * master, which is what every existing setup expects. The master itself may
 * be Off when every stem has its own port — a hardware-only rig is a valid
 * configuration, and the scheduler simply skips stems with nowhere to go.
 */
interface ResolvedOutputs {
  master: MIDIOutput | null;
  /** A master was selected but its port no longer exists. */
  stale: boolean;
  stemOutputs: Partial<Record<StemId, MIDIOutput>>;
  /** The MIDI clock port, when one is selected and exists. */
  clockOut: MIDIOutput | null;
}

async function resolveOutputs(): Promise<ResolvedOutputs> {
  const { midiOutputId, stemOutputs, clockOutId } = useMidiSettingsStore.getState();
  // No Web MIDI at all (Safari/Firefox/iPad) is an ordinary state, not an
  // error — and this now runs BEFORE the transport starts, so letting
  // `requestMIDIAccess` throw would stop playback entirely instead of just
  // leaving the stream silent.
  if (!midiOutSupported()) return { master: null, stale: false, stemOutputs: {}, clockOut: null };
  try {
    const master = midiOutputId ? await getMidiOutput(midiOutputId) : null;
    return {
      master,
      stale: midiOutputId !== "" && master === null,
      stemOutputs: await resolveStemOutputs(stemOutputs),
      clockOut: clockOutId ? await getMidiOutput(clockOutId) : null,
    };
  } catch {
    // Access denied / revoked mid-session: behave like "nothing routed".
    return { master: null, stale: false, stemOutputs: {}, clockOut: null };
  }
}

/** Anything to play into — a master port, or at least one hardware stem. */
function hasAnyOutput(outputs: ResolvedOutputs): boolean {
  return outputs.master !== null || Object.keys(outputs.stemOutputs).length > 0;
}

/**
 * Start MIDI clock out for this transport, or stop it when no clock port is
 * selected. The ticks follow the SAME clock the notes are timed from, so the
 * receiving DAW's grid and the streamed parts can't describe two timelines;
 * a clock-only rig (port selected, nothing streamed) falls back to the app's
 * own wall clock at the song's tempo.
 *
 * Call it *after* the scheduler starts, so `runningClock` exists, and pass the
 * same `startBeat` the transport started from — a receiver counts from zero
 * when it hears Start, so a launch offset would put its bar 1 at our beat 0.
 */
function startClockOut(song: BlueprintSong, startBeat: number, output: MIDIOutput | null): void {
  const sender = getMidiClockSender();
  const { latencyMs } = useMidiSettingsStore.getState();
  if (!output) {
    sender.stop();
    return;
  }
  sender.start({
    output,
    clock: getLiveMidiScheduler().runningClock ?? createWallClock(song.bpm, startBeat),
    bpm: song.bpm,
    startBeat,
    latencyMs,
  });
}

/** Follow a re-based note clock (the next-bar live re-plan) without telling
 *  the receiver to restart. */
function reanchorClockOut(startBeat: number): void {
  const clock = getLiveMidiScheduler().runningClock;
  if (clock) getMidiClockSender().reanchor(clock, startBeat);
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
 * Ports are resolved BEFORE the transport starts. The scheduler anchors its
 * own clock at the moment `start()` runs, so starting the playhead first and
 * awaiting `navigator.requestMIDIAccess` after it put the two clocks — and
 * therefore the notes and the cursor — that await apart. Every entry point
 * here resolves first, then starts, so one `t0` covers both.
 *
 * Returns true when playback started (or needs no MIDI port); false when a
 * selected port was stale and playback never started — the caller can
 * surface that (e.g. alert) rather than fail silently.
 */
export async function playSong(song: BlueprintSong, target: DawTarget): Promise<boolean> {
  const transport = getSongTransport();
  transport.clockSource = targetUsesAppClock(target) ? "internal" : "ableton";
  clearStagedRefresh();

  if (target === "live") {
    // Live is the master here, so TrackDraft sends no clock — and a sender
    // left running from another target would fight Live's transport.
    getMidiClockSender().stop();
    // Follow-only when nothing is routed (the previous behavior).
    const { routing } = useMidiSettingsStore.getState();
    const outputs = await resolveOutputs();
    transport.syncToAbleton(song);
    // A stale port still leaves the playhead following Live, which is
    // useful on its own — but the streaming the user asked for isn't
    // happening, so say so rather than pretend it started.
    if (outputs.stale) return false;
    if (!hasAnyOutput(outputs)) return true;
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, { clock: createAbletonSyncClock(song), stemOutputs: outputs.stemOutputs }),
    );
    return true;
  }

  if (!targetStreamsMidi(target)) {
    // File only — silent playhead. MIDI clock out still applies: syncing a
    // DAW's transport to ours without streaming a single note is a legitimate
    // rig (and the cheapest way to try clock sync).
    const outputs = await resolveOutputs();
    transport.play(song);
    startClockOut(song, 0, outputs.clockOut);
    return true;
  }

  // Grab the paused beat BEFORE play() consumes it, so the live MIDI
  // scheduler can resume from the same place as the playhead.
  const resumeBeat = transport.isPaused() ? transport.getPausedBeat() : null;
  const { routing } = useMidiSettingsStore.getState();
  const outputs = await resolveOutputs();
  if (outputs.stale) {
    // The saved port id is stale (Web MIDI ids change between browser
    // restarts) — don't start a silent playhead the user thinks is about to
    // sound.
    return false;
  }
  alignLiveTempo(song);
  transport.play(song); // resumes from resumeBeat when set
  // Nothing routed means a silent playhead, as before — but MIDI clock out
  // doesn't need a note stream, so a clock-only rig still starts counting.
  if (hasAnyOutput(outputs)) {
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, {
        ...(resumeBeat != null ? { startBeat: resumeBeat } : {}),
        stemOutputs: outputs.stemOutputs,
      }),
    );
  }
  startClockOut(song, resumeBeat ?? 0, outputs.clockOut);
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
  if (!targetStreamsMidi(target)) {
    transport.play(song, { startBeat: to });
    return;
  }
  // Resolve before starting, so the stream and the playhead share one
  // anchor (see playSong).
  const { routing } = useMidiSettingsStore.getState();
  const outputs = await resolveOutputs();
  transport.play(song, { startBeat: to });
  if (hasAnyOutput(outputs)) {
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, { startBeat: to, stemOutputs: outputs.stemOutputs }),
    );
  }
  startClockOut(song, to, outputs.clockOut); // the seek itself still lands
}

/** Pause playback — freeze the playhead (and silence the live MIDI out);
 *  `playSong` will resume from the held beat. */
export function pauseSong(): void {
  clearStagedRefresh();
  getSongTransport().pause();
  getLiveMidiScheduler().pause();
  getMidiClockSender().stop();
}

/** Stop playback — the transport and any live MIDI scheduling; resets to
 *  the top (a paused position is cleared). */
export function stopSong(): void {
  clearStagedRefresh();
  getSongTransport().stop();
  getLiveMidiScheduler().stop();
  getMidiClockSender().stop();
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
  /** Master port; null when every stem has its own hardware port. */
  output: MIDIOutput | null;
  /** Per-stem hardware ports, resolved when the edit was staged. */
  stemOutputs: Partial<Record<StemId, MIDIOutput>>;
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
  const { routing } = useMidiSettingsStore.getState();
  const outputs = await resolveOutputs();
  if (!hasAnyOutput(outputs)) return;

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
  const stage = {
    atBeat,
    song,
    output: outputs.master,
    stemOutputs: outputs.stemOutputs,
    routing,
    target,
    loop: scheduler.loopRegion,
    clock: scheduler.activeClock,
  };
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
    opts.stemOutputs = s.stemOutputs;
    scheduler.start(withDrumDraft(s.song), s.output, s.routing, opts);
    reanchorClockOut(s.atBeat);
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
  const target = useDawTargetStore.getState().target;
  // Resolve before starting, so the stream and the playhead share one
  // anchor (see playSong).
  const { routing } = useMidiSettingsStore.getState();
  const outputs = targetStreamsMidi(target) ? await resolveOutputs() : null;
  if (outputs?.stale) return false;
  // forceLoop: loop even when the section spans the whole song — "loop this
  // part until I turn it off" means forever, not until the song ends.
  transport.play(song, { ...opts, forceLoop: true });
  if (!outputs) return true;
  if (hasAnyOutput(outputs)) {
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, { ...opts, stemOutputs: outputs.stemOutputs }),
    );
  }
  startClockOut(song, span.startBeat, outputs.clockOut);
  return true;
}

/** Resume normal (non-looping) playback from the current position. */
export async function resumeUnlooped(song: BlueprintSong): Promise<void> {
  const transport = getSongTransport();
  transport.clockSource = "internal";
  clearStagedRefresh();
  const beat = transport.getBeat();
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) {
    transport.play(song, { startBeat: beat });
    return;
  }
  // Resolve before starting, so the stream and the playhead share one
  // anchor (see playSong).
  const { routing } = useMidiSettingsStore.getState();
  const outputs = await resolveOutputs();
  transport.play(song, { startBeat: beat });
  if (hasAnyOutput(outputs)) {
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, { startBeat: beat, stemOutputs: outputs.stemOutputs }),
    );
  }
  startClockOut(song, beat, outputs.clockOut);
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
  const target = useDawTargetStore.getState().target;
  if (!targetStreamsMidi(target)) {
    transport.play(song, { ...opts, forceLoop: true });
    return;
  }
  // Resolve before starting, so the stream and the playhead share one
  // anchor (see playSong).
  const { routing } = useMidiSettingsStore.getState();
  const outputs = await resolveOutputs();
  transport.play(song, { ...opts, forceLoop: true });
  if (hasAnyOutput(outputs)) {
    getLiveMidiScheduler().start(
      song,
      outputs.master,
      routing,
      streamOptions(target, { ...opts, stemOutputs: outputs.stemOutputs }),
    );
  }
  startClockOut(song, from, outputs.clockOut);
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
