/**
 * Note segmentation — turns a stream of pitch-detection frames (voiced /
 * unvoiced, with a fractional MIDI pitch) into discrete `RawMelodyNote`s.
 *
 * This is the part of the hum-to-MIDI pipeline that decides "where does
 * one note end and the next begin." The state machine is deliberately
 * simple and, crucially, pure — it just consumes `(midi, seconds, clarity)`
 * triples and emits notes, so it's unit-testable without a microphone.
 * The browser wiring that *produces* those frames lives in `recorder.ts`.
 *
 * Segmentation rules:
 * - A note starts on the first voiced frame (clarity above `voicedClarity`).
 * - A note ends after `unvoicedBreakSec` of unvoiced frames (a breath, a
 *   consonant, silence between syllables).
 * - A pitch leap bigger than `pitchJumpSemitones` sustained for
 *   `pitchJumpFrames` frames starts a new note (a sung melodic leap) —
 *   a single frame of noise in the middle of a held note does not.
 * - Each note's pitch is the *median* of its frames (robust to vibrato and
 *   a stray wrong frame), and notes shorter than `minNoteMs` are dropped
 *   as glitches.
 */

export interface RawMelodyNote {
  /** MIDI note number (rounded from the frame median). */
  pitch: number;
  /** Onset in seconds from the start of recording. */
  startSec: number;
  /** Length in seconds. */
  durationSec: number;
  /** Mean YIN clarity (0..1) over the note's frames — a rough "how clean
   *  was this take" signal the UI can surface for weak notes. */
  clarity: number;
}

export interface SegmenterConfig {
  /** Frames at/above this clarity count as voiced. */
  voicedClarity: number;
  /** Close a held note after this much unvoiced time (seconds). */
  unvoicedBreakSec: number;
  /** A frame-to-frame pitch move bigger than this (semitones) is a jump. */
  pitchJumpSemitones: number;
  /** How many consecutive jump frames before the jump becomes a new note. */
  pitchJumpFrames: number;
  /** Drop completed notes shorter than this (ms) — glitches, clicks. */
  minNoteMs: number;
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
  voicedClarity: 0.82,
  unvoicedBreakSec: 0.12,
  pitchJumpSemitones: 1.4,
  pitchJumpFrames: 2,
  minNoteMs: 120,
};

interface OpenNote {
  startSec: number;
  lastSec: number;
  pitches: number[];
  clarities: number[];
}

/** State machine that accumulates pitch frames into notes. */
export class NoteSegmenter {
  private cfg: SegmenterConfig;
  private current: OpenNote | null = null;
  private unvoicedSec = 0;
  private jumpStreak = 0;
  private lastMidi: number | null = null;
  private lastFrameSec = 0;
  private emitted: RawMelodyNote[] = [];

  constructor(cfg: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG) {
    this.cfg = cfg;
  }

  /** The notes completed so far (read-only view). */
  get notes(): readonly RawMelodyNote[] {
    return this.emitted;
  }

  /**
   * Feed one analysis frame. `midi` is null (or `clarity` is low) for
   * unvoiced frames. `seconds` must be monotonically increasing wall-clock
   * time since record start.
   */
  feed(midi: number | null, seconds: number, clarity: number): void {
    const dt = Math.max(0, seconds - this.lastFrameSec);
    this.lastFrameSec = seconds;

    // Unvoiced frame.
    if (midi === null || clarity < this.cfg.voicedClarity) {
      if (this.current) {
        this.unvoicedSec += dt;
        if (this.unvoicedSec >= this.cfg.unvoicedBreakSec) this.closeNote(seconds);
      }
      this.lastMidi = null;
      this.jumpStreak = 0;
      return;
    }

    // Voiced frame, no note open → start one.
    if (!this.current) {
      this.current = { startSec: seconds, lastSec: seconds, pitches: [midi], clarities: [clarity] };
      this.unvoicedSec = 0;
      this.lastMidi = midi;
      return;
    }

    // Voiced frame, note open. A sustained big leap closes it and starts
    // the next note; anything else extends the current one.
    this.unvoicedSec = 0;
    if (this.lastMidi !== null && Math.abs(midi - this.lastMidi) > this.cfg.pitchJumpSemitones) {
      this.jumpStreak++;
      if (this.jumpStreak >= this.cfg.pitchJumpFrames) {
        this.closeNote(seconds);
        this.current = { startSec: seconds, lastSec: seconds, pitches: [midi], clarities: [clarity] };
        this.lastMidi = midi;
        this.jumpStreak = 0;
        return;
      }
      // Candidate jump — don't commit the pitch, and DON'T move lastMidi
      // either: keeping it at the base pitch means consecutive off-pitch
      // frames each register as a jump (so the streak reaches the threshold
      // and starts a new note), while a one-frame blip that settles back
      // leaves the original note untouched.
      return;
    }
    this.jumpStreak = 0;
    this.current.pitches.push(midi);
    this.current.clarities.push(clarity);
    this.current.lastSec = seconds;
    this.lastMidi = midi;
  }

  /** Close any note still open (call once at stop), returning all notes. */
  finish(atSec: number): RawMelodyNote[] {
    if (this.current) this.closeNote(atSec);
    return this.emitted;
  }

  /** Reset for a fresh take — drops everything accumulated. */
  clear(): void {
    this.current = null;
    this.unvoicedSec = 0;
    this.jumpStreak = 0;
    this.lastMidi = null;
    this.lastFrameSec = 0;
    this.emitted = [];
  }

  private closeNote(atSec: number): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.unvoicedSec = 0;
    const durationSec = Math.max(0, atSec - cur.startSec);
    if (durationSec * 1000 < this.cfg.minNoteMs) return; // glitch — drop it

    const sorted = [...cur.pitches].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? sorted[sorted.length - 1];
    const meanClarity = cur.clarities.reduce((s, c) => s + c, 0) / Math.max(1, cur.clarities.length);
    this.emitted.push({
      pitch: Math.round(median),
      startSec: cur.startSec,
      durationSec: Math.max(0.05, durationSec),
      clarity: Math.round(meanClarity * 1000) / 1000,
    });
  }
}
