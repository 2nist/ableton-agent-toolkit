import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BlueprintSong } from "../../types/blueprint";

// Mutable state the module-level mocks read, so tests can flip port/play
// state without re-importing the module.
const midiState = vi.hoisted(() => ({ midiOutputId: "port" as string }));
const draftState = vi.hoisted(() => ({
  sectionId: "s1" as string | null,
  section: null as { id: string; drumPattern: string } | null,
}));

const transport = vi.hoisted(() => ({
  getIsPlaying: vi.fn(() => true),
  getBeat: vi.fn(() => 12.5),
  getNextBarBeat: vi.fn(() => 16),
  onNextBar: vi.fn(),
  isPaused: vi.fn(() => false),
  getPausedBeat: vi.fn(() => null),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  syncToAbleton: vi.fn(),
  clockSource: "internal" as const,
}));
const scheduler = vi.hoisted(() => ({
  isRunning: true,
  loopRegion: null as { start: number; end: number } | null,
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
}));
const output = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("./songTransport", () => ({ getSongTransport: () => transport }));
vi.mock("./liveMidiOut", () => ({ getLiveMidiScheduler: () => scheduler, getMidiOutput: async () => output }));
vi.mock("../../store/midiSettingsStore", () => ({
  useMidiSettingsStore: { getState: () => ({ midiOutputId: midiState.midiOutputId, channels: { drums: 1, bass: 2, chords: 3, color: 4, melody: 5 } }) },
}));
vi.mock("../../store/drumsDraftStore", () => ({
  useDrumsDraftStore: { getState: () => ({ sectionId: draftState.sectionId, section: draftState.section }) },
}));

const { liveRefresh } = await import("./transportControl");

function song(): BlueprintSong {
  return {
    id: "x",
    title: "x",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      { id: "s1", name: "V", role: "verse", bars: 4, chords: [], beatsPerChord: 4, velocity: "mf", timeSignatureNumerator: 4, timeSignatureDenPower: 2 },
    ],
    arrangement: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("liveRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midiState.midiOutputId = "port";
    draftState.sectionId = null;
    draftState.section = null;
    scheduler.loopRegion = null;
  });

  it("stages a re-plan at the next bar instead of re-planning immediately", async () => {
    await liveRefresh(song());

    // No immediate re-plan — the edit waits for the bar boundary.
    expect(scheduler.start).not.toHaveBeenCalled();
    // A boundary callback was queued at the next bar beat.
    expect(transport.onNextBar).toHaveBeenCalledTimes(1);
    expect(transport.getNextBarBeat).toHaveBeenCalled();

    // Fire the boundary callback (simulates the bar arriving) → the staged
    // song is re-planned from the boundary beat.
    const cb = transport.onNextBar.mock.calls[0][0];
    cb();
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    const [effective, out, channels, opts] = scheduler.start.mock.calls[0];
    expect(opts).toEqual({ startBeat: 16 });
    expect(out).toBe(output);
    expect(channels).toEqual({ drums: 1, bass: 2, chords: 3, color: 4, melody: 5 });
    expect((effective as BlueprintSong).id).toBe("x");
  });

  it("applies the drums draft heard before Apply, only when the bar arrives", async () => {
    draftState.sectionId = "s1";
    draftState.section = { id: "s1", drumPattern: "intense" };

    await liveRefresh(song());
    const cb = transport.onNextBar.mock.calls[0][0];
    cb();
    const [effective] = scheduler.start.mock.calls[0];
    expect((effective as BlueprintSong).sections[0].drumPattern).toBe("intense");
  });

  it("coalesces multiple edits within a bar into a single re-plan (latest song wins)", async () => {
    const first = song();
    const second = { ...song(), title: "edited" };

    await liveRefresh(first);
    await liveRefresh(second);

    // Still only one boundary callback queued…
    expect(transport.onNextBar).toHaveBeenCalledTimes(1);
    // …and it re-plans with the latest song.
    const cb = transport.onNextBar.mock.calls[0][0];
    cb();
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect((scheduler.start.mock.calls[0][0] as BlueprintSong).title).toBe("edited");
  });

  it("preserves an active section loop when re-planning", async () => {
    scheduler.loopRegion = { start: 0, end: 16 };
    await liveRefresh(song());
    transport.onNextBar.mock.calls[0][0]();
    const [, , , opts] = scheduler.start.mock.calls[0];
    expect(opts).toEqual({ startBeat: 16, loopStart: 0, loopEnd: 16 });
  });

  it("no-ops when the transport is not playing", async () => {
    transport.getIsPlaying.mockReturnValue(false);
    await liveRefresh(song());
    expect(transport.onNextBar).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it("no-ops when no MIDI port is selected", async () => {
    midiState.midiOutputId = "";
    await liveRefresh(song());
    expect(transport.onNextBar).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it("no-ops when the scheduler is not running", async () => {
    scheduler.isRunning = false;
    await liveRefresh(song());
    expect(transport.onNextBar).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
    scheduler.isRunning = true;
  });
});

describe("playSectionLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midiState.midiOutputId = "port";
  });

  it("seeks to the section span and loops it", async () => {
    const { playSectionLoop } = await import("./transportControl");
    const ok = await playSectionLoop(song(), "s1");
    expect(ok).toBe(true);
    // Transport starts the section span as a loop (forceLoop lets a span
    // that covers the whole song wrap forever too).
    expect(transport.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: "x" }),
      { startBeat: 0, loopStart: 0, loopEnd: 16, forceLoop: true },
    );
    // Scheduler mirrors the same loop region (no transport-only flag).
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    const [, , , opts] = scheduler.start.mock.calls[0];
    expect(opts).toEqual({ startBeat: 0, loopStart: 0, loopEnd: 16 });
  });

  it("falls back to the first section when the id is unknown", async () => {
    const { playSectionLoop } = await import("./transportControl");
    const ok = await playSectionLoop(song(), "nope");
    expect(ok).toBe(true);
    expect(transport.play).toHaveBeenCalledWith(
      expect.anything(),
      { startBeat: 0, loopStart: 0, loopEnd: 16, forceLoop: true },
    );
  });

  it("runs a silent playhead when no MIDI port is set", async () => {
    midiState.midiOutputId = "";
    const { playSectionLoop } = await import("./transportControl");
    const ok = await playSectionLoop(song(), "s1");
    expect(ok).toBe(true);
    expect(scheduler.start).not.toHaveBeenCalled();
  });
});
