import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbletonClockState } from "./abletonClock";

type Listener = (state: AbletonClockState) => void;

const bridge = vi.hoisted(() => ({
  connect: vi.fn(),
  /** Current listener registered by the clock under test (null once disposed). */
  listener: null as Listener | null,
}));

vi.mock("./abletonClock", () => ({
  getAbletonClock: () => ({
    connect: bridge.connect,
    onChange: (listener: Listener) => {
      bridge.listener = listener;
      return () => {
        bridge.listener = null;
      };
    },
  }),
}));

const { createAbletonSyncClock } = await import("./abletonSyncClock");

/** Push a bridge message at wall-clock `now` ms. */
function emit(now: number, state: Partial<AbletonClockState>): void {
  nowMs = now;
  bridge.listener?.({
    connected: true,
    abletonBeat: null,
    isPlaying: true,
    ...state,
  });
}

let nowMs = 0;

describe("AbletonSyncClock", () => {
  beforeEach(() => {
    bridge.connect.mockClear();
    bridge.listener = null;
    nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no position until the bridge says where Live is", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    expect(clock.position()).toBeNull();
    expect(clock.timeAt(4)).toBeNull();

    emit(0, { abletonBeat: 8 });
    expect(clock.position()).toBe(8);
    expect(clock.timeAt(8)).toBe(0);
  });

  it("maps Ableton's beat into song beats through beatOffset", () => {
    const clock = createAbletonSyncClock({ bpm: 120, beatOffset: 8 });
    emit(0, { abletonBeat: 8 });

    expect(clock.position()).toBe(0);
    expect(clock.timeAt(0)).toBe(0);
    // Song beat 4 lands one beat later, at 120bpm.
    expect(clock.timeAt(4)).toBe(2000);
  });

  it("interpolates between whole-beat messages at Live's measured tempo", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 0 });
    // Two beats arriving 1000ms apart = 500ms/beat (Live running at 120bpm).
    emit(500, { abletonBeat: 1 });
    emit(1000, { abletonBeat: 2 });

    expect(clock.position()).toBe(2);
    nowMs = 1250;
    expect(clock.position()).toBe(2.5);
  });

  it("re-anchors on each new beat so error can't accumulate", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 0 });
    emit(500, { abletonBeat: 1 });

    // Beat 2 arrives 40ms late (a slow message rather than a slow transport):
    // the anchor moves with it instead of the lateness being carried forward.
    emit(1040, { abletonBeat: 2 });
    expect(clock.position()).toBe(2);
    nowMs = 1290;
    // Half a beat on from the new anchor — the anchor moved with the message
    // rather than the lateness being baked into the position.
    expect(clock.position()).toBeCloseTo(2.5, 1);
  });

  it("follows a master running well away from the song's own bpm", () => {
    // The song is 104bpm (577ms/beat) but Live is at 143bpm (420ms/beat).
    // Trusting the song's tempo here crawls at 73% of a beat and then snaps
    // forward on every message — the playhead stuttering against Live.
    const clock = createAbletonSyncClock({ bpm: 104 });
    emit(0, { abletonBeat: 10 });
    emit(419.6, { abletonBeat: 11 });
    emit(839.2, { abletonBeat: 12 });

    nowMs = 1049; // half a beat on at 143bpm
    expect(clock.position()).toBeCloseTo(12.5, 2);
    expect(clock.timeAt(13)).toBeCloseTo(839.2 + 419.6, 1);
  });

  it("doesn't take a bunched message for a tempo change", () => {
    // The bridge re-sends its subscriptions every 5s, which makes AbletonOSC
    // fire its beat listener again moments after a real beat — an ~90ms
    // "interval" that would read as 666bpm if it were believed.
    const clock = createAbletonSyncClock({ bpm: 104 });
    emit(0, { abletonBeat: 1 });
    emit(420, { abletonBeat: 2 });
    emit(840, { abletonBeat: 3 });
    emit(1260, { abletonBeat: 4 });
    emit(1350, { abletonBeat: 5 });
    emit(1770, { abletonBeat: 6 });

    nowMs = 1980;
    expect(clock.position()).toBeCloseTo(6.5, 2);
  });

  it("reads a skipped message as one long beat rather than a tempo change", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 0 });
    emit(500, { abletonBeat: 1 });
    emit(1000, { abletonBeat: 2 });
    // Beat 3's message was dropped: beat 4 arrives two beats after beat 2.
    emit(2000, { abletonBeat: 4 });

    nowMs = 2250;
    expect(clock.position()).toBeCloseTo(4.5, 2);
  });

  it("ignores the interval across a rewind", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 8 });
    emit(500, { abletonBeat: 9 });
    // Live looped back to the top: a huge negative interval, which says
    // nothing about the tempo.
    emit(600, { abletonBeat: 1 });
    expect(clock.position()).toBe(1);

    emit(1100, { abletonBeat: 2 });
    nowMs = 1350;
    expect(clock.position()).toBeCloseTo(2.5, 2);
  });

  it("ignores messages that carry no new beat (telemetry, reconnect)", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 4 });
    nowMs = 250;
    expect(clock.position()).toBe(4.5);

    // Same beat, e.g. an unrelated telemetry update — must not re-anchor,
    // which would snap the position back by the elapsed half beat.
    emit(250, { abletonBeat: 4 });
    expect(clock.position()).toBe(4.5);
  });

  it("reports no position while Live's transport is stopped", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 4 });
    expect(clock.position()).not.toBeNull();

    emit(500, { isPlaying: false });
    expect(clock.position()).toBeNull();
    expect(clock.timeAt(4)).toBeNull();
  });

  it("resumes a mid-beat pause from the held position, not the last whole beat", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 4 });
    // Live pauses half a beat in — the wire still calls that "beat 4".
    emit(250, { isPlaying: false });

    emit(5000, { isPlaying: true, abletonBeat: 4 });
    expect(clock.position()).toBe(4.5);
  });

  it("stops reporting once disposed", () => {
    const clock = createAbletonSyncClock({ bpm: 120 });
    emit(0, { abletonBeat: 4 });
    clock.dispose();

    expect(bridge.listener).toBeNull();
    expect(clock.position()).toBeNull();
  });
});
