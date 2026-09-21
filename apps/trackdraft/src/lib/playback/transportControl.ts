/**
 * Shared transport control — the one implementation of "play this song /
 * stop" that both Studio's Play button and the header's global Play use, so
 * the two can never drift. Handles the clock source (internal playhead +
 * live MIDI out vs. following Ableton's transport over osc-bridge) and the
 * opted-in live MIDI scheduler.
 */

import { getSongTransport } from "./songTransport";
import { createAbletonSyncClock } from "./abletonSyncClock";
import {
  getLiveMidiScheduler,
  getMidiOutput,
  type LiveMidiChannelMap,
  type LiveSchedulerOptions,
  type SchedulerClock,
} from "./liveMidiOut";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { sectionSpans } from "../arrangement";
import type { BlueprintSong } from "../../types/blueprint";
import type { ClockSource } from "../../store/songStore";

/**
 * Start (or resume) playback for a song under the given clock source.
 * - Internal clock: silent playhead + live MIDI out (when a port is
 *   selected and reachable). If the transport is paused, resumes from the
 *   paused beat; otherwise plays from the top.
 * - Ableton clock: follow Ableton's transport via osc-bridge, and stream
 *   the song's parts into it on that same clock. Live is the master here —
 *   the notes carry Live's position, so a take lands on Live's grid
 *   instead of drifting against it (see `abletonSyncClock`).
 *
 * Returns true when playback started (or needs no MIDI port); false when a
 * selected port was stale and playback was rolled back — the caller can
 * surface that (e.g. alert) rather than fail silently.
 */
export async function playSong(song: BlueprintSong, clockSource: ClockSource): Promise<boolean> {
  const transport = getSongTransport();
  transport.clockSource = clockSource;
  clearStagedRefresh();

  if (clockSource === "ableton") {
    transport.syncToAbleton(song);
    // Follow-only when no port is selected (the previous behavior).
    const { midiOutputId, channels } = useMidiSettingsStore.getState();
    if (!midiOutputId) return true;
    const output = await getMidiOutput(midiOutputId);
    // A stale port still leaves the playhead following Live, which is
    // useful on its own — but the streaming the user asked for isn't
    // happening, so say so rather than pretend it started.
    if (!output) return false;
    getLiveMidiScheduler().start(song, output, channels, { clock: createAbletonSyncClock(song) });
    return true;
  }

  // Grab the paused beat BEFORE play() consumes it, so the live MIDI
  // scheduler can resume from the same place as the playhead.
  const resumeBeat = transport.isPaused() ? transport.getPausedBeat() : null;
  transport.play(song); // resumes from resumeBeat when set
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return true; // no port → silent playhead, as before
  const output = await getMidiOutput(midiOutputId);
  if (!output) {
    // The saved port id is stale (Web MIDI ids change between browser
    // restarts) — don't leave a silent playhead running while the user
    // thinks it's about to sound.
    transport.stop();
    return false;
  }
  getLiveMidiScheduler().start(song, output, channels, resumeBeat != null ? { startBeat: resumeBeat } : {});
  return true;
}

/**
 * Seek — jump the internal clock's playback position to `beat`: playing
 * continues from there; paused/stopped starts from there (a ruler click is
 * an audition gesture). No-op under the Ableton clock — Live is the master,
 * seek it there. The live MIDI scheduler re-starts from the same beat when
 * a port is available (silent playhead if the port is stale — the seek
 * itself still lands).
 */
export async function seekTo(song: BlueprintSong, clockSource: ClockSource, beat: number): Promise<void> {
  if (clockSource === "ableton") return;
  const transport = getSongTransport();
  clearStagedRefresh();
  const target = Math.max(0, beat);
  transport.play(song, { startBeat: target });
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;
  getLiveMidiScheduler().start(song, output, channels, { startBeat: target });
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
  channels: LiveMidiChannelMap;
  loop: { start: number; end: number } | null;
  /** The external clock the re-plan must keep following (Ableton mode), or
   *  null when the app's own clock is driving (the re-plan then re-bases it
   *  at `atBeat`, as it always did). */
  clock: SchedulerClock | null;
} | null = null;

/** Drop any pending staged re-plan. Playback restarts (play/loop/stop/
 *  pause) clear the transport's `nextBarCb`, which would orphan the slot —
 *  a later `liveRefresh` must not fold into a dead slot (it would return
 *  without re-registering, silently swallowing the edit) and a newly
 *  engaged section loop must not be clobbered by an old one. */
function clearStagedRefresh(): void {
  stagedRefresh = null;
}

export async function liveRefresh(song: BlueprintSong): Promise<void> {
  const transport = getSongTransport();
  const scheduler = getLiveMidiScheduler();
  if (!transport.getIsPlaying() || !scheduler.isRunning) return;
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;

  // A re-plan is already queued for this bar — fold the edit into it and
  // let the latest song apply when the boundary arrives.
  if (stagedRefresh) {
    stagedRefresh.song = song;
    return;
  }

  const atBeat = transport.getNextBarBeat();
  stagedRefresh = { atBeat, song, output, channels, loop: scheduler.loopRegion, clock: scheduler.activeClock };
  transport.onNextBar(() => {
    const s = stagedRefresh;
    stagedRefresh = null;
    if (!s) return;
    const opts: LiveSchedulerOptions = { startBeat: s.atBeat };
    if (s.loop) {
      opts.loopStart = s.loop.start;
      opts.loopEnd = s.loop.end;
    }
    if (s.clock) opts.clock = s.clock;
    scheduler.start(withDrumDraft(s.song), s.output, s.channels, opts);
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
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return true;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return false;
  getLiveMidiScheduler().start(song, output, channels, opts);
  return true;
}

/** Resume normal (non-looping) playback from the current position. */
export async function resumeUnlooped(song: BlueprintSong): Promise<void> {
  const transport = getSongTransport();
  transport.clockSource = "internal";
  clearStagedRefresh();
  const beat = transport.getBeat();
  transport.play(song, { startBeat: beat });
  const { midiOutputId, channels } = useMidiSettingsStore.getState();
  if (!midiOutputId) return;
  const output = await getMidiOutput(midiOutputId);
  if (!output) return;
  getLiveMidiScheduler().start(song, output, channels, { startBeat: beat });
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
