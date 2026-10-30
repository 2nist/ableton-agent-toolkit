import { useCallback, useEffect, useRef, useState } from "react";
import type { BlueprintSong } from "../../../types/blueprint";
import { sectionSpans } from "../../../lib/arrangement";
import { getMidiOutput } from "../../../lib/playback/liveMidiOut";
import { planClicks } from "../../../lib/playback/metronome";
import { getSongTransport, type TransportTick } from "../../../lib/playback/songTransport";
import { useMidiSettingsStore } from "../../../store/midiSettingsStore";
import { targetUsesAppClock, useDawTargetStore } from "../../../store/dawTargetStore";

/** The drum channel the click rides on — a rehearsal click is a drum sound. */
const CLICK_CHANNEL = 9;

export interface RehearsalTransportArgs {
  song: BlueprintSong;
  /** The section the desk is on: where play starts and what loop repeats. */
  sectionId: string | null;
  loop: boolean;
  click: boolean;
  countIn: boolean;
  beatsPerBar: number;
}

export interface RehearsalTransport {
  isPlaying: boolean;
  /** Live is driving the clock, so this desk cannot start or stop the
   *  playhead — `play()` is a no-op and the UI must say why instead of
   *  claiming to play. */
  clockBlocked: boolean;
  /** 4, 3, 2, 1 while the count-in bar runs, then null. */
  countInBeat: number | null;
  /** A MIDI output is configured, so a click has somewhere to go. */
  clickReady: boolean;
  play: () => void;
  stop: () => void;
}

/**
 * Rehearse's transport. The app's clock is a silent playhead (`songTransport`),
 * so the click is MIDI — the same port and idea as the chord preview — and
 * "play" always means "put the cursor at this section and move it".
 *
 * Count-in is a real bar: the click for it is scheduled immediately and the
 * playhead starts a bar later, so the count is musical time rather than a
 * decoration. Loop plays the focused section over and over (the transport's
 * own loop region), which is what learning changes needs.
 */
export function useRehearsalTransport({
  song,
  sectionId,
  loop,
  click,
  countIn,
  beatsPerBar,
}: RehearsalTransportArgs): RehearsalTransport {
  // The click is a percussion part, so it follows the drums stem's port when
  // that stem has its own hardware out; otherwise the master port.
  const stemsOutputId = useMidiSettingsStore((state) => state.stemOutputs.drums ?? "");
  const masterOutputId = useMidiSettingsStore((state) => state.midiOutputId);
  const outputId = stemsOutputId || masterOutputId;
  // Live is the master when it is the target — the app's playhead follows
  // Live's transport and cannot be started or stopped from here.
  const clockBlocked = !targetUsesAppClock(useDawTargetStore((state) => state.target));
  const [isPlaying, setIsPlaying] = useState(false);
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const outputRef = useRef<MIDIOutput | null>(null);
  const timers = useRef<number[]>([]);
  const scheduledBar = useRef<number | null>(null);
  const playingRef = useRef(false);
  const clickRef = useRef(click);
  const bpmRef = useRef(song.bpm);
  const barRef = useRef(beatsPerBar);
  clickRef.current = click;
  bpmRef.current = song.bpm;
  barRef.current = beatsPerBar;

  useEffect(() => {
    let cancelled = false;
    if (!outputId) {
      outputRef.current = null;
      return;
    }
    void getMidiOutput(outputId).then((output) => {
      if (!cancelled) outputRef.current = output;
    });
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setCountInBeat(null);
  }, []);

  /** Send one bar of clicks starting at `fromBeat`, `delayMs` from now. */
  const sendBar = useCallback((fromBeat: number, delayMs = 0) => {
    const output = outputRef.current;
    if (!output || !clickRef.current) return;
    const anchor = performance.now() + delayMs;
    const notes = planClicks({
      fromBeat,
      beats: barRef.current,
      bpm: bpmRef.current,
      beatsPerBar: barRef.current,
    });
    for (const note of notes) {
      const on = anchor + note.atMs;
      output.send([0x90 | CLICK_CHANNEL, note.pitch, note.velocity], on);
      output.send([0x80 | CLICK_CHANNEL, note.pitch, 0], on + note.durationMs);
    }
  }, []);

  const stop = useCallback(() => {
    getSongTransport().stop();
    clearTimers();
    scheduledBar.current = null;
    setIsPlaying(false);
  }, [clearTimers]);

  const play = useCallback(() => {
    const transport = getSongTransport();
    // Under the Ableton clock the app's transport refuses to start (Live owns
    // the playhead), so bail before scheduling a count-in or a click — the
    // old code set `isPlaying` regardless and the desk sat "playing" forever
    // with a frozen cursor.
    if (transport.clockSource === "ableton") return;
    const spans = sectionSpans(song);
    const span = spans.find((entry) => entry.sectionId === sectionId) ?? spans[0];
    if (!span) return;
    clearTimers();

    const beatMs = 60000 / Math.max(1, song.bpm);
    const startAt = () => {
      const started = transport.play(song, {
        startBeat: span.startBeat,
        ...(loop
          ? { loopStart: span.startBeat, loopEnd: span.startBeat + span.durationBeats, forceLoop: true }
          : {}),
      });
      if (!started) return;
      scheduledBar.current = Math.floor(span.startBeat / beatsPerBar);
      setIsPlaying(true);
    };

    if (countIn) {
      // Click the count-in bar now, then start a bar later.
      sendBar(0, 0);
      setCountInBeat(beatsPerBar);
      for (let index = 1; index <= beatsPerBar; index++) {
        const timer = window.setTimeout(() => setCountInBeat(beatsPerBar - index), index * beatMs);
        timers.current.push(timer);
      }
      const startTimer = window.setTimeout(() => {
        setCountInBeat(null);
        sendBar(span.startBeat, 0);
        startAt();
      }, beatsPerBar * beatMs);
      timers.current.push(startTimer);
      return;
    }

    sendBar(span.startBeat, 0);
    startAt();
  }, [song, sectionId, loop, countIn, beatsPerBar, clearTimers, sendBar]);

  // Look ahead one bar at a time so the click is sample-accurate instead of
  // riding a 60fps tick: schedule when the playhead crosses into a new bar.
  useEffect(() => {
    const transport = getSongTransport();
    return transport.onTick((tick: TransportTick) => {
      // Ticks arrive at display rate; only a *change* may touch state, or the
      // desk re-renders sixty times a second for nothing.
      if (!tick.isPlaying) {
        if (playingRef.current) {
          playingRef.current = false;
          setIsPlaying(false);
        }
        return;
      }
      if (!playingRef.current) {
        playingRef.current = true;
        setIsPlaying(true);
      }
      if (!clickRef.current) return;
      const bar = Math.floor(tick.beat / barRef.current);
      if (scheduledBar.current === null) {
        scheduledBar.current = bar;
        sendBar(bar * barRef.current, 0);
        return;
      }
      if (bar > scheduledBar.current) {
        scheduledBar.current = bar;
        sendBar(bar * barRef.current, 0);
      }
    });
  }, [sendBar]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    isPlaying,
    countInBeat,
    clockBlocked,
    clickReady: Boolean(outputId),
    play,
    stop,
  };
}
