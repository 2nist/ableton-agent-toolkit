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
    vi.advanceTimersByTime(0); // flush the offset-0 setTimeout for section A's chord
    expect(playChordObject).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000); // 8 beats at 120bpm = 4s
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

describe("TRANSPORT_CHANNEL_NAME", () => {
  it("is a stable, non-empty channel name shared with the popout window", () => {
    expect(typeof TRANSPORT_CHANNEL_NAME).toBe("string");
    expect(TRANSPORT_CHANNEL_NAME.length).toBeGreaterThan(0);
  });
});
