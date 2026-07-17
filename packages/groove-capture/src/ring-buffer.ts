import type { MidiEvent, RingBufferConfig, RingBufferStats } from "./types";

/**
 * MIDI Ring Buffer for retroactive capture.
 *
 * Records all incoming MIDI events into a time-windowed circular buffer.
 * When a capture trigger fires, extracts the specified time range as a
 * normalized region with events relative to the region start.
 *
 * Pattern: BirdBird Global Sampler + DMGE 600-bar ring buffer
 *
 * Usage:
 *   const buffer = new MidiRingBuffer({ maxDurationSeconds: 300, bpm: 120, ... });
 *   buffer.record(event);  // call on each incoming MIDI event
 *   const region = buffer.capture({ type: "last_bars", bars: 4 });
 */

export class MidiRingBuffer {
  private events: MidiEvent[] = [];
  private config: RingBufferConfig;
  private totalRecorded: number = 0;
  private totalEvicted: number = 0;
  private latestTime: number = 0;

  constructor(config: Partial<RingBufferConfig> = {}) {
    this.config = {
      maxDurationSeconds: config.maxDurationSeconds ?? 300, // 5 min default (DMGE)
      bpm: config.bpm ?? 120,
      timeSignatureNumerator: config.timeSignatureNumerator ?? 4,
      timeSignatureDenominator: config.timeSignatureDenominator ?? 4,
    };
  }

  /**
   * Record a MIDI event into the ring buffer.
   * Events older than maxDurationSeconds are automatically trimmed.
   */
  record(event: MidiEvent): void {
    this.events.push(event);
    this.totalRecorded++;
    this.latestTime = Math.max(this.latestTime, event.time);

    // Trim events older than the window
    this.trim();
  }

  /**
   * Record multiple MIDI events at once (batch).
   */
  recordBatch(events: MidiEvent[]): void {
    for (const event of events) {
      this.events.push(event);
    }
    this.totalRecorded += events.length;
    if (events.length > 0) {
      this.latestTime = Math.max(
        this.latestTime,
        events[events.length - 1]!.time
      );
    }
    this.trim();
  }

  /**
   * Capture the last N seconds from the ring buffer.
   * Returns normalized events (time relative to region start).
   */
  captureLastSeconds(seconds: number, referenceTime?: number): MidiEvent[] {
    const now = referenceTime ?? this.latestTime;
    const startTime = now - seconds;

    return this.events
      .filter((e) => e.time >= startTime && e.time <= now)
      .map((e) => ({
        ...e,
        time: e.time - startTime, // Normalize to region start
      }));
  }

  /**
   * Capture the last N bars from the ring buffer.
   */
  captureLastBars(bars: number, referenceTime?: number): MidiEvent[] {
    const beatsPerBar = this.config.timeSignatureNumerator;
    const secondsPerBeat = 60 / this.config.bpm;
    const secondsPerBar = beatsPerBar * secondsPerBeat;
    const seconds = bars * secondsPerBar;
    return this.captureLastSeconds(seconds, referenceTime);
  }

  /**
   * Capture the last N beats from the ring buffer.
   */
  captureLastBeats(beats: number, referenceTime?: number): MidiEvent[] {
    const secondsPerBeat = 60 / this.config.bpm;
    const seconds = beats * secondsPerBeat;
    return this.captureLastSeconds(seconds, referenceTime);
  }

  /**
   * Capture all currently buffered events.
   */
  captureAll(): MidiEvent[] {
    if (this.events.length === 0) return [];
    const startTime = this.events[0]!.time;
    return this.events.map((e) => ({
      ...e,
      time: e.time - startTime,
    }));
  }

  /**
   * Get events since a specific marker time.
   */
  captureSince(markerTime: number): MidiEvent[] {
    return this.events
      .filter((e) => e.time >= markerTime)
      .map((e) => ({
        ...e,
        time: e.time - markerTime,
      }));
  }

  /**
   * Get events since a specific absolute timestamp (without normalization).
   */
  eventsSince(time: number): MidiEvent[] {
    return this.events.filter((e) => e.time >= time);
  }

  /**
   * Get all buffered events (raw, absolute timestamps).
   */
  getAllEvents(): readonly MidiEvent[] {
    return this.events;
  }

  /**
   * Get the earliest event time in the buffer.
   */
  getEarliestTime(): number {
    if (this.events.length === 0) return 0;
    return this.events[0]!.time;
  }

  /**
   * Get the latest event time in the buffer.
   */
  getLatestTime(): number {
    return this.latestTime;
  }

  /**
   * Get the total duration of buffered data.
   */
  getBufferedDuration(): number {
    if (this.events.length === 0) return 0;
    return this.latestTime - this.events[0]!.time;
  }

  /**
   * Get ring buffer statistics.
   */
  getStats(): RingBufferStats {
    const oldestTime = this.getEarliestTime();
    const maxCap = this.config.maxDurationSeconds;
    const buffered = this.getBufferedDuration();

    return {
      eventCount: this.events.length,
      oldestEventTime: oldestTime,
      newestEventTime: this.latestTime,
      totalEventsRecorded: this.totalRecorded,
      totalEventsEvicted: this.totalEvicted,
      fillPercent: Math.min(100, (buffered / maxCap) * 100),
    };
  }

  /**
   * Update buffer configuration (tempo, time signature changes during playback).
   */
  updateConfig(partial: Partial<RingBufferConfig>): void {
    if (partial.maxDurationSeconds !== undefined) {
      this.config.maxDurationSeconds = partial.maxDurationSeconds;
      this.trim();
    }
    if (partial.bpm !== undefined) {
      this.config.bpm = partial.bpm;
    }
    if (partial.timeSignatureNumerator !== undefined) {
      this.config.timeSignatureNumerator = partial.timeSignatureNumerator;
    }
    if (partial.timeSignatureDenominator !== undefined) {
      this.config.timeSignatureDenominator = partial.timeSignatureDenominator;
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<RingBufferConfig> {
    return this.config;
  }

  /**
   * Clear all events from the buffer.
   * Keeps the configuration and stats counters intact.
   */
  clear(): void {
    this.events = [];
    this.latestTime = 0;
  }

  /**
   * Full reset — clears events and resets all counters.
   */
  reset(): void {
    this.events = [];
    this.totalRecorded = 0;
    this.totalEvicted = 0;
    this.latestTime = 0;
  }

  /**
   * Get event count.
   */
  get size(): number {
    return this.events.length;
  }

  /**
   * Check if buffer is empty.
   */
  get isEmpty(): boolean {
    return this.events.length === 0;
  }

  /**
   * Trim events older than the configured window.
   * Uses binary search for efficiency on large buffers.
   */
  private trim(): void {
    const cutoff = this.latestTime - this.config.maxDurationSeconds;
    if (cutoff <= 0) return;

    // Binary search for the first event >= cutoff
    let left = 0;
    let right = this.events.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.events[mid]!.time < cutoff) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    if (left > 0) {
      this.totalEvicted += left;
      this.events = this.events.slice(left);
    }
  }
}

export default MidiRingBuffer;
