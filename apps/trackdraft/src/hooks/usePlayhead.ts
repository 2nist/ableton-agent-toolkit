import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getPlayheadSnapshot,
  IDLE_PLAYHEAD,
  subscribePlayhead,
  subscribePlayheadFrames,
} from "../lib/playback/playheadStore";
import type { TransportTick } from "../lib/playback/songTransport";

/**
 * The transport position, quantised to a sixteenth note (see
 * `playheadStore`). Use this instead of `transport.onTick(setTick)` in
 * anything that renders: it costs one update per grid step instead of one
 * per animation frame, and every readout here is grid-quantised already.
 *
 * Never null — an idle snapshot means "stopped at the top", which is what
 * every consumer's `!tick.isPlaying` check already means.
 */
export function usePlayhead(): TransportTick {
  return useSyncExternalStore(subscribePlayhead, getPlayheadSnapshot, () => IDLE_PLAYHEAD);
}

/**
 * Run `onFrame(beat)` on every transport frame without re-rendering. The
 * callback lives in a ref, so an inline closure is fine and does not
 * re-subscribe on every render.
 *
 * This is how the playhead line stays smooth: writing `transform` to a DOM
 * node is free, while 60 React renders a second is not.
 */
export function usePlayheadFrames(onFrame: (beat: number) => void): void {
  const latest = useRef(onFrame);
  latest.current = onFrame;
  useEffect(() => subscribePlayheadFrames((beat) => latest.current(beat)), []);
}
