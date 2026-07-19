import type { DrumNote } from "./types.js";

/**
 * Fold E-GMD's drum vocabulary down to the notes an Ableton Drum Rack maps
 * consistently.
 *
 * E-GMD was recorded on a Roland TD-11, whose mapping is far richer than a
 * 16-pad rack: separate bow/edge articulations for hats and cymbals, a pedal
 * hat, three toms with rims. Ableton's racks only agree with each other on a
 * handful of pads, and disagree badly on the rest. Surveyed across the 808
 * Core, 909 Core and an acoustic (Acuff) kit:
 *
 * | note | 808        | 909        | acoustic     |
 * |------|------------|------------|--------------|
 * |  36  | kick       | kick       | kick         |  consistent
 * |  37  | rim        | rim        | rim/sidestick|  consistent
 * |  38  | snare      | snare      | snare        |  consistent
 * |  42  | closed hat | closed hat | closed hat   |  consistent
 * |  46  | open hat   | open hat   | open hat     |  consistent
 * |  45  | mid tom    | mid tom    | tom          |  consistent
 * |  47  | hi tom     | hi tom     | tom          |  consistent
 * |  44  | LOW TOM    | LOW TOM    | hihat foot   |  CONFLICT
 * |  43  | hi conga   | snare      | tom          |  CONFLICT
 * |  40  | low conga  | kick       | snare        |  CONFLICT
 * |  50  | cowbell    | ride       | ride edge    |  CONFLICT
 * |  51  | claves     | ride       | ride bell    |  CONFLICT
 *
 * Two consequences drive everything below.
 *
 * First, note 44. In E-GMD that's the pedal hi-hat and it is 14.6% of every
 * beat hit in the corpus — the fourth most common voice. On both 808 and 909
 * racks it is a low tom, so roughly one hit in seven of an unfolded groove
 * fires a tom instead of a foot hat. In a swing take where the pedal hat
 * keeps time on 2 and 4, that is not a subtle degradation.
 *
 * Second, notes 22 and 26 (closed/open hat *edge*, another 8.4% of beats)
 * are below 36 and land outside a 16-pad rack entirely. They make no sound
 * at all, and a missing hat articulation reads as a sparser groove rather
 * than as an error.
 *
 * So everything folds onto the consistent set. This is deliberately lossy:
 * a rack that genuinely has a ride will not get one by default, because the
 * alternative is a groove that plays claves on an 808. Predictable beats
 * occasionally-correct.
 */

/** Notes an Ableton Drum Rack maps the same way across kits. */
export const ABLETON_SAFE_NOTES = {
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  closedHat: 42,
  tomMid: 45,
  openHat: 46,
  tomHigh: 47,
  crash: 49,
  /**
   * Only reliable on 909-style and acoustic racks — an 808 Core Kit has
   * claves here. Used only when `preferRide` is enabled.
   */
  ride: 51,
} as const;

export interface FoldOptions {
  /**
   * Keep ride hits on note 51 instead of folding them to the closed hat.
   *
   * Enable when the target rack is known to have a ride (909-style or
   * acoustic). Off by default: ride is 13.8% of beats, and on an 808 rack
   * note 51 is claves, which is a much worse outcome than playing the ride
   * pattern on a hat — both are timekeeping voices, so the groove survives
   * the substitution even though the timbre changes.
   */
  preferRide?: boolean;
}

/**
 * TD-11/GM note → Ableton-safe note.
 *
 * Ride and its articulations are absent here because they depend on
 * `preferRide`; see `foldPitch`.
 */
const FOLD: Record<number, number> = {
  // Feet. The pedal hat (44) becomes a closed hat: it is a hat in the
  // performance and a tom on most racks, and a tom is the worse error.
  35: ABLETON_SAFE_NOTES.kick,
  36: ABLETON_SAFE_NOTES.kick,
  44: ABLETON_SAFE_NOTES.closedHat,

  // Snare family. 40 is the TD-11's second snare zone, 39 stays a clap.
  37: ABLETON_SAFE_NOTES.rim,
  38: ABLETON_SAFE_NOTES.snare,
  39: ABLETON_SAFE_NOTES.clap,
  40: ABLETON_SAFE_NOTES.snare,

  // Hats, including the edge articulations that would otherwise fall below
  // the rack and be silent.
  22: ABLETON_SAFE_NOTES.closedHat,
  42: ABLETON_SAFE_NOTES.closedHat,
  26: ABLETON_SAFE_NOTES.openHat,
  46: ABLETON_SAFE_NOTES.openHat,

  // Toms collapse onto the two pads that agree across kits. 41/43 are the
  // low toms; 48/50 are high toms in GM but crash/cowbell on some racks.
  41: ABLETON_SAFE_NOTES.tomMid,
  43: ABLETON_SAFE_NOTES.tomMid,
  45: ABLETON_SAFE_NOTES.tomMid,
  47: ABLETON_SAFE_NOTES.tomHigh,
  48: ABLETON_SAFE_NOTES.tomHigh,
  50: ABLETON_SAFE_NOTES.tomHigh,
  58: ABLETON_SAFE_NOTES.tomMid,

  // Crashes. 52/55/57 are china/splash/second crash on a TD-11.
  49: ABLETON_SAFE_NOTES.crash,
  52: ABLETON_SAFE_NOTES.crash,
  55: ABLETON_SAFE_NOTES.crash,
  57: ABLETON_SAFE_NOTES.crash,
};

/** Ride voices: bow, edge and bell. */
const RIDE_PITCHES = new Set([51, 53, 59]);

/**
 * Map one performance note onto a rack-safe note, or null if it has no
 * sensible home. Nulls are returned rather than silently dropped so callers
 * can report what was lost.
 */
export function foldPitch(pitch: number, options: FoldOptions = {}): number | null {
  if (RIDE_PITCHES.has(pitch)) {
    return options.preferRide ? ABLETON_SAFE_NOTES.ride : ABLETON_SAFE_NOTES.closedHat;
  }
  return FOLD[pitch] ?? null;
}

export interface FoldResult {
  notes: DrumNote[];
  /** Hits with no rack-safe destination, by original pitch. */
  dropped: Map<number, number>;
}

/**
 * Fold a groove for playback on an Ableton Drum Rack.
 *
 * Folding merges voices, so several source hits can land on one pad at the
 * same instant — a hat edge and a hat bow struck together, say. Those are
 * collapsed to a single note keeping the loudest velocity, because stacking
 * duplicates on one pad in Live retriggers the sample and produces a flam or
 * a level spike rather than the single articulation the drummer played.
 */
export function foldForAbleton(notes: DrumNote[], options: FoldOptions = {}): FoldResult {
  const dropped = new Map<number, number>();
  const byPosition = new Map<string, DrumNote>();

  for (const note of notes) {
    const pitch = foldPitch(note.pitch, options);
    if (pitch === null) {
      dropped.set(note.pitch, (dropped.get(note.pitch) ?? 0) + 1);
      continue;
    }

    // Round to a tick well under audibility so simultaneous hits collapse
    // while genuine microtiming between separate hits is preserved.
    const key = `${pitch}:${note.beat.toFixed(4)}`;
    const existing = byPosition.get(key);
    if (existing) {
      if (note.velocity > existing.velocity) existing.velocity = note.velocity;
    } else {
      byPosition.set(key, { ...note, pitch });
    }
  }

  const folded = [...byPosition.values()].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  return { notes: folded, dropped };
}
