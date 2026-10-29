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

  it("seek: starts at startBeat instead of the top", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120); // 32 beats
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song, { startBeat: 8 });
    vi.advanceTimersByTime(500); // 1 beat at 120bpm
    expect(ticks[ticks.length - 1]?.beat).toBeCloseTo(9, 0);

    unsub();
  });

  it("loop: wraps within [loopStart, loopEnd) and never stops", () => {
    // One 4-bar section = 16 beats; loop beats 8..12 (a 4-beat region).
    const song = makeSong([makeSection({ id: "a", bars: 4, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song, { startBeat: 8, loopStart: 8, loopEnd: 12 });
    // 3.5s = 7 beats past beat 8 → would be 15 without the loop, but it
    // must fold back into [8, 12): 8 + ((15-8) mod 4) = 11.
    vi.advanceTimersByTime(3500);

    const last = ticks[ticks.length - 1]?.beat ?? -1;
    expect(last).toBeGreaterThanOrEqual(8);
    expect(last).toBeLessThan(12);
    expect(getSongTransport().getIsPlaying()).toBe(true); // still looping

    unsub();
  });

  it("loop to the song end still stops (no wrap when loopEnd reaches the end)", () => {
    const song = makeSong([makeSection({ id: "a", bars: 4, chords: [] })], 120); // 16 beats
    getSongTransport().play(song, { startBeat: 8, loopStart: 8, loopEnd: 16 });
    vi.advanceTimersByTime(5000); // 10 beats past beat 8 = beat 18 > 16 → stop
    expect(getSongTransport().getIsPlaying()).toBe(false);
  });

  it("forceLoop wraps a whole-song section forever instead of stopping", () => {
    // One 4-bar section = the entire 16-beat song; the section loop must
    // wrap back to 0 forever, not stop when it reaches the song end.
    const song = makeSong([makeSection({ id: "a", bars: 4, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song, { startBeat: 0, loopStart: 0, loopEnd: 16, forceLoop: true });
    vi.advanceTimersByTime(20_000); // 40 beats → would be beat 40 unlooped

    expect(getSongTransport().getIsPlaying()).toBe(true); // still looping
    const last = ticks[ticks.length - 1]?.beat ?? -1;
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThan(16); // folded back into the song

    unsub();
  });

  it("onNextBar fires once at the next bar boundary (getNextBarBeat is that boundary)", () => {
    // 120bpm, 0.5s/beat → bar boundary = beat 4 (2s in).
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const cb = vi.fn();

    getSongTransport().play(song);
    vi.advanceTimersByTime(500); // beat 1
    expect(getSongTransport().getNextBarBeat()).toBe(4);
    getSongTransport().onNextBar(cb);

    vi.advanceTimersByTime(1000); // beat 3 — not the boundary yet
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000); // beat 5 — crossed the boundary at 4
    expect(cb).toHaveBeenCalledTimes(1);

    // One-shot: further ticks must not re-fire it.
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("onNextBar queues a new callback after a previous one fired", () => {
    const song = makeSong([makeSection({ id: "a", bars: 16, chords: [] })], 120);
    getSongTransport().play(song);
    vi.advanceTimersByTime(500); // beat 1

    const first = vi.fn();
    getSongTransport().onNextBar(first); // next boundary = beat 4
    vi.advanceTimersByTime(2000); // beat 5 → first fires
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    expect(getSongTransport().getNextBarBeat()).toBe(8); // now at ~beat 5
    getSongTransport().onNextBar(second); // next boundary = beat 8
    vi.advanceTimersByTime(2000); // beat 9 → second fires
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("pause clears a queued next-bar callback so it never fires", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const cb = vi.fn();

    getSongTransport().play(song);
    vi.advanceTimersByTime(500); // beat 1
    getSongTransport().onNextBar(cb); // next boundary = beat 4
    vi.advanceTimersByTime(1000); // beat 3
    getSongTransport().pause(); // clears the queued callback
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("pause holds the beat and play() resumes from there (not the top)", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120); // 32 beats, 0.5s/beat
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(2000); // ~4 beats in
    getSongTransport().pause();
    const pausedBeat = ticks[ticks.length - 1]?.beat;
    expect(pausedBeat).toBeGreaterThan(3);
    expect(getSongTransport().getIsPlaying()).toBe(false);
    expect(getSongTransport().isPaused()).toBe(true);

    // Time passing while paused must not move the playhead.
    vi.advanceTimersByTime(5000);
    expect(getSongTransport().isPaused()).toBe(true);
    expect(getSongTransport().getIsPlaying()).toBe(false);

    // Resume without an explicit startBeat → continues from the held beat.
    getSongTransport().play(song);
    vi.advanceTimersByTime(500); // +1 beat
    expect(ticks[ticks.length - 1]?.beat).toBeCloseTo((pausedBeat ?? 0) + 1, 0);
    expect(getSongTransport().isPaused()).toBe(false);

    unsub();
  });

  it("stop clears the paused position so play restarts from the top", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    const ticks: { beat: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(2000);
    getSongTransport().pause();
    expect(getSongTransport().isPaused()).toBe(true);

    getSongTransport().stop();
    expect(getSongTransport().isPaused()).toBe(false);

    getSongTransport().play(song); // must start over
    vi.advanceTimersByTime(1000); // 2 beats
    expect(ticks[ticks.length - 1]?.beat).toBeCloseTo(2, 0);

    unsub();
  });

  it("pause is a no-op when not playing", () => {
    getSongTransport().pause();
    expect(getSongTransport().isPaused()).toBe(false);
    expect(getSongTransport().getIsPlaying()).toBe(false);
  });

  it("getBeat() reports the live playhead while playing, the paused beat when paused, 0 when stopped", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120); // 0.5s/beat
    getSongTransport().play(song);
    vi.advanceTimersByTime(1000); // 2 beats
    expect(getSongTransport().getBeat()).toBeCloseTo(2, 0);

    getSongTransport().pause();
    const paused = getSongTransport().getBeat();
    expect(paused).toBeCloseTo(2, 0);
    expect(getSongTransport().isPaused()).toBe(true);

    getSongTransport().stop();
    expect(getSongTransport().getBeat()).toBe(0);
    expect(getSongTransport().getIsPlaying()).toBe(false);
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

  it("reports the followed position from getBeat, not the app's idle wall clock", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 12, isPlaying: true });

    // The app's own clock was never started in this mode, so a stale
    // `startedAtMs` would report a huge nonsense beat here.
    expect(getSongTransport().getBeat()).toBe(12);
    expect(getSongTransport().getNextBarBeat()).toBe(16); // next 4/4 bar
  });

  it("lands a bar-staged live edit on the bar, using the interpolated clock", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    getSongTransport().syncToAbleton(song);
    abletonChangeListener?.({ abletonBeat: 4, isPlaying: true });

    const onBar = vi.fn();
    getSongTransport().onNextBar(onBar); // queue for beat 8

    // 4 beats at 120bpm = 2000ms, reached purely by interpolation — the
    // bridge's next whole-beat message is never involved.
    vi.advanceTimersByTime(1900);
    expect(onBar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onBar).toHaveBeenCalledTimes(1);
  });
});

describe("SongTransport tick identity and delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The Ableton-following block above leaves the singleton slaved to Live
    // (stop() deliberately keeps that connection), and play() refuses to
    // start under it — put the app's own clock back.
    getSongTransport().clockSource = "internal";
  });

  afterEach(() => {
    getSongTransport().stop();
    vi.useRealTimers();
  });

  it("carries the span's id and repeat pass alongside the index", () => {
    const song = makeSong([
      makeSection({ id: "a", bars: 2, chords: [] }),
      makeSection({ id: "b", bars: 2, chords: [] }),
    ]);
    const ticks: { beat: number; sectionIndex: number; sectionId?: string | null; occurrenceIndex?: number }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(100);
    expect(ticks[ticks.length - 1]).toMatchObject({ sectionIndex: 0, sectionId: "a", occurrenceIndex: 0 });

    vi.advanceTimersByTime(4000);
    expect(ticks[ticks.length - 1]).toMatchObject({ sectionIndex: 1, sectionId: "b", occurrenceIndex: 0 });

    unsub();
  });

  it("updateSong re-points ticks at the edited arrangement without moving the playhead", () => {
    // `a` is 4 bars (16 beats) and `b` follows it.
    const song = makeSong([
      makeSection({ id: "a", bars: 4, chords: [] }),
      makeSection({ id: "b", bars: 4, chords: [] }),
    ]);
    const ticks: { beat: number; sectionId?: string | null }[] = [];
    const unsub = getSongTransport().onTick((t) => ticks.push(t));

    getSongTransport().play(song);
    vi.advanceTimersByTime(6000); // beat 12, inside `a`

    // `a` is trimmed to 1 bar while playing: beat 12 now belongs to `b`
    // (which still runs to beat 20, so playback does not end here).
    const edited = makeSong([
      makeSection({ id: "a", bars: 1, chords: [] }),
      makeSection({ id: "b", bars: 4, chords: [] }),
    ]);
    getSongTransport().updateSong(edited);
    vi.advanceTimersByTime(100);

    expect(ticks[ticks.length - 1].sectionId).toBe("b");
    // The playhead itself did not jump: only the mapping changed.
    expect(getSongTransport().getBeat()).toBeCloseTo(12.2, 0);

    unsub();
  });

  it("updateSong keeps the beat continuous across a tempo change", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 120);
    getSongTransport().play(song);
    vi.advanceTimersByTime(2000); // beat 4 at 120bpm
    const before = getSongTransport().getBeat();

    getSongTransport().updateSong(makeSong([makeSection({ id: "a", bars: 8, chords: [] })], 60));
    expect(getSongTransport().getBeat()).toBeCloseTo(before, 1);

    // At half the tempo the next 2s advance only 2 beats, not 4.
    vi.advanceTimersByTime(2000);
    expect(getSongTransport().getBeat()).toBeCloseTo(before + 2, 0);
  });

  it("delivers a listener's stop tick after the tick it interrupted", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })]);
    const seen: string[] = [];
    const label = (playing: boolean) => (playing ? "playing" : "stopped");

    const stopper = getSongTransport().onTick((t) => {
      seen.push(`stopper:${label(t.isPlaying)}`);
      if (t.isPlaying && seen.length === 1) getSongTransport().stop();
    });
    const watcher = getSongTransport().onTick((t) => seen.push(`watcher:${label(t.isPlaying)}`));

    getSongTransport().play(song);
    vi.advanceTimersByTime(100);

    stopper();
    watcher();
    // Everyone sees the playing tick before anyone sees the stop it caused.
    expect(seen).toEqual(["stopper:playing", "watcher:playing", "stopper:stopped", "watcher:stopped"]);
  });

  it("isolates a throwing listener so the other playheads keep moving", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })]);
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const beats: number[] = [];

    const bad = getSongTransport().onTick(() => {
      throw new Error("boom");
    });
    const good = getSongTransport().onTick((t) => beats.push(t.beat));

    getSongTransport().play(song);
    vi.advanceTimersByTime(1000);

    bad();
    good();

    expect(beats.length).toBeGreaterThan(1);
    // Asserted before restoring: mockRestore clears the recorded calls.
    expect(reported).toHaveBeenCalled();
    reported.mockRestore();
  });

  it("cancelNextBar drops a queued on-grid callback but keeps playing", () => {
    const song = makeSong([makeSection({ id: "a", bars: 8, chords: [] })]);
    const onBar = vi.fn();
    getSongTransport().play(song);
    getSongTransport().onNextBar(onBar);
    getSongTransport().cancelNextBar();

    vi.advanceTimersByTime(3000);
    expect(onBar).not.toHaveBeenCalled();
    expect(getSongTransport().getIsPlaying()).toBe(true);
  });
});

describe("TRANSPORT_CHANNEL_NAME", () => {
  it("is a stable, non-empty channel name shared with the popout window", () => {
    expect(typeof TRANSPORT_CHANNEL_NAME).toBe("string");
    expect(TRANSPORT_CHANNEL_NAME.length).toBeGreaterThan(0);
  });
});
