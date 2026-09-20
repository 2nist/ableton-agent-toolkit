import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_LIVE_MIDI_CHANNELS, getLiveMidiScheduler, sendTestNote, type SchedulerClock } from "./liveMidiOut";
import type { BlueprintSong } from "../../types/blueprint";

/** Minimal MIDIOutput double — records the byte arrays + timestamps sent. */
class FakeOutput {
  sent: number[][] = [];
  send(data: Uint8Array | number[], when?: number): void {
    this.sent.push([...(data as number[]), when ?? 0]);
  }
}

describe("sendTestNote", () => {
  it("sends a note-on then note-off on the requested 1-based channel", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 3, 60, 100);

    expect(out.sent.length).toBe(2);
    const [noteOn, noteOff] = out.sent;

    // Note on: 0x90 | (channel-1). Channel 3 → wire 2 → 0x92.
    expect(noteOn![0] & 0xf0).toBe(0x90);
    expect((noteOn![0] & 0x0f) + 1).toBe(3);
    expect(noteOn![1]).toBe(60);
    expect(noteOn![2]).toBe(100);

    // Note off: 0x80 | (channel-1), zero velocity.
    expect(noteOff![0] & 0xf0).toBe(0x80);
    expect((noteOff![0] & 0x0f) + 1).toBe(3);
    expect(noteOff![1]).toBe(60);
    expect(noteOff![2]).toBe(0);
  });

  it("clamps channels outside 1-16 into range", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 99);
    const [noteOn] = out.sent;
    expect((noteOn![0] & 0x0f) + 1).toBe(16);

    const low = new FakeOutput();
    sendTestNote(low as unknown as MIDIOutput, 0);
    const [noteOnLow] = low.sent;
    expect((noteOnLow![0] & 0x0f) + 1).toBe(1);
  });

  it("clamps velocity and pitch to MIDI ranges", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 1, 999, 999);
    const [noteOn] = out.sent;
    expect(noteOn![1]).toBe(127); // pitch & 0x7f
    expect(noteOn![2]).toBe(127); // velocity clamped
  });
});

/** A clock the test drives by hand: positions and timestamps are whatever we
 *  say, so assertions are exact instead of wall-clock dependent. Moving
 *  `originMs` is exactly what a fresh beat message from the bridge does — the
 *  master announcing where it is, right now. */
class FakeClock implements SchedulerClock {
  pos: number | null = 0;
  /** Wall-clock ms that song beat 0 maps to. */
  originMs = 10_000;
  msPerBeat = 500;
  disposed = false;
  position(): number | null {
    return this.pos;
  }
  timeAt(beat: number): number {
    return this.originMs + beat * this.msPerBeat;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** 16 bars of one 4-beat chord — long enough that a resume well into the
 *  song still has notes to play, short enough to stay readable. */
function song(): BlueprintSong {
  return {
    id: "s",
    title: "s",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: "s1",
        name: "V",
        role: "verse",
        bars: 16,
        chords: [{ id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 }],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
    ],
    arrangement: [],
    createdAt: "",
    updatedAt: "",
  };
}

/** Note-on messages only: [status, pitch, velocity, when]. */
function noteOns(out: FakeOutput): number[][] {
  return out.sent.filter((m) => (m[0]! & 0xf0) === 0x90);
}

/** The song beat a sent message was scheduled for, per the fake clock. */
function beatOf(message: number[], clock: FakeClock): number {
  return (message[3]! - clock.originMs) / clock.msPerBeat;
}

function allNotesOff(out: FakeOutput): number[][] {
  return out.sent.filter((m) => (m[0]! & 0xf0) === 0xb0 && m[1] === 123);
}

describe("LiveMidiScheduler under an external clock", () => {
  const scheduler = getLiveMidiScheduler();
  const channels = DEFAULT_LIVE_MIDI_CHANNELS;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  /** Walk the master forward in half-beat steps, ticking the scheduler as a
   *  real streaming pass would. */
  function run(clock: FakeClock, toBeat: number, step = 0.5): void {
    for (let pos = 0; pos <= toBeat + 1e-9; pos += step) {
      clock.pos = pos;
      vi.advanceTimersByTime(50);
    }
  }

  it("times every note off the clock it was given, not the app's own", () => {
    const first = new FakeOutput();
    const clockA = new FakeClock();
    scheduler.start(song(), first as unknown as MIDIOutput, channels, { clock: clockA });
    run(clockA, 8);
    scheduler.stop();

    const second = new FakeOutput();
    const clockB = new FakeClock();
    clockB.originMs = 21_000; // same song, a different anchor in Live
    scheduler.start(song(), second as unknown as MIDIOutput, channels, { clock: clockB });
    run(clockB, 8);
    scheduler.stop();

    const a = noteOns(first).map((m) => m[3]!);
    const b = noteOns(second).map((m) => m[3]!);
    expect(a.length).toBeGreaterThan(4);
    // Identical notes, every timestamp moved by exactly the anchor's shift —
    // the scheduler is reading the clock, not its own wall clock.
    expect(b).toEqual(a.map((t) => t + 11_000));
  });

  it("moves the notes after a beat correction and never accumulates one", () => {
    /** Two identical runs; the second gets a 30ms-late beat message at beat
     *  2 — a new anchor, not a slower transport. */
    function runWithDrift(drift: boolean): { times: number[]; prefix: number } {
      const out = new FakeOutput();
      const clock = new FakeClock();
      scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });
      let prefix = 0;
      for (let pos = 0; pos <= 4 + 1e-9; pos += 0.5) {
        clock.pos = pos;
        if (pos === 2) {
          prefix = noteOns(out).length; // everything scheduled before the correction
          if (drift) clock.originMs += 30;
        }
        vi.advanceTimersByTime(50);
      }
      scheduler.stop();
      return { times: noteOns(out).map((m) => m[3]!), prefix };
    }

    const base = runWithDrift(false);
    const drifted = runWithDrift(true);

    expect(drifted.times.length).toBe(base.times.length);
    expect(drifted.times.slice(0, drifted.prefix)).toEqual(base.times.slice(0, base.prefix));
    // Everything after the correction rides the new anchor exactly — no
    // leftover lag, and the 30ms isn't carried into the following beats.
    expect(drifted.times.slice(drifted.prefix)).toEqual(base.times.slice(base.prefix).map((t) => t + 30));
  });

