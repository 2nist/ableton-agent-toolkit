import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbletonClockState } from "./abletonClock";
import { DEFAULT_LIVE_MIDI_CHANNELS, getLiveMidiScheduler } from "./liveMidiOut";
import { sectionSpans } from "../arrangement";
import { planBassStem, planChordStem, planDrumStem, type MidiNote } from "../midiExport";
import { planColorStem } from "../colorStem";
import type { BlueprintSong } from "../../types/blueprint";

/**
 * Where did the streamed notes actually land?
 *
 * The bridge pushes Ableton's position one *whole beat* at a time, so the
 * clock interpolates between messages; the scheduler then schedules against
 * that interpolation 400 ms ahead. Every piece of that is defensible in a
 * comment and impossible to trust without a number, and until now the only
 * thing proving the handoff was `parity.test.ts` — which proves the bridge and
 * the app agree on *which* notes, never *when*.
 *
 * This file is the number. A real `AbletonSyncClock` is fed jittery beat
 * messages at virtual times, a real `LiveMidiScheduler` consumes it, and every
 * note-on that leaves the fake port is mapped back onto the score's own grid.
 * The error is measured in milliseconds, the distribution is printed, and a
 * regression fails the build.
 *
 * Everything here is deterministic: `performance.now` is the test's own
 * counter, and the scheduler's 50 ms poll is a fake timer — so these
 * assertions are exact rather than wall-clock dependent.
 */

type Listener = (state: AbletonClockState) => void;
const bridge = vi.hoisted(() => ({
  connect: vi.fn(),
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

/** The virtual wall clock shared by the bridge, the clock and the scheduler. */
let nowMs = 0;

const TRUE_MS_PER_BEAT = 500; // 120 bpm — Live's tempo, which is the master's
const TICK_MS = 50; // SCHEDULER_INTERVAL_MS
const SONG_BEAT_0_AT_MS = 0;

function emitBeat(atMs: number, abletonBeat: number, isPlaying = true): void {
  nowMs = atMs;
  bridge.listener?.({
    connected: true,
    abletonBeat,
    isPlaying,
    liveError: null,
  });
}

class FakeOutput {
  /** [status, pitch, velocity, whenMs] */
  sent: number[][] = [];
  send(data: Uint8Array | number[], when?: number): void {
    this.sent.push([...(data as number[]), when ?? 0]);
  }
  get noteOns(): number[][] {
    return this.sent.filter((m) => (m[0]! & 0xf0) === 0x90);
  }
  get noteOffs(): number[][] {
    return this.sent.filter((m) => (m[0]! & 0xf0) === 0x80);
  }
}

/** 64 bars of a real-shaped arrangement: chords, bass and 16th drums. Big
 *  enough that the scheduler's per-tick scan is the thing under load. */
function song(bars = 64): BlueprintSong {
  return {
    id: "timing",
    title: "timing",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: "v",
        name: "Verse",
        role: "verse",
        bars,
        chords: [
          { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
          { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
        ],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
        drumPattern: "standard",
      },
    ],
    arrangement: [],
    createdAt: "",
    updatedAt: "",
  };
}

/** Every note the scheduler is expected to send, in song beats. */
function plannedNotes(s: BlueprintSong): MidiNote[] {
  const spans = sectionSpans(s);
  return [
    ...planChordStem(spans, s),
    ...planBassStem(spans, s),
    ...planDrumStem(spans, s),
    // The scheduler streams the colour layer too — leaving it out of the
    // reference made "every note in the region, once" look like an overflow.
    ...planColorStem(spans, s),
  ];
}

interface TimingReport {
  count: number;
  p50: number;
  p95: number;
  max: number;
  worstBeat: number;
}

/**
 * Match each sent note-on to the nearest planned note start and measure the
 * distance. The minimum gap between planned starts is a 16th (125 ms here) and
 * the errors are tens of ms, so nearest-match cannot mis-pair.
 */
function measure(sent: number[][], planned: MidiNote[]): TimingReport {
  const starts = [...new Set(planned.map((n) => n.startTime))].sort((a, b) => a - b);
  const errors: { ms: number; beat: number }[] = [];
  for (const message of sent) {
    const when = message[3]!;
    const beat = (when - SONG_BEAT_0_AT_MS) / TRUE_MS_PER_BEAT;
    let best = Infinity;
    let bestStart = 0;
    for (const start of starts) {
      const distance = Math.abs(start - beat);
      if (distance < best) {
        best = distance;
        bestStart = start;
      }
    }
    errors.push({ ms: best * TRUE_MS_PER_BEAT, beat: bestStart });
  }
  const sorted = errors.map((e) => e.ms).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const worst = errors.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0, beat: 0 });
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: worst.ms,
    worstBeat: worst.beat,
  };
}

function reportLine(label: string, r: TimingReport): string {
  return `${label.padEnd(28)} n=${String(r.count).padStart(5)}  p50=${r.p50.toFixed(1)}ms  p95=${r.p95.toFixed(1)}ms  max=${r.max.toFixed(1)}ms`;
}

