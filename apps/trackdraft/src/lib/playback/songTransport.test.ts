import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BlueprintSong, BlueprintSection, Chord } from "../../types/blueprint";

// requestAnimationFrame/cancelAnimationFrame are browser-only and don't
// exist in this (non-jsdom) test environment. Shim via `setTimeout`, which
// fake timers already control directly, at a plausible ~60fps interval.
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
// singleton — stub it so tests can simulate osc-bridge's sparse
// integer-beat messages directly.
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

  it("advances the beat position over time at the song's tempo", () => {
    // 120bpm -> 0.5s/beat. 2s in should read ~4 beats.
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(2000);

    expect(ticks[ticks.length - 1]?.beat).toBeCloseTo(4, 0);
    unsub();
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

  it("stops on its own at the end of the song", () => {
    const song = makeSong([makeSection({ id: "a", bars: 1, chords: [] })]); // 4 beats = 2s at 120bpm
    const ticks: { isPlaying: boolean }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(2500);

    expect(ticks[ticks.length - 1]?.isPlaying).toBe(false);
    expect(getSongTransport().getIsPlaying()).toBe(false);

    unsub();
  });

  it("stop() halts further tick emission", () => {
    const song = makeSong([makeSection({ id: "a", bars: 4, chords: [] })]);
    const ticks: unknown[] = [];
    getSongTransport().play(song);
    const unsub = getSongTransport().onTick((t) => ticks.push(t));
    getSongTransport().stop();

    vi.advanceTimersByTime(10_000);
    expect(ticks).toHaveLength(1); // just the stop() tick itself
    unsub();
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
