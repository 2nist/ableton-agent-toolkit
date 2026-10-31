import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MidiClockSender,
  MIDI_CLOCK_CONTINUE,
  MIDI_CLOCK_PPQ,
  MIDI_CLOCK_START,
  MIDI_CLOCK_STOP,
  MIDI_CLOCK_TICK,
  createWallClock,
  firstTickAfter,
  songPositionMessage,
} from "./midiClockOut";
import type { SchedulerClock } from "./liveMidiOut";

interface Sent {
  data: number[];
  at?: number;
}

/** A MIDIOutput stand-in that records what left the port. */
function fakePort(): { output: MIDIOutput; sent: Sent[]; readonly ticks: Sent[] } {
  const sent: Sent[] = [];
  const output = {
    send(data: number[], at?: number) {
      sent.push(at === undefined ? { data: [...data] } : { data: [...data], at });
    },
  } as unknown as MIDIOutput;
  return {
    output,
    sent,
    // A live view: the sender keeps writing after the port is handed over.
    get ticks() {
      return sent.filter((m) => m.data[0] === MIDI_CLOCK_TICK);
    },
  };
}

/** A clock whose position we advance by hand, so a test can walk real time
 *  forward without depending on wall-clock drift. */
function manualClock(bpm: number, startBeat = 0) {
  const secPerBeat = 60 / bpm;
  const state = { ms: 0 };
  const clock: SchedulerClock = {
    position: () => startBeat + state.ms / 1000 / secPerBeat,
    timeAt: (beat) => (beat - startBeat) * secPerBeat * 1000,
  };
  return {
    clock,
    get ms() {
      return state.ms;
    },
    advance(ms: number) {
      state.ms += ms;
    },
  };
}

describe("songPositionMessage", () => {
  it("counts sixteenth notes in a 14-bit pair", () => {
    expect(songPositionMessage(0)).toEqual([0xf2, 0, 0]);
    expect(songPositionMessage(4)).toEqual([0xf2, 16, 0]);
    expect(songPositionMessage(1)).toEqual([0xf2, 4, 0]);
  });

  it("splits past the 7-bit boundary", () => {
    // 32 beats = 128 sixteenths → low 0, high 1.
    expect(songPositionMessage(32)).toEqual([0xf2, 0, 1]);
  });

  it("clamps nonsense instead of writing out-of-range bytes", () => {
    expect(songPositionMessage(-5)).toEqual([0xf2, 0, 0]);
    const huge = songPositionMessage(1e6);
    expect(huge[1]! & ~0x7f).toBe(0);
    expect(huge[2]! & ~0x7f).toBe(0);
    expect(huge[2]).toBe(0x7f); // clamped at the 14-bit ceiling
  });
});