  it("silences and waits while the master has no position, then resumes where it is", () => {
    const out = new FakeOutput();
    const clock = new FakeClock();
    scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });

    run(clock, 2);
    expect(noteOns(out).length).toBeGreaterThan(0);

    out.sent.length = 0;
    clock.pos = null; // Live's transport stopped
    vi.advanceTimersByTime(200);
    expect(noteOns(out)).toHaveLength(0);
    expect(allNotesOff(out).length).toBeGreaterThan(0);

    out.sent.length = 0;
    clock.pos = 20; // …and started again, later in the song
    vi.advanceTimersByTime(200);
    const resumed = noteOns(out);
    expect(resumed.length).toBeGreaterThan(0);
    // Everything comes from around the new position: no catch-up burst of
    // notes from the beats we skipped over while it was stopped.
    for (const m of resumed) expect(beatOf(m, clock)).toBeGreaterThan(19.5);
  });

  it("rebases on a backward seek instead of stalling on the old window", () => {
    const out = new FakeOutput();
    const clock = new FakeClock();
    scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });
    run(clock, 6);

    out.sent.length = 0;
    clock.pos = 4; // Live's loop wrapped back to the top of the phrase
    vi.advanceTimersByTime(200);

    // The abandoned window is silenced…
    expect(allNotesOff(out).length).toBeGreaterThan(0);
    // …and the schedule picks up from the position Live actually went back
    // to, rather than waiting for the old high-water mark.
    const replayed = noteOns(out);
    expect(replayed.length).toBeGreaterThan(0);
    for (const m of replayed) expect(beatOf(m, clock)).toBeLessThanOrEqual(4.8);
  });

  it("ignores sub-beat re-anchors instead of silencing on every beat (live-sync stutter)", () => {
    const out = new FakeOutput();
    const clock = new FakeClock();
    scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });

    // Walk forward, but dip the position a hair once per beat — what a
    // late beat message re-anchoring behind the interpolation looks like.
    // The old behavior treated every dip as a seek: all-notes-off plus a
    // full rebase each beat, chopping sustained notes into per-beat stubs.
    for (let pos = 0.5; pos <= 6 + 1e-9; pos += 0.5) {
      clock.pos = pos;
      vi.advanceTimersByTime(50);
      clock.pos = pos - 0.12;
      vi.advanceTimersByTime(50);
    }

    // No silencing while the stream stays continuous…
    expect(allNotesOff(out)).toHaveLength(0);
    // …and the notes still flow across the whole run.
    expect(noteOns(out).length).toBeGreaterThan(4);
  });

  it("keeps a clock handed back to a re-plan, and disposes it on stop", () => {
    const out = new FakeOutput();
    const clock = new FakeClock();
    scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });
    expect(scheduler.activeClock).toBe(clock);

    // A staged live re-plan restarts with the same clock (see
    // transportControl.liveRefresh). It has to survive that, or the re-plan
    // disposes the very subscription it is still following.
    scheduler.start(song(), out as unknown as MIDIOutput, channels, { clock });
    expect(clock.disposed).toBe(false);
    expect(scheduler.activeClock).toBe(clock);

    scheduler.stop();
    expect(clock.disposed).toBe(true);
    expect(scheduler.activeClock).toBeNull();
  });

  it("reports no external clock when the app's own clock is driving", () => {
    const out = new FakeOutput();
    scheduler.start(song(), out as unknown as MIDIOutput, channels);
    expect(scheduler.activeClock).toBeNull();
  });
});
