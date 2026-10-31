/**
 * The transport, as React sees it.
 *
 * `SongTransport` emits on every animation frame so the playhead can move
 * smoothly — but eight surfaces were feeding that 60 fps tick straight into
 * `setState`, which re-rendered the whole song shell sixty times a second to
 * move one cursor. On an iPad that is the difference between a smooth
 * playhead and a stuttering one, and a stuttering playhead reads as *timing
 * instability*, which is the worst possible misdiagnosis in this app.
 *
 * So the transport is read two ways:
 *
 *  - `subscribePlayhead` / `usePlayhead()` — the position ROUNDED TO THE
 *    MUSICAL GRID (a sixteenth). Every readout in the app is quantised to a
 *    grid anyway (a chord is at least a beat long, a step is a sixteenth), so
 *    this is the same information at a sixteenth of the render cost.
 *  - `subscribePlayheadFrames` — the raw per-frame beat, for the few things
 *    that draw rather than render. A DOM node's `transform` costs nothing and
 *    stays perfectly smooth, so the playhead line does not have to be a
 *    React update at all.
 *
 * One transport subscription is shared by both and reference-counted, so a
 * page with nothing playing holds none.
 */

import { getSongTransport, type TransportTick } from "./songTransport";

/** One sixteenth note, in beats. Coarse enough to collapse a 60 fps stream
 *  into ~8 updates a second at 120 bpm, fine enough that a step grid, a chord
 *  highlight and a bar · beat counter cannot tell the difference. */
export const PLAYHEAD_QUANTUM = 0.25;

/** Not playing, at the top — a stable object so `useSyncExternalStore` can
 *  compare snapshots by identity before the first tick. */
export const IDLE_PLAYHEAD: TransportTick = {
  beat: 0,
  isPlaying: false,
  sectionIndex: -1,
  sectionId: null,
  occurrenceIndex: -1,
};

let snapshot: TransportTick = IDLE_PLAYHEAD;
const listeners = new Set<() => void>();
const frameListeners = new Set<(beat: number) => void>();
let detachTransport: (() => void) | null = null;

function quantize(beat: number): number {
  return Math.round(beat / PLAYHEAD_QUANTUM) * PLAYHEAD_QUANTUM;
}

function sameSnapshot(a: TransportTick, b: TransportTick): boolean {
  return (
    a.isPlaying === b.isPlaying &&
    Math.abs(a.beat - b.beat) < 1e-6 &&
    a.sectionIndex === b.sectionIndex &&
    (a.sectionId ?? null) === (b.sectionId ?? null) &&
    (a.occurrenceIndex ?? -1) === (b.occurrenceIndex ?? -1)
  );
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      console.error("[playhead] a listener threw; the others continued", error);
    }
  }
}

function onTransportTick(tick: TransportTick): void {
  // Frames first: an imperative consumer paints this frame's position even
  // when the quantised snapshot has not moved.
  for (const listener of Array.from(frameListeners)) {
    try {
      listener(tick.beat);
    } catch (error) {
      console.error("[playhead] a frame listener threw; the others continued", error);
    }
  }

  const next: TransportTick = {
    beat: tick.isPlaying ? quantize(tick.beat) : tick.beat,
    isPlaying: tick.isPlaying,
    sectionIndex: tick.sectionIndex,
    sectionId: tick.sectionId ?? null,
    occurrenceIndex: tick.occurrenceIndex ?? -1,
  };
  // The stop tick carries beat 0; it must always land, or the playhead would
  // stay wherever it was last quantised.
  if (sameSnapshot(snapshot, next)) return;
  snapshot = next;
  notify();
}

function retain(): void {
  if (detachTransport) return;
  detachTransport = getSongTransport().onTick(onTransportTick);
}

function release(): void {
  if (listeners.size > 0 || frameListeners.size > 0) return;
  detachTransport?.();
  detachTransport = null;
}

/** Subscribe to the quantised position (for React). */
export function subscribePlayhead(listener: () => void): () => void {
  listeners.add(listener);
  retain();
  return () => {
    listeners.delete(listener);
    release();
  };
}

export function getPlayheadSnapshot(): TransportTick {
  return snapshot;
}

/** Subscribe to the raw per-frame beat — for code that writes a style or
 *  draws to a canvas instead of re-rendering. Returns an unsubscribe. */
export function subscribePlayheadFrames(listener: (beat: number) => void): () => void {
  frameListeners.add(listener);
  retain();
  return () => {
    frameListeners.delete(listener);
    release();
  };
}
