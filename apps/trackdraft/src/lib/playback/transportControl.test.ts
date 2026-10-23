import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BlueprintSong } from "../../types/blueprint";

// Mutable state the module-level mocks read, so tests can flip port/play
// state without re-importing the module.
const midiState = vi.hoisted(() => ({ midiOutputId: "port" as string, outputAvailable: true }));
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
  /** The external (Ableton) clock the running schedule is slaved to, if any. */
  activeClock: null as { id: string } | null,
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
}));
const output = vi.hoisted(() => ({ send: vi.fn() }));
/** Stand-in for the clock `abletonSyncClock` builds — identity is all the
 *  tests care about (does the stream/re-plan keep the same master?). */
const abletonSync = vi.hoisted(() => ({
  clock: { id: "ableton-clock" },
  createAbletonSyncClock: vi.fn(),
}));

vi.mock("./songTransport", () => ({ getSongTransport: () => transport }));
vi.mock("./liveMidiOut", () => ({
  getLiveMidiScheduler: () => scheduler,
  getMidiOutput: async () => (midiState.outputAvailable ? output : null),
}));
vi.mock("./abletonSyncClock", () => ({
  createAbletonSyncClock: (song: unknown) => {
    abletonSync.createAbletonSyncClock(song);
    return abletonSync.clock;
  },
}));
/** The bridge connection: only its "am I connected" answer and the tempo
 *  command matter here. */
const ableton = vi.hoisted(() => ({
  connected: false,
  sendCommand: vi.fn(),
}));
vi.mock("./abletonClock", () => ({
  getAbletonClock: () => ({
    connect: vi.fn(),
    getState: () => ({ connected: ableton.connected, abletonBeat: null, isPlaying: false }),
    sendCommand: ableton.sendCommand,
  }),
}));
vi.mock("../../store/midiSettingsStore", () => ({
  useMidiSettingsStore: {
    getState: () => ({
      midiOutputId: midiState.midiOutputId,
      latencyMs: 25,
      routing: {
        drums: { channel: 1 },
        bass: { channel: 2 },
        chords: { channel: 3 },
        color: { channel: 4 },
        melody: { channel: 5 },
      },
    }),
  },
}));
vi.mock("../../store/drumsDraftStore", () => ({
  useDrumsDraftStore: { getState: () => ({ sectionId: draftState.sectionId, section: draftState.section }) },
}));

const { liveRefresh, playSong } = await import("./transportControl");

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

describe("playSong under the Ableton clock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midiState.midiOutputId = "port";
    midiState.outputAvailable = true;
    scheduler.activeClock = null;
  });

  it("streams the song's parts locked to Live's own transport", async () => {
    const started = await playSong(song(), "live");

    expect(started).toBe(true);
    expect(transport.syncToAbleton).toHaveBeenCalledTimes(1);
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    const [, out, routing, opts] = scheduler.start.mock.calls[0];
    expect(out).toBe(output);
    expect(routing.drums.channel).toBe(1);
    expect(routing.melody.channel).toBe(5);
    // The clock is what makes the take land on Live's grid — without it the
    // stream would free-run against Live's transport again.
    expect(opts.clock).toBe(abletonSync.clock);
    expect(abletonSync.createAbletonSyncClock).toHaveBeenCalledTimes(1);
    expect((abletonSync.createAbletonSyncClock.mock.calls[0][0] as BlueprintSong).id).toBe("x");
  });

  it("follows Live without streaming when no MIDI port is selected", async () => {
    midiState.midiOutputId = "";
    const started = await playSong(song(), "live");

    expect(started).toBe(true);
    expect(transport.syncToAbleton).toHaveBeenCalledTimes(1);
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it("reports a stale port instead of pretending the stream started", async () => {
    midiState.outputAvailable = false; // the saved port id no longer resolves
    expect(await playSong(song(), "live")).toBe(false);
    expect(scheduler.start).not.toHaveBeenCalled();
    midiState.outputAvailable = true;
  });

  it("never retunes Live — under this target Live's tempo is the master", async () => {
    ableton.connected = true;
    await playSong(song(), "live");

    expect(ableton.sendCommand).not.toHaveBeenCalled();
  });
});

describe("playSong into another DAW", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midiState.midiOutputId = "port";
    midiState.outputAvailable = true;
    ableton.connected = false;
  });

  it("matches Live's tempo to the song's before streaming", async () => {
    // The app's clock places notes by the song's bpm, so a Live set at some
    // other tempo gets every part on a different beat each pass — 104bpm
    // notes against a 143bpm set reads as the clock being off.
    ableton.connected = true;
    await playSong(song(), "other");

    expect(ableton.sendCommand).toHaveBeenCalledWith("/live/song/set/tempo", [120]);
  });

  it("leaves the tempo alone when there's no bridge to send it to", async () => {
    ableton.connected = false;
    await playSong(song(), "other");

    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect(ableton.sendCommand).not.toHaveBeenCalled();
  });

  it("sends nothing at all for File only", async () => {
    ableton.connected = true;
    await playSong(song(), "file");

    expect(scheduler.start).not.toHaveBeenCalled();
    expect(ableton.sendCommand).not.toHaveBeenCalled();
  });
});

describe("liveRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midiState.midiOutputId = "port";
    midiState.outputAvailable = true;
    draftState.sectionId = null;
    draftState.section = null;
    scheduler.loopRegion = null;
    scheduler.activeClock = null;
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
    const [effective, out, routing, opts] = scheduler.start.mock.calls[0];
    expect(opts).toMatchObject({ startBeat: 16 });
    expect(out).toBe(output);
    expect(routing.drums.channel).toBe(1);
    expect(routing.color.channel).toBe(4);
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
    expect(opts).toMatchObject({ startBeat: 16, loopStart: 0, loopEnd: 16 });
  });

  it("keeps following Live when the re-plan lands (clock carried over)", async () => {
    scheduler.activeClock = abletonSync.clock;
    await liveRefresh(song());
    transport.onNextBar.mock.calls[0][0]();
    const [, , , opts] = scheduler.start.mock.calls[0];
    // Without this the re-planned stream would silently drop back to the
    // app's free-running clock and start drifting against Live again.
    expect(opts.clock).toBe(abletonSync.clock);
    expect(opts.startBeat).toBe(16);
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
    expect(opts).toMatchObject({ startBeat: 0, loopStart: 0, loopEnd: 16 });
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
