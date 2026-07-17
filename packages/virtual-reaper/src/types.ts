/**
 * Virtual REAPER Environment — Core Types
 *
 * Based on EnviREAment (enhanced_virtual_reaper.lua, 3,035 lines)
 * with SWS API extensions and multi-target testing support.
 */

/** Detected runtime environment */
export type RuntimeEnvironment =
  | "reaper"         // Running inside real REAPER
  | "envirement"     // Running in EnviREAment virtual environment
  | "standalone";    // Running standalone (no REAPER API available)

/** A mocked API function — standard signature for mock registrations */
export type MockFunction = (...args: any[]) => any;

/** Mock API registry */
export interface MockRegistry {
  [functionName: string]: MockFunction;
}

/** Test result from a single test phase */
export interface TestPhaseResult {
  /** Phase name */
  phase: string;
  /** Whether the phase passed */
  passed: boolean;
  /** Detailed test results */
  tests: TestResult[];
  /** Performance metrics */
  metrics: TestMetrics;
  /** Error messages if any */
  errors: string[];
}

/** Individual test result */
export interface TestResult {
  /** Test name */
  name: string;
  /** Whether the test passed */
  passed: boolean;
  /** Optional error message */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/** Performance metrics for a test run */
export interface TestMetrics {
  /** Total API calls made */
  apiCalls: number;
  /** Windows created (ImGui tests) */
  windowsCreated: number;
  /** Widgets drawn (ImGui tests) */
  widgetsDrawn: number;
  /** Errors encountered */
  errors: number;
  /** Warnings encountered */
  warnings: number;
  /** Memory used in KB */
  memoryKb: number;
  /** Total test duration in milliseconds */
  durationMs: number;
}

/** Virtual REAPER state (matches EnviREAment VirtualState) */
export interface VirtualReaperState {
  /** Current transport time */
  time: number;
  /** Frame counter */
  frameCount: number;
  /** Delta time per frame (60 FPS) */
  deltaTime: number;
  /** Whether verbose logging is enabled */
  verboseLogging: boolean;
  /** Whether performance tracking is enabled */
  performanceTracking: boolean;
  /** Whether UI validation is enabled */
  uiValidation: boolean;
  /** Tempo markers */
  tempoMarkers: TempoMarker[];
  /** Project BPM */
  bpm: number;
  /** Time signature numerator */
  timeSignatureNumerator: number;
  /** Time signature denominator */
  timeSignatureDenominator: number;
  /** Project sample rate */
  sampleRate: number;
  /** Whether transport is playing */
  isPlaying: boolean;
  /** Whether transport is recording */
  isRecording: boolean;
  /** Whether loop is enabled */
  isLooping: boolean;
  /** Loop start time */
  loopStart: number;
  /** Loop end time */
  loopEnd: number;
}

/** Tempo / time signature marker */
export interface TempoMarker {
  /** Position in seconds */
  time: number;
  /** Measure offset */
  measureOffset: number;
  /** Beat offset within measure */
  beatOffset: number;
  /** Beats per minute */
  bpm: number;
  /** Time signature numerator */
  timesigNum: number;
  /** Time signature denominator */
  timesigDenom: number;
  /** Whether tempo change is linear */
  linear: boolean;
}

/** ImGui stack validation — tracks Begin/End matching */
export interface ImGuiStackValidator {
  /** Current window stack depth */
  windowStackDepth: number;
  /** Whether Begin/End calls are balanced */
  balanced: boolean;
  /** Open windows at each level */
  windowNames: string[];
  /** Mismatch errors detected */
  errors: string[];
}

/** Mock sync diff — used by the auto-generation pipeline */
export interface MockSyncDiff {
  /** Functions present in real REAPER but missing from mocks */
  missing: string[];
  /** Functions with different behavior between real and mock */
  mismatched: string[];
  /** New functions successfully added to mocks */
  added: string[];
  /** Functions hardened with type checking */
  hardened: string[];
}

/** A track in the virtual project */
export interface VirtualTrack {
  /** Track index */
  id: number;
  /** Track name */
  name: string;
  /** Volume (0-4) */
  volume: number;
  /** Pan (-1 to 1) */
  pan: number;
  /** Whether track is muted */
  muted: boolean;
  /** Whether track is soloed */
  soloed: boolean;
  /** Whether track is record-armed */
  recordArmed: boolean;
  /** Track color */
  color: number;
  /** FX chain */
  fx: VirtualFX[];
  /** Sends */
  sends: VirtualSend[];
  /** Media items on this track */
  items: VirtualMediaItem[];
}

/** A virtual FX instance */
export interface VirtualFX {
  /** FX name */
  name: string;
  /** Whether enabled */
  enabled: boolean;
  /** Preset name */
  preset: string;
  /** Parameter values (keyed by parameter index) */
  params: Record<number, number>;
}

/** A virtual track send */
export interface VirtualSend {
  /** Destination track */
  destTrack: VirtualTrack;
  /** Send volume */
  volume: number;
  /** Send pan */
  pan: number;
  /** Whether send is muted */
  mute: boolean;
}

/** A virtual media item */
export interface VirtualMediaItem {
  /** Item ID */
  id: number;
  /** Start position in seconds */
  position: number;
  /** Length in seconds */
  length: number;
  /** Track index */
  track: number;
}
