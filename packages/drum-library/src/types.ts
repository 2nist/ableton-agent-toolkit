/**
 * A single drum hit. `beat` is measured in quarter notes from the start of
 * the take, which makes it tempo-independent — E-GMD stores real human
 * performances, so these are *not* grid-aligned and must never be rounded
 * on the way in. The microtiming is the pocket; it's the whole reason this
 * library exists rather than a procedural pattern generator.
 */
export interface DrumNote {
  beat: number;
  pitch: number;
  velocity: number;
}

/**
 * Which limb plays a voice. The point of splitting these out is that a
 * groove's parts can be recombined across drummers — a rock player's foot
 * under a jazz player's cymbal hand. 90% of E-GMD takes carry all three
 * core limbs, so this applies corpus-wide rather than as a special case.
 * `toms` is separate because it's mostly fill material and appears in only
 * ~69% of takes.
 */
export type Limb = "feet" | "snare" | "cymbals" | "toms";

/** Whether a take is a repeating groove or a one-off transition figure. */
export type BeatType = "beat" | "fill";

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * One E-GMD performance, as loaded from disk. Notes are stored here and
 * nowhere else — a Segment is a *view* over this note list, not a copy.
 * Materialising every candidate segment would mean ~8.1M note arrays; this
 * way the corpus stays at ~83k.
 */
export interface Take {
  /** Path relative to the E-GMD root, e.g. `drummer1/session1/1_funk_138_beat_4-4_1.midi`. */
  id: string;
  drummer: string;
  session: string;
  /** E-GMD's own label, e.g. `funk/groove1`. Kept as a hidden retrieval signal — never surfaced in the UI. */
  style: string;
  bpm: number;
  beatType: BeatType;
  timeSignature: TimeSignature;
  kitName: string;
  /** Quarter notes per bar — derived from the time signature, never assumed to be 4. */
  beatsPerBar: number;
  notes: DrumNote[];
}

/**
 * Perceptual axes measured directly from the MIDI. These replace genre as
 * the thing a user steers by: genre reads as prescriptive ("play me a rock
 * beat"), whereas these read as description ("laid back and spacious").
 * Genre is retained on the Take purely to sharpen nearest-neighbour search.
 *
 * All values are computed per segment, so a long take that drifts from
 * tight to loose yields segments that differ accordingly.
 */
export interface FeelFeatures {
  /**
   * Signed mean timing offset from the nearest grid position, in beats.
   * Negative = behind the beat (laid back), positive = ahead (pushing).
   * This is the axis genre cannot express and drummers actually name.
   */
  push: number;
  /** Standard deviation of those timing offsets, in beats. Low = machine-tight, high = loose. */
  looseness: number;
  /** Velocity spread (0–1). High means ghost notes and accents; low means flat/programmed. */
  dynamics: number;
  /** Hits per bar. */
  density: number;
  /** Share of velocity-weighted energy landing on metrically weak positions (0–1). */
  syncopation: number;
  /**
   * Where offbeat 8ths sit within their beat. 0.5 = straight, ~0.667 = triplet
   * shuffle. Recombining limbs across mismatched swing is the fastest way to
   * turn a groove to mush, so this doubles as a compatibility constraint.
   */
  swing: number;
  /** Velocity emphasis on strong beats (0–1) — how hard the backbeat lands. */
  weight: number;
  /** Open/crash cymbal share of cymbal hits (0–1). Dark and closed vs. bright and washy. */
  brightness: number;
  /** Bar-to-bar variation (0–1). 0 = hypnotically identical, 1 = through-composed. */
  motion: number;
}

/**
 * A candidate loop: one limb's worth of a take over a bar range. Carries no
 * notes — resolve them with `resolveSegment` when they're actually needed.
 */
export interface Segment {
  takeId: string;
  limb: Limb;
  startBar: number;
  lengthBars: number;
  noteCount: number;
  features: FeelFeatures;
  /**
   * Identity of the *pattern* with feel stripped out — onsets quantised to a
   * 16th grid, velocity and microtiming discarded. Segments sharing a key are
   * the same rhythm played differently, which is the library's two-level
   * shape: a browsable vocabulary of rhythms, each with real human variants
   * underneath. Steering feel then means moving between variants of one
   * rhythm rather than jumping to an unrelated groove.
   */
  rhythmKey: string;
}

/**
 * What a song section stores: one source reference per limb, plus any
 * transforms. This is the record that makes a recombined groove reversible —
 * every limb traces back to a specific take and bar range, so a Frankenstein
 * can always be taken apart, re-derived, or edited one limb at a time.
 */
export interface GrooveSpec {
  feet?: SegmentRef;
  snare?: SegmentRef;
  cymbals?: SegmentRef;
  toms?: SegmentRef;
  transform?: GrooveTransform;
}

export interface SegmentRef {
  takeId: string;
  startBar: number;
  lengthBars: number;
}

export interface GrooveTransform {
  /** Shift every onset by this many beats — used to reconcile limbs recorded with different push. */
  timingOffset?: number;
  /** Scale all velocities (1 = unchanged). */
  velocityScale?: number;
  /** Pull onsets toward the grid: 0 keeps the human feel, 1 fully quantises. */
  quantize?: number;
}
