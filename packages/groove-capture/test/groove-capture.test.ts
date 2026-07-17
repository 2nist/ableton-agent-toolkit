/**
 * Baseline regression suite for the ported @groove/capture.
 * See @music-theory/core's test file for why this exists despite not
 * mirroring an upstream suite — there wasn't one to mirror.
 */

import { describe, expect, it } from "vitest";
import { CaptureEngine, MidiRingBuffer } from "../src/index.js";
import type { MidiEvent } from "../src/index.js";

function noteOn(time: number, data1: number): MidiEvent {
  return { time, type: "note_on", channel: 0, data1, data2: 100 };
}

describe("MidiRingBuffer", () => {
  it("records events and reports buffer stats", () => {
    const buffer = new MidiRingBuffer({ bpm: 120 });
    buffer.record(noteOn(0, 60));
    buffer.record(noteOn(1, 62));
    expect(buffer.size).toBe(2);
    expect(buffer.getStats().totalEventsRecorded).toBe(2);
    expect(buffer.getLatestTime()).toBe(1);
  });

  it("trims events older than maxDurationSeconds as new events arrive", () => {
    const buffer = new MidiRingBuffer({ maxDurationSeconds: 2, bpm: 120 });
    buffer.record(noteOn(0, 60));
    buffer.record(noteOn(1, 61));
    buffer.record(noteOn(5, 62)); // pushes cutoff to 3s, evicting the first two
    expect(buffer.size).toBe(1);
    expect(buffer.getStats().totalEventsEvicted).toBe(2);
  });

  it("captureLastBars converts bars to seconds using bpm and time signature", () => {
    const buffer = new MidiRingBuffer({ bpm: 120, timeSignatureNumerator: 4 });
    // 1 bar at 120bpm/4-4 = 2 seconds, so a window from t=1 to t=3 (referenceTime=3)
    buffer.record(noteOn(0, 60)); // before the window — excluded
    buffer.record(noteOn(2, 61)); // inside the window
    const captured = buffer.captureLastBars(1, 3);
    expect(captured.map((e) => e.data1)).toEqual([61]);
    expect(captured[0]!.time).toBeCloseTo(1, 5); // normalized to region start (t=1)
  });

  it("captureAll normalizes events to start at time 0", () => {
    const buffer = new MidiRingBuffer();
    buffer.record(noteOn(10, 60));
    buffer.record(noteOn(12, 62));
    const region = buffer.captureAll();
    expect(region[0]!.time).toBe(0);
    expect(region[1]!.time).toBe(2);
  });

  it("clear() resets events but keeps recorded/evicted counters", () => {
    const buffer = new MidiRingBuffer();
    buffer.record(noteOn(0, 60));
    buffer.clear();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.getStats().totalEventsRecorded).toBe(1);
  });

  it("reset() clears events and zeroes all counters", () => {
    const buffer = new MidiRingBuffer();
    buffer.record(noteOn(0, 60));
    buffer.reset();
    expect(buffer.getStats().totalEventsRecorded).toBe(0);
  });
});

describe("CaptureEngine", () => {
  it("ignores recorded events until startRecording() is called", () => {
    const buffer = new MidiRingBuffer();
    const engine = new CaptureEngine(buffer, () => 0);
    engine.recordEvent(noteOn(0, 60));
    expect(buffer.size).toBe(0);

    engine.startRecording();
    engine.recordEvent(noteOn(0, 60));
    expect(buffer.size).toBe(1);
  });

  it("computes durationBars/durationBeats from the buffer's bpm and time signature", () => {
    const buffer = new MidiRingBuffer({ bpm: 120, timeSignatureNumerator: 4 });
    let now = 0;
    const engine = new CaptureEngine(buffer, () => now);
    engine.startRecording();
    engine.recordEvent(noteOn(0, 60));
    now = 2; // 1 bar at 120bpm/4-4
    engine.recordEvent(noteOn(2, 62));

    const region = engine.captureAll();
    expect(region.durationBeats).toBeCloseTo(4, 5);
    expect(region.durationBars).toBeCloseTo(1, 5);
  });

  it("supports named markers for since_marker captures", () => {
    const buffer = new MidiRingBuffer();
    let now = 0;
    const engine = new CaptureEngine(buffer, () => now);
    engine.startRecording();
    engine.recordEvent(noteOn(0, 60));
    now = 5;
    engine.placeMarker("loop-start");
    engine.recordEvent(noteOn(5, 62));
    now = 10;

    const region = engine.captureSinceMarker("loop-start");
    expect(region.events.map((e) => e.data1)).toEqual([62]);
  });

  it("returns an empty region for an unknown marker rather than throwing", () => {
    const buffer = new MidiRingBuffer();
    const engine = new CaptureEngine(buffer, () => 0);
    const region = engine.captureSinceMarker("does-not-exist");
    expect(region.events).toEqual([]);
  });
});