/** Advance the virtual clock `beats` beats, ticking the scheduler every 50 ms
 *  and delivering Live's beat messages on arrival with `delay(beat)`. */
function run(
  toBeat: number,
  delay: (beat: number) => number | null,
  fromBeat = 0,
): void {
  const endMs = SONG_BEAT_0_AT_MS + toBeat * TRUE_MS_PER_BEAT;
  let nextBeatToSend = Math.ceil(fromBeat);
  while (nowMs < endMs) {
    nowMs += TICK_MS;
    vi.advanceTimersByTime(TICK_MS);

    // Deliver any beat message whose (delayed) arrival time has passed.
    while (nextBeatToSend <= toBeat) {
      const nominal = SONG_BEAT_0_AT_MS + nextBeatToSend * TRUE_MS_PER_BEAT;
      const d = delay(nextBeatToSend);
      if (d === null) break; // dropped
      if (nominal + d > nowMs) break;
      emitBeat(nominal + d, nextBeatToSend);
      nextBeatToSend += 1;
    }
  }
}


/** Like `run`, but the master reports a FLOAT position at ~30 Hz — what
 *  `osc-bridge` will push once it polls `/live/song/get/beat` instead of
 *  subscribing to AbletonOSC's integer beat pushes. */
function runFloat(
  toBeat: number,
  delay: (beat: number) => number,
  fromBeat = 0,
): void {
  const endMs = SONG_BEAT_0_AT_MS + toBeat * TRUE_MS_PER_BEAT;
  const REPORT_MS = 33;
  let nextReportAt = SONG_BEAT_0_AT_MS + fromBeat * TRUE_MS_PER_BEAT;
  while (nowMs < endMs) {
    nowMs += TICK_MS;
    vi.advanceTimersByTime(TICK_MS);
    while (nextReportAt <= nowMs) {
      const trueBeat = (nextReportAt - SONG_BEAT_0_AT_MS) / TRUE_MS_PER_BEAT;
      // Report the position *as it was when the reply left Live*, so the
      // arrival delay does not masquerade as position error.
      emitBeat(nextReportAt + delay(trueBeat), trueBeat);
      nextReportAt += REPORT_MS;
    }
  }
}

