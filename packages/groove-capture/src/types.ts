/** A single MIDI event captured in the ring buffer */
export interface MidiEvent {
  /** Absolute timestamp in seconds (monotonic) */
  time: number;
  /** MIDI event type: "note_on", "note_off", "cc" */
  type: "note_on" | "note_off" | "cc";
  /** MIDI channel (0-15) */
  channel: number;
  /** Data byte 1 (note number for notes, CC number for cc) */
  data1: number;
  /** Data byte 2 (velocity for notes, CC value for cc) */
  data2: number;
  /** Layer/category for drum routing (kick, snare, hats_ride, percussion) */
  layer?: DrumLayer;
}

/** Drum layer categories for probabilistic groove generation
 *  Source: DMGE 4-layer architecture */
export type DrumLayer = "kick" | "snare" | "hats_ride" | "percussion";

/** Ring buffer configuration */
export interface RingBufferConfig {
  /** Maximum duration to retain in seconds (default: 300 = 5 min)
   *  DMGE uses 600 bars (~5+ minutes at 120 BPM)
   *  BirdBird uses configurable "Last X Seconds" */
  maxDurationSeconds: number;
  /** Tempo in BPM for bar-based calculations */
  bpm: number;
  /** Time signature numerator (default: 4) */
  timeSignatureNumerator: number;
  /** Time signature denominator (default: 4) */
  timeSignatureDenominator: number;
}

/** A captured region extracted from the ring buffer */
export interface CapturedRegion {
  /** Start time in seconds (absolute) */
  startTime: number;
  /** End time in seconds (absolute) */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Duration in beats */
  durationBeats: number;
  /** Duration in bars */
  durationBars: number;
  /** Start beat position */
  startBeat: number;
  /** All MIDI events in the region, normalized to start at time 0 */
  events: NormalizedMidiEvent[];
}

/** A MIDI event normalized to a region (time relative to region start) */
export interface NormalizedMidiEvent {
  /** Time in seconds relative to region start */
  time: number;
  /** MIDI event type */
  type: "note_on" | "note_off" | "cc";
  /** MIDI channel */
  channel: number;
  /** Data byte 1 */
  data1: number;
  /** Data byte 2 */
  data2: number;
  /** Drum layer (if categorized) */
  layer?: DrumLayer;
}

/** Capture trigger mode — how the user initiates capture */
export type CaptureTrigger =
  | { type: "last_seconds"; seconds: number }
  | { type: "last_bars"; bars: number }
  | { type: "last_beats"; beats: number }
  | { type: "since_marker"; markerName: string }
  | { type: "all"; };

/** Ring buffer statistics for monitoring */
export interface RingBufferStats {
  /** Total events currently in buffer */
  eventCount: number;
  /** Earliest event time (absolute) */
  oldestEventTime: number;
  /** Latest event time (absolute) */
  newestEventTime: number;
  /** Total events ever recorded (since last reset) */
  totalEventsRecorded: number;
  /** Total events evicted (due to buffer size limits) */
  totalEventsEvicted: number;
  /** Current buffer fill percentage (0-100) */
  fillPercent: number;
}
