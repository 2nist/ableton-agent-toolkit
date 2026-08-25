import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BlueprintSong, BlueprintSection, Chord } from "../../types/blueprint";

// getPreviewPlayer() reaches for `window.AudioContext`, which doesn't
// exist in this (non-jsdom) test environment — stub it so `play()`'s
// chord-triggering calls are observable without needing a real browser.
const playChordObject = vi.fn();
const playerStop = vi.fn();
vi.mock("../harmony/audioPreview", () => ({
  getPreviewPlayer: () => ({ playChordObject, stop: playerStop }),
}));

// playDrumHits() ultimately reaches for window.AudioContext too (via
// drumPreview.ts's own lazy DrumMachine) — same reasoning as above.
const playDrumHits = vi.fn().mockResolvedValue(undefined);
vi.mock("./drumPreview", () => ({
  playDrumHits,
  inferPatternForSection: () => "standard",
}));

// songTransport.ts now schedules against the shared AudioContext's own
// clock directly (see audioContext.ts) rather than performance.now() —
// stub a minimal fake whose `currentTime` tracks vitest's faked
// performance.now() (seconds vs. ms), so `vi.advanceTimersByTime` drives
// it the same way it always drove the old wall-clock-based version.
vi.mock("./audioContext", () => ({
  getSharedAudioContext: () => ({ get currentTime() { return performance.now() / 1000; } }),
}));

