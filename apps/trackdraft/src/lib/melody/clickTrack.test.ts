import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClickTrack } from "./clickTrack";

// ── Fake transport: capture onTick subscribers and let tests fire ticks. ──
type FakeTick = { beat: number; isPlaying: boolean };
const listeners: ((tick: FakeTick) => void)[] = [];
const fakeTransport = {
  onTick: (cb: (tick: FakeTick) => void) => {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
  /** Where the click starts — the accents are relative to this, not to song
   *  beat 0 (see ClickTrack.start). */
  getBeat: () => originBeat,
};
let originBeat = 0;
vi.mock("../playback/songTransport", () => ({ getSongTransport: () => fakeTransport }));

// ── Fake AudioContext: record the clicks that get scheduled. ──
interface FakeOsc {
  frequency: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
let scheduled: { when: number; freq: number }[] = [];
class FakeAudioContext {
  state = "running";
  currentTime = 10; // fixed "now"
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => ({})),
  }));
  createOscillator = vi.fn(() => {
    const osc: FakeOsc = {
      frequency: { value: 0 },
      start: vi.fn(),
      stop: vi.fn(),
    };
    return {
      ...osc,
      type: "",
      connect: (gain: {}) => {
        scheduled.push({ when: 10.002, freq: osc.frequency.value });
        return gain;
      },
    };
  });
}
vi.stubGlobal("AudioContext", FakeAudioContext);

function fire(beat: number, isPlaying = true): void {
  for (const cb of [...listeners]) cb({ beat, isPlaying });
}

describe("ClickTrack", () => {
  let track: ClickTrack;

  beforeEach(() => {
    scheduled = [];
    originBeat = 0;
    track = new ClickTrack();
  });

  afterEach(() => {
    track.dispose();
    listeners.length = 0;
  });

  it("clicks once per integer beat crossing, not on every tick", () => {
    track.start();
    fire(0.1); // crosses beat 0 → click
    fire(0.4); // same beat → no click
    fire(0.9); // same beat → no click
    fire(1.2); // crosses beat 1 → click
    fire(2.1); // crosses beat 2 → click
    expect(scheduled).toHaveLength(3);
  });

  it("accents the downbeat with a higher pitch", () => {
    track.start(4);
    fire(0.1); // beat 0 → accent
    fire(1.1); // beat 1 → regular
    fire(4.1); // beat 4 → accent
    expect(scheduled[0].freq).toBeGreaterThan(scheduled[1].freq); // accent higher
    expect(scheduled[2].freq).toBe(scheduled[0].freq);
  });

  it("accents in the section's own meter, not a hard-coded 4/4", () => {
    // A 7/8 bar is 3.5 beats long, so the click (which lands on whole beats)
    // accents every seventh beat — a 4/4 accent put it on every fourth.
    track.start(3.5);
    fire(0.1); // accent
    fire(1.1);
    fire(2.1);
    fire(3.1);
    fire(4.1); // NOT an accent in 7/8
    fire(6.9); // beat 6, still inside bar 1
    fire(7.1); // beat 7 → accent
    expect(scheduled[4].freq).toBeLessThan(scheduled[0].freq);
    expect(scheduled[6].freq).toBe(scheduled[0].freq);
  });

  it("accents relative to where the click started, not song beat 0", () => {
    // Recording a chorus that starts on beat 16 must still accent its first
    // beat instead of waiting for song beat 20.
    originBeat = 16;
    track.start(4);
    fire(16.1); // the section's first beat → accent
    fire(17.1);
    expect(scheduled[0].freq).toBeGreaterThan(scheduled[1].freq);
  });

  it("ignores ticks while the transport is stopped", () => {
    track.start();
    fire(3.2, false); // not playing → no click
    fire(5.1); // playing again → beat 5 → click
    expect(scheduled).toHaveLength(1);
  });

  it("stop() unsubscribes so later ticks don't click", () => {
    track.start();
    fire(0.1);
    track.stop();
    fire(1.1);
    expect(scheduled).toHaveLength(1);
  });

  it("start() while running is a no-op (no double subscription)", () => {
    track.start();
    track.start();
    fire(0.1);
    expect(scheduled).toHaveLength(1);
  });
});
