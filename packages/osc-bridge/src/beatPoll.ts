/**
 * The position poll.
 *
 * AbletonOSC's `start_listen/beat` pushes **one integer per beat** — a
 * heartbeat, not a position — so every consumer has to interpolate between
 * beats and re-anchor when the next one lands. `get/beat` returns the
 * transport position as a **float**, and asking for it 30 times a second gives
 * a clock something to follow instead of guess at.
 *
 * Measured against the harness in `apps/trackdraft/src/lib/playback/
 * timing.test.ts` (real scheduler, real clock, virtual time, 1,365 notes):
 *
 *   loopback  p95 3.0 ms → 1.9 ms, max 3.3 ms → 2.1 ms
 *   ±9 ms     p95 10.2 ms → 9.3 ms, p50 4.8 ms → 2.2 ms
 *
 * The gain only appears because the receiving clock *filters* dense samples
 * rather than hard-anchoring on each one (`abletonSyncClock`'s SLEW_FACTOR);
 * hard-anchoring a 30 Hz feed measured worse than the integer push it replaced,
 * because it imported arrival jitter thirty times a second.
 *
 * Polling is driven by the caller: there is nothing to ask Live while no
 * window is listening, so the bridge starts this on the first WebSocket client
 * and stops it on the last.
 */

export interface BeatPollOptions {
  /** ms between requests. <= 0 disables polling (the old integer-only feed). */
  intervalMs: number;
  /** Sends one `get/beat` request to AbletonOSC. */
  request: () => void;
}

export interface BeatPoll {
  /** Begin polling; safe to call repeatedly (one timer). No-op when disabled
   *  or already polling. */
  start: () => void;
  /** Stop polling; safe to call when not polling. */
  stop: () => void;
  readonly polling: boolean;
}

export function createBeatPoll({ intervalMs, request }: BeatPollOptions): BeatPoll {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    get polling() {
      return timer !== null;
    },
    start() {
      if (timer !== null || !(intervalMs > 0)) return;
      // Ask straight away: a window that just opened should get a position
      // now, not 33 ms from now.
      request();
      timer = setInterval(request, intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