describe("timing — where the streamed notes land against Live's grid", () => {
  const scheduler = getLiveMidiScheduler();
  const channels = DEFAULT_LIVE_MIDI_CHANNELS;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    nowMs = 0;
    bridge.listener = null;
    bridge.connect.mockClear();
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    scheduler.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps every note on the grid under steady bridge latency", () => {
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);

    // A constant 8 ms bridge delay: the honest baseline.
    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, { clock });
    run(s.sections[0].bars * 4, () => 8); // the whole arrangement, in beats
    scheduler.stop();

    const planned = plannedNotes(s);
    const r = measure(out.noteOns, planned);
    console.log(`\n${reportLine("steady 8ms latency", r)}`);

    expect(r.count).toBeGreaterThan(1000);
    expect(r.p95).toBeLessThan(20);
    expect(r.max).toBeLessThan(40);
  });

  // A full simulation of a long song at two latencies — heavy enough to trip
  // the default timeout when the worker is sharing the machine.
  it("a 30 Hz float feed beats integer beats, on loopback and on a LAN", { timeout: 30_000 }, () => {
    // The integer push can only correct once a beat; a float feed corrects
    // every 33 ms. The catch — and the reason the clock filters dense samples
    // instead of trusting each one — is that a dense feed also imports its
    // arrival jitter thirty times a second. Both rows below come from the same
    // song, latency model and assertions; only the message rate changes.
    const profile = (label: string, jitter: (beat: number) => number) => {
      nowMs = 0;
      bridge.listener = null;
      const integerOut = new FakeOutput();
      emitBeat(0, 0);
      scheduler.start(song(), integerOut as unknown as MIDIOutput, channels, {
        clock: createAbletonSyncClock(song()),
      });
      run(song().sections[0].bars * 4, jitter);
      scheduler.stop();

      nowMs = 0;
      bridge.listener = null;
      const floatOut = new FakeOutput();
      emitBeat(0, 0);
      scheduler.start(song(), floatOut as unknown as MIDIOutput, channels, {
        clock: createAbletonSyncClock(song()),
      });
      runFloat(song().sections[0].bars * 4, jitter);
      scheduler.stop();

      const integer = measure(integerOut.noteOns, plannedNotes(song()));
      const float = measure(floatOut.noteOns, plannedNotes(song()));
      console.log(
        `\n${label}\n  ${reportLine("integer beats @2/s", integer)}\n  ${reportLine("float positions @30Hz", float)}`,
      );
      return { integer, float };
    };

    // Loopback — where the bridge actually lives relative to Live.
    const tight = profile("loopback, ±1.5ms", (beat) => 1 + ((beat * 97) % 3) - 1.5);
    expect(tight.float.count).toBeGreaterThan(1000);
    expect(tight.float.p95).toBeLessThan(tight.integer.p95);
    expect(tight.float.max).toBeLessThan(tight.integer.max);

    // A LAN bridge (or a busy machine): sloppier arrival times.
    const loose = profile("LAN, 8ms ±9ms", (beat) => 8 + ((beat * 13) % 19) - 9);
    expect(loose.float.p50).toBeLessThan(loose.integer.p50);
    expect(loose.float.p95).toBeLessThanOrEqual(loose.integer.p95);
  });

  it("survives jitter, duplicates and a late message", () => {
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);
    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, { clock });

    // Deterministic pseudo-jitter: ±18 ms, the resubscribe artifact's
    // double-message (same beat, 4 ms later), and one very late beat.
    const delay = (beat: number): number => {
      if (beat === 16) return 220; // a beat the bridge delivers very late
      if (beat === 24) return 4 + ((beat * 7) % 11); // bunched
      return 8 + ((beat * 13) % 19) - 9;
    };
    run(s.sections[0].bars * 4, delay);
    scheduler.stop();

    const r = measure(out.noteOns, plannedNotes(s));
    console.log(`${reportLine("jitter ±18ms + 1 late", r)}`);

    expect(r.p95).toBeLessThan(30);
    // A single late beat must not chop the phrase: the notes that were
    // already queued still fire on their own timestamps.
    expect(r.max).toBeLessThan(60);
  });

  it("holds the loop region: nothing outside it, and every note inside it once", () => {
    // One pass, measured against the score's own grid. The wrap itself (a
    // backwards jump in Live's position) is covered by the scheduler's own
    // suite; what this adds is the musical claim — a section loop plays that
    // section and only that section.
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);
    const loopStart = 8;
    const loopEnd = 24;

    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, {
      clock,
      loopStart,
      loopEnd,
      startBeat: loopStart,
    });

    while (nowMs < loopEnd * TRUE_MS_PER_BEAT) {
      nowMs += TICK_MS;
      vi.advanceTimersByTime(TICK_MS);
      const beatDue = Math.floor(nowMs / TRUE_MS_PER_BEAT);
      if (nowMs >= beatDue * TRUE_MS_PER_BEAT && nowMs - TICK_MS < beatDue * TRUE_MS_PER_BEAT) {
        emitBeat(nowMs, beatDue);
      }
    }
    scheduler.stop();

    const beats = out.noteOns.map((m) => (m[3]! - SONG_BEAT_0_AT_MS) / TRUE_MS_PER_BEAT);
    const outside = beats.filter((b) => b < loopStart - 0.01 || b > loopEnd + 0.01);
    expect(outside).toEqual([]);

    // Everything the region contains was played exactly once.
    const plannedInRegion = plannedNotes(s).filter((n) => n.startTime >= loopStart && n.startTime < loopEnd);
    expect(out.noteOns.length).toBeGreaterThan(plannedInRegion.length * 0.8);
    expect(out.noteOns.length).toBeLessThanOrEqual(plannedInRegion.length);
  });

  it("pairs every note-on with a note-off", () => {
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);
    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, { clock });
    run(32, () => 8);
    scheduler.stop();

    const key = (m: number[]) => `${m[0]! & 0x0f}:${m[1]!}`;
    const ons = out.noteOns.map(key);
    const offs = out.noteOffs.map(key);
    const count = (list: string[]) => list.reduce<Record<string, number>>((acc, k) => {
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    // `stop()` adds an all-notes-off CC, not note-offs, so the counts must
    // balance exactly from the stream itself.
    expect(count(ons)).toEqual(count(offs));
  });

  it("silences everything when paused mid-note", () => {
    // The lookahead has already queued notes for the next 400 ms, so a pause
    // that only stops the timer leaves the browser free to play them with no
    // matching note-off — the classic hanging note.
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);
    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, { clock });
    run(3.5, () => 8); // stopped mid-phrase
    scheduler.pause();

    const channelsThatSounded = new Set(out.noteOns.map((m) => m[0]! & 0x0f));
    const silenced = new Set(
      out.sent
        .filter((m) => (m[0]! & 0xf0) === 0xb0 && m[1] === 123)
        .map((m) => m[0]! & 0x0f),
    );
    expect(channelsThatSounded.size).toBeGreaterThan(0);
    for (const channel of channelsThatSounded) {
      expect(silenced.has(channel)).toBe(true); // all-notes-off on every channel used
    }

    // And nothing further is scheduled after the pause.
    const afterPause = out.sent.length;
    vi.advanceTimersByTime(1000);
    expect(out.sent.length).toBe(afterPause);
  });

  it("never leaves a note in the past — sends stay ahead of now", () => {
    const s = song();
    const out = new FakeOutput();
    const clock = createAbletonSyncClock(s);
    emitBeat(0, 0);
    scheduler.start(s, out as unknown as MIDIOutput, channels, { clock });

    const nowAtSend: number[] = [];
    const original = out.send.bind(out);
    out.send = (data: Uint8Array | number[], when?: number) => {
      if (when !== undefined) nowAtSend.push(when - nowMs);
      original(data, when);
    };
    run(16, () => 8);
    scheduler.stop();

    // Everything the scheduler sends is stamped at or after "now" (a catch-up
    // window may fire a note a few ms late on purpose — never hundreds).
    expect(Math.min(...nowAtSend)).toBeGreaterThan(-100);
  });
});
