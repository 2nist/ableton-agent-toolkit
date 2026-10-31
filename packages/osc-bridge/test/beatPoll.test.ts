import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createBeatPoll } from "../src/beatPoll.js";

describe("beat poll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once immediately, then once per interval", () => {
    const request = vi.fn();
    const poll = createBeatPoll({ intervalMs: 33, request });

    poll.start();
    expect(request).toHaveBeenCalledTimes(1); // no waiting for the first one

    vi.advanceTimersByTime(99);
    expect(request).toHaveBeenCalledTimes(4); // 0, 33, 66, 99

    poll.stop();
    vi.advanceTimersByTime(500);
    expect(request).toHaveBeenCalledTimes(4); // stopped means stopped
  });

  it("is idempotent — starting twice keeps one timer", () => {
    const request = vi.fn();
    const poll = createBeatPoll({ intervalMs: 33, request });
    poll.start();
    poll.start();
    expect(poll.polling).toBe(true);
    vi.advanceTimersByTime(33);
    expect(request).toHaveBeenCalledTimes(2); // immediate + one tick, not three
    poll.stop();
  });

  it("does nothing at all when disabled", () => {
    // The old integer-only feed: `intervalMs: 0` must be silent, not a
    // request every 0 ms.
    const request = vi.fn();
    const poll = createBeatPoll({ intervalMs: 0, request });
    poll.start();
    vi.advanceTimersByTime(1000);
    expect(request).not.toHaveBeenCalled();
    expect(poll.polling).toBe(false);
  });

  it("can be restarted after a stop (last client leaves, another arrives)", () => {
    const request = vi.fn();
    const poll = createBeatPoll({ intervalMs: 20, request });
    poll.start();
    poll.stop();
    poll.start();
    expect(poll.polling).toBe(true);
    vi.advanceTimersByTime(20);
    expect(request).toHaveBeenCalledTimes(3); // two immediates + one tick
    poll.stop();
  });
});