describe("MidiClockSender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends Song Position 0 then Start when starting from the top", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const { clock } = manualClock(120);
    sender.start({ output: port.output, clock, bpm: 120 });
    expect(port.sent[0]!.data).toEqual([0xf2, 0, 0]);
    expect(port.sent[1]!.data).toEqual([MIDI_CLOCK_START]);
    sender.stop(false);
  });

  it("sends the position then Continue when resuming mid-song", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const { clock } = manualClock(120, 8);
    sender.start({ output: port.output, clock, bpm: 120, startBeat: 8 });
    // 8 beats = 32 sixteenths → low 32, high 0.
    expect(port.sent[0]!.data).toEqual([0xf2, 32, 0]);
    expect(port.sent[1]!.data).toEqual([MIDI_CLOCK_CONTINUE]);
    sender.stop(false);
  });

  it("clocks at 24 ticks per quarter note, evenly spaced", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const manual = manualClock(120);
    sender.start({ output: port.output, clock: manual.clock, bpm: 120 });

    // Walk one second of song time in 25 ms scheduler wake-ups.
    for (let i = 0; i < 40; i++) {
      manual.advance(25);
      vi.advanceTimersByTime(25);
    }

    // 120 BPM → two beats per second → 48 ticks.
    const due = port.ticks.filter((t) => (t.at ?? 0) <= manual.ms + 1);
    expect(due.length).toBeGreaterThanOrEqual(48);
    expect(due.length).toBeLessThanOrEqual(49);

    // Even spacing: the step is secPerBeat/24 = 20.833 ms.
    const stamps = port.ticks.map((t) => t.at!).sort((a, b) => a - b);
    const step = 60000 / 120 / MIDI_CLOCK_PPQ;
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeCloseTo(step, 6);
    }
    sender.stop(false);
  });

  it("never repeats or skips a tick across late wake-ups", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const manual = manualClock(120);
    sender.start({ output: port.output, clock: manual.clock, bpm: 120 });

    // A throttled tab: one very late wake-up after half a second.
    manual.advance(500);
    vi.advanceTimersByTime(500);

    const beats = port.ticks.map((t) => Math.round((t.at! / (60000 / 120)) * MIDI_CLOCK_PPQ));
    const unique = new Set(beats);
    expect(unique.size).toBe(beats.length); // no duplicates
    // The grid is contiguous from the start, so nothing was skipped either.
    for (let i = 1; i < beats.length; i++) expect(beats[i]! - beats[i - 1]!).toBe(1);
    sender.stop(false);
  });

  it("applies the calibrated latency to every tick", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const manual = manualClock(120);
    sender.start({ output: port.output, clock: manual.clock, bpm: 120, latencyMs: 40 });

    manual.advance(200);
    vi.advanceTimersByTime(200);

    const stamps = port.ticks.map((t) => t.at!).sort((a, b) => a - b);
    expect(stamps.length).toBeGreaterThan(4);
    // First tick is beat 0 → timeAt(0) = 0, plus 40 ms.
    expect(stamps[0]).toBeCloseTo(40, 6);
    sender.stop(false);
  });

  it("tells the receiver to stop, and only once", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const manual = manualClock(120);
    sender.start({ output: port.output, clock: manual.clock, bpm: 120 });
    expect(sender.isRunning).toBe(true);

    sender.stop();
    expect(sender.isRunning).toBe(false);
    expect(port.sent.filter((m) => m.data[0] === MIDI_CLOCK_STOP).length).toBe(1);

    // Nothing more leaves the port once stopped.
    const before = port.sent.length;
    manual.advance(500);
    vi.advanceTimersByTime(500);
    expect(port.sent.length).toBe(before);
  });

  it("holds (stop, no ticks) while the clock reports no position, then resumes", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    let position: number | null = 0;
    const clock: SchedulerClock = {
      position: () => position,
      timeAt: (beat) => beat * 500,
    };
    sender.start({ output: port.output, clock, bpm: 120 });

    position = null;
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    expect(port.sent.filter((m) => m.data[0] === MIDI_CLOCK_STOP).length).toBe(1);

    const ticksWhileHeld = port.ticks.length;
    vi.advanceTimersByTime(200);
    expect(port.ticks.length).toBe(ticksWhileHeld);

    position = 4;
    vi.advanceTimersByTime(50);
    const resumeMarkers = port.sent.filter(
      (m) => m.data[0] === MIDI_CLOCK_CONTINUE || m.data[0] === 0xf2,
    );
    expect(resumeMarkers.length).toBeGreaterThanOrEqual(2); // SPP + Continue
    expect(port.ticks.length).toBeGreaterThan(ticksWhileHeld);
    sender.stop(false);
  });

  it("resynchronises the receiver after a backwards jump", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    let position = 4;
    const clock: SchedulerClock = {
      position: () => position,
      timeAt: (beat) => beat * 500,
    };
    sender.start({ output: port.output, clock, bpm: 120, startBeat: 4 });
    vi.advanceTimersByTime(100);

    const sppBefore = port.sent.filter((m) => m.data[0] === 0xf2).length;
    position = 1; // a loop wrap back to beat 1
    vi.advanceTimersByTime(50);
    const sppAfter = port.sent.filter((m) => m.data[0] === 0xf2);
    expect(sppAfter.length).toBeGreaterThan(sppBefore);
    expect(sppAfter[sppAfter.length - 1]!.data).toEqual([0xf2, 4, 0]); // beat 1 = 4 sixteenths
    sender.stop(false);
  });

  it("stops itself when the port throws instead of failing playback", () => {
    const output = {
      send() {
        throw new Error("port gone");
      },
    } as unknown as MIDIOutput;
    const sender = new MidiClockSender();
    const manual = manualClock(120);
    // A dead clock port must not fail the transport action that started
    // playback — the song plays, only the clock is missing.
    expect(() => sender.start({ output, clock: manual.clock, bpm: 120 })).not.toThrow();
    expect(sender.isRunning).toBe(false);
  });

  it("re-anchors to a new clock without restarting the receiver", () => {
    const port = fakePort();
    const sender = new MidiClockSender();
    const first = manualClock(120);
    sender.start({ output: port.output, clock: first.clock, bpm: 120 });
    first.advance(200);
    vi.advanceTimersByTime(200);

    const markersBefore = port.sent.filter((m) => m.data[0] === 0xf2 || m.data[0] === MIDI_CLOCK_START).length;
    const second = manualClock(120, 16);
    sender.reanchor(second.clock, 16);
    second.advance(100);
    vi.advanceTimersByTime(100);

    // No new Start/SPP: a re-plan mid-song must not restart the DAW.
    const markersAfter = port.sent.filter((m) => m.data[0] === 0xf2 || m.data[0] === MIDI_CLOCK_START).length;
    expect(markersAfter).toBe(markersBefore);
    expect(sender.isRunning).toBe(true);
    sender.stop(false);
  });
});

describe("firstTickAfter", () => {
  it("opens strictly after the window start, so a tick is never re-sent", () => {
    expect(firstTickAfter(0)).toBe(1);
    expect(firstTickAfter(10.4)).toBe(11);
    expect(firstTickAfter(11)).toBe(12);
  });
});

describe("createWallClock", () => {
  it("advances at the song's tempo from the given beat", () => {
    const now = performance.now();
    const clock = createWallClock(120, 4, now);
    expect(clock.position()).toBeCloseTo(4, 1);
    // Even spacing: beat 6 is one second after beat 4 at 120 BPM.
    expect(clock.timeAt(6)).toBeCloseTo(now + 1000, 1);
  });
});
