import type { CaptureTrigger, CapturedRegion, MidiEvent, NormalizedMidiEvent } from "./types";
import { MidiRingBuffer } from "./ring-buffer";

/**
 * Playhead position tracker for sample-accurate capture timing.
 *
 * Returns the current transport position in seconds. In a REAPER context,
 * this would come from `reaper.GetPlayPosition()`. For standalone use,
 * a monotonic clock or manual advance is used.
 */
export type TimeSource = () => number;

/**
 * Capture Engine — wraps a MidiRingBuffer with trigger logic.
 *
 * Implements the BirdBird Global Sampler pattern:
 *   - Continuous background recording into ring buffer
 *   - User triggers capture with specific mode
 *   - Extracted region returned as normalized events
 *
 * Usage:
 *   const engine = new CaptureEngine(buffer, () => reaper.GetPlayPosition());
 *   engine.startRecording();
 *   // ... user plays ...
 *   const region = engine.capture({ type: "last_bars", bars: 4 });
 *   engine.stopRecording();
 */
export class CaptureEngine {
  private buffer: MidiRingBuffer;
  private timeSource: TimeSource;
  private isRecording: boolean = false;
  private markerTimes: Map<string, number> = new Map();

  constructor(buffer: MidiRingBuffer, timeSource: TimeSource) {
    this.buffer = buffer;
    this.timeSource = timeSource;
  }

  /**
   * Begin recording. Incoming events should be sent via recordEvent().
   */
  startRecording(): void {
    this.isRecording = true;
  }

  /**
   * Stop recording.
   */
  stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Check if engine is actively recording.
   */
  get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Record a single MIDI event. No-op if not recording.
   */
  recordEvent(event: MidiEvent): void {
    if (!this.isRecording) return;
    this.buffer.record(event);
  }

  /**
   * Record a batch of MIDI events.
   */
  recordBatch(events: MidiEvent[]): void {
    if (!this.isRecording || events.length === 0) return;
    this.buffer.recordBatch(events);
  }

  /**
   * Place a named marker at the current time.
   * Used for capture triggers of type "since_marker".
   */
  placeMarker(name: string): void {
    this.markerTimes.set(name, this.timeSource());
  }

  /**
   * Remove a named marker.
   */
  removeMarker(name: string): void {
    this.markerTimes.delete(name);
  }

  /**
   * Get all marker names.
   */
  getMarkers(): string[] {
    return Array.from(this.markerTimes.keys());
  }

  /**
   * Get a marker's time.
   */
  getMarkerTime(name: string): number | undefined {
    return this.markerTimes.get(name);
  }

  /**
   * Execute a capture trigger and return a CapturedRegion.
   */
  capture(trigger: CaptureTrigger): CapturedRegion {
    const now = this.timeSource();
    let events: MidiEvent[] = [];

    switch (trigger.type) {
      case "last_seconds":
        events = this.buffer.captureLastSeconds(trigger.seconds, now);
        break;
      case "last_bars":
        events = this.buffer.captureLastBars(trigger.bars, now);
        break;
      case "last_beats":
        events = this.buffer.captureLastBeats(trigger.beats, now);
        break;
      case "since_marker": {
        const markerTime = this.markerTimes.get(trigger.markerName);
        if (markerTime !== undefined) {
          events = this.buffer.captureSince(markerTime);
        }
        break;
      }
      case "all":
        events = this.buffer.captureAll();
        break;
    }

    // Calculate region metadata
    const duration = events.length > 0
      ? events[events.length - 1]!.time
      : 0;
    const config = this.buffer.getConfig();
    const secondsPerBeat = 60 / config.bpm;
    const beatsPerBar = config.timeSignatureNumerator;
    const durationBeats = duration / secondsPerBeat;
    const durationBars = durationBeats / beatsPerBar;

    // Calculate start beat position (from the absolute start time)
    const rawEvents = this.buffer.getAllEvents();
    const firstEventTime = rawEvents.length > 0 ? rawEvents[0]!.time : 0;
    const startBeat = firstEventTime / secondsPerBeat;

    // Normalize events
    const normalized: NormalizedMidiEvent[] = events.map((e) => ({
      time: e.time,
      type: e.type,
      channel: e.channel,
      data1: e.data1,
      data2: e.data2,
      layer: e.layer,
    }));

    return {
      startTime: events.length > 0 ? now - events[events.length - 1]!.time : now,
      endTime: now,
      duration,
      durationBeats,
      durationBars,
      startBeat,
      events: normalized,
    };
  }

  /**
   * Capture the last N seconds (convenience method).
   */
  captureLastSeconds(seconds: number): CapturedRegion {
    return this.capture({ type: "last_seconds", seconds });
  }

  /**
   * Capture the last N bars (convenience method).
   */
  captureLastBars(bars: number): CapturedRegion {
    return this.capture({ type: "last_bars", bars });
  }

  /**
   * Capture the last N beats (convenience method).
   */
  captureLastBeats(beats: number): CapturedRegion {
    return this.capture({ type: "last_beats", beats });
  }

  /**
   * Capture all buffered data.
   */
  captureAll(): CapturedRegion {
    return this.capture({ type: "all" });
  }

  /**
   * Capture since a named marker.
   */
  captureSinceMarker(markerName: string): CapturedRegion {
    return this.capture({ type: "since_marker", markerName });
  }

  /**
   * Get the underlying ring buffer.
   */
  getBuffer(): MidiRingBuffer {
    return this.buffer;
  }

  /**
   * Get the time source function.
   */
  getTimeSource(): TimeSource {
    return this.timeSource;
  }
}

export default CaptureEngine;