// `createTimerWorker()` constructs a real `Worker` from a Blob — Workers
// run in their own execution context with their own timer realm, which
// doesn't exist in this (non-jsdom) test environment and, more
// fundamentally, wouldn't be drivable by `vi.advanceTimersByTime` even if
// it did (a real Worker's internal `setInterval` lives outside the main
// thread vitest fakes). Stub `Worker` with a plain class that runs the
// *exact same* ready/not-ready predicate as `clockWorker.ts`'s inline
// script, but using the test's own (fake-timer-controlled) `setInterval`
// and `performance.now()` — same scheduling behavior, same thread, so
// `vi.advanceTimersByTime` drives it exactly like it drives everything else.
const PRECISION_MS = 4;
class MockWorker {
  onmessage: ((msg: MessageEvent) => void) | null = null;
  private events: { id: number; fireAtMs: number }[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  postMessage(data: { type: string; events?: { id: number; fireAtMs: number }[] }): void {
    if (data.type !== "schedule" || !data.events) return;
    this.events = data.events.slice();
    if (this.intervalId === null) this.intervalId = setInterval(() => this.tick(), PRECISION_MS);
  }

  terminate(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private tick(): void {
    const now = performance.now();
    const ready = this.events.filter((e) => e.fireAtMs - now <= PRECISION_MS);
    for (const e of ready) this.onmessage?.({ data: { type: "fire", id: e.id } } as MessageEvent);
    this.events = this.events.filter((e) => e.fireAtMs - now > PRECISION_MS);
    if (this.events.length === 0 && this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
vi.stubGlobal("Worker", MockWorker);

// requestAnimationFrame/cancelAnimationFrame are browser-only too, and were
// masked entirely until now — every test that reached this call previously
// threw on `Worker` first. Shim via `setTimeout`, which fake timers already
// control directly, at a plausible ~60fps interval.
let nextRafId = 0;
const rafTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  const id = ++nextRafId;
  const timeoutId = setTimeout(() => {
    rafTimeouts.delete(id);
    cb(performance.now());
  }, 16);
  rafTimeouts.set(id, timeoutId);
  return id;
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => {
  const timeoutId = rafTimeouts.get(id);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    rafTimeouts.delete(id);
  }
});

// `syncToAbleton()` connects through `abletonClock.ts`'s WebSocket
// singleton — stub it the same way `audioPreview`/`drumPreview` are
// stubbed above, exposing the `onChange` listener so tests can simulate
// osc-bridge's sparse integer-beat messages directly.
type FakeAbletonState = { abletonBeat: number | null; isPlaying: boolean };
let abletonChangeListener: ((state: FakeAbletonState) => void) | null = null;
const abletonConnect = vi.fn();
vi.mock("./abletonClock", () => ({
  getAbletonClock: () => ({
    connect: abletonConnect,
    onChange: (listener: (state: FakeAbletonState) => void) => {
      abletonChangeListener = listener;
      return () => {
        abletonChangeListener = null;
      };
    },
    getState: () => ({ connected: true, abletonBeat: null, isPlaying: false }),
  }),
}));

const { getSongTransport, TRANSPORT_CHANNEL_NAME } = await import("./songTransport");

function makeChord(overrides: Partial<Chord> & { beats: number }): Chord {
  return { id: Math.random().toString(36), romanNumeral: "I", root: "C", quality: "maj", ...overrides };
}

function makeSection(overrides: Partial<BlueprintSection> & { id: string; chords: Chord[] }): BlueprintSection {
  return {
    name: overrides.id,
    role: "verse",
    bars: 4,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function makeSong(sections: BlueprintSection[], bpm = 120): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections,
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("SongTransport.play", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playChordObject.mockClear();
    playerStop.mockClear();
  });

  afterEach(() => {
    getSongTransport().stop();
    vi.useRealTimers();
  });

  it("does nothing for a song with no sections", () => {
    const ticks: unknown[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));
    getSongTransport().play(makeSong([]));
    vi.advanceTimersByTime(500);
    expect(ticks).toHaveLength(0);
    unsub();
  });

  it("triggers every chord across every section, offset by that section's startBeat", () => {
    // Section A: 2 bars/4/4 = 8 beats, one 8-beat chord. Section B starts
    // at beat 8, its own chord should fire at 8 beats-in = 4s at 120bpm.
    const song = makeSong([
      makeSection({ id: "a", bars: 2, chords: [makeChord({ beats: 8 })] }),
      makeSection({ id: "b", bars: 2, chords: [makeChord({ beats: 8 })] }),
    ]);

    getSongTransport().play(song);
    // The worker's own tick only runs every PRECISION_MS (4ms) — a
    // beat-0 event's fireAtMs is already "due" the instant it's scheduled
    // (it's SCHEDULE_LOOKAHEAD_MS in the past relative to "now"), but
    // nothing evaluates that until the first interval tick actually runs.
    vi.advanceTimersByTime(10); // let that first worker tick fire
    expect(playChordObject).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000); // 8 beats at 120bpm = 4s, minus the 10ms already advanced
    expect(playChordObject).toHaveBeenCalledTimes(2); // section B's chord has now fired
  });

  it("emits ticks with the correct sectionIndex as playback crosses a section boundary", () => {
    const song = makeSong([
      makeSection({ id: "a", bars: 2, chords: [] }), // 8 beats
      makeSection({ id: "b", bars: 2, chords: [] }),
    ]);
    const ticks: { beat: number; sectionIndex: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(100); // one scheduler tick, still in section A
    expect(ticks[ticks.length - 1]?.sectionIndex).toBe(0);

    vi.advanceTimersByTime(4000); // now well into section B (starts at beat 8 = 4s)
    expect(ticks[ticks.length - 1]?.sectionIndex).toBe(1);

    unsub();
  });

  it("stops on its own at the end of the song and calls the player's stop()", () => {
    const song = makeSong([makeSection({ id: "a", bars: 1, chords: [] })]); // 4 beats = 2s at 120bpm
    const ticks: { isPlaying: boolean }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(2500);

    expect(ticks[ticks.length - 1]?.isPlaying).toBe(false);
    expect(playerStop).toHaveBeenCalled();
    expect(getSongTransport().getIsPlaying()).toBe(false);

    unsub();
  });

  it("stop() silences pending chord timeouts scheduled by play()", () => {
    const song = makeSong([makeSection({ id: "a", bars: 4, chords: [makeChord({ beats: 16 })] })]);
    getSongTransport().play(song);
    getSongTransport().stop();
    playChordObject.mockClear();

    vi.advanceTimersByTime(10_000);
    expect(playChordObject).not.toHaveBeenCalled();
  });
});

describe("SongTransport.syncToAbleton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    abletonChangeListener = null;
  });

  afterEach(() => {
    getSongTransport().stop();
    vi.useRealTimers();
  });

  it("emits exactly on each real beat message", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });

    expect(ticks[ticks.length - 1]?.beat).toBe(4);
    unsub();
  });

  it("interpolates a smooth estimate between sparse integer-beat updates instead of stepping", () => {
    // 120bpm -> 0.5s/beat. Real update at beat 4; 250ms later (half a
    // beat, no new message yet) the estimate should read ~4.5, not still 4.
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });
    ticks.length = 0; // drop the exact-on-message tick, only care about the interpolated ones now

    vi.advanceTimersByTime(250);
    const midpoint = ticks[ticks.length - 1]?.beat ?? 0;
    expect(midpoint).toBeGreaterThan(4);
    expect(midpoint).toBeLessThan(5);
    expect(midpoint).toBeCloseTo(4.5, 1);

    unsub();
  });

  it("self-corrects to the real position on the next message rather than compounding drift", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });
    vi.advanceTimersByTime(250); // interpolating around ~4.5

    // A real update lands with a slightly different value than the estimate
    // would have predicted (e.g. Ableton's tempo isn't exactly 120) — the
    // next emitted tick must be exactly the real value, not a blend.
    abletonChangeListener?.({ abletonBeat: 5, isPlaying: true });
    expect(ticks[ticks.length - 1]?.beat).toBe(5);

    unsub();
  });

  it("stops extrapolating once paused, instead of drifting forward from a stale beat", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: false }); // paused
    ticks.length = 0;

    vi.advanceTimersByTime(1000); // would be 2 full beats further if still extrapolating
    expect(ticks).toHaveLength(0);

    unsub();
  });

  it("applies the song's beatOffset to both the exact and the interpolated position", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    song.beatOffset = 4;
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });
    expect(ticks[ticks.length - 1]?.beat).toBe(0); // 4 - offset(4)

    vi.advanceTimersByTime(250);
    expect(ticks[ticks.length - 1]?.beat).toBeCloseTo(0.5, 1); // 4.5 - offset(4)

    unsub();
  });
});

describe("TRANSPORT_CHANNEL_NAME", () => {
  it("is a stable, non-empty channel name shared with the popout window", () => {
    expect(typeof TRANSPORT_CHANNEL_NAME).toBe("string");
    expect(TRANSPORT_CHANNEL_NAME.length).toBeGreaterThan(0);
  });
});
