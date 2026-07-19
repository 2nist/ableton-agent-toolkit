import type { FeelFeatures, Limb, TimeSignature } from "./types.js";

/**
 * TrackDraft's existing per-section drum dropdown — see
 * `packages/song-structure/src/types.ts`. It already shipped before this
 * library existed; this file is what makes each value mean something real
 * instead of the flat kick-on-1&3 pattern every preset used to produce.
 */
export type DrumPattern =
  | "none"
  | "kick_only"
  | "standard"
  | "half_time"
  | "driving"
  | "bridge_sparse"
  | "intense"
  | "dnb"
  | "78"
  | "68"
  | "54";

export interface PresetTarget {
  /** Point in feel-space a selector scores candidates against. Only the axes that matter for this preset need be set; the rest are ignored. */
  feel: Partial<FeelFeatures>;
  /** Limbs this preset draws from. `kick_only` is the reason this isn't just "all of them" everywhere. */
  limbs: Limb[];
  /** Required time signature, if the preset means one specific meter rather than "whatever the song is in". */
  timeSignature?: TimeSignature;
}

/**
 * `78`/`68`/`54` name time signatures, not feels — E-GMD's own meter, not a
 * request to reinterpret a 4/4 song. `68` (215 files) and `54` (43 files)
 * exist in the corpus. `78` does not: the full time-signature survey found
 * only 4/4, 6/8, 3/4, 5/4 and 5/8. There is no way to source a 7/8 preset
 * from this corpus, and `selectGroove` returns null for it rather than
 * quietly substituting straight 4/4 under a 7/8 label — a silently wrong
 * meter is worse than an honestly empty one.
 */
export const PRESETS: Record<DrumPattern, PresetTarget | null> = {
  none: null,

  kick_only: {
    feel: {},
    limbs: ["feet"],
  },

  standard: {
    feel: { density: 5, syncopation: 0.3, swing: 0.5, weight: 0.6 },
    limbs: ["feet", "snare", "cymbals"],
  },

  half_time: {
    feel: { density: 2.5, syncopation: 0.25, swing: 0.5, weight: 0.55 },
    limbs: ["feet", "snare", "cymbals"],
  },

  driving: {
    feel: { density: 8, syncopation: 0.2, swing: 0.48, weight: 0.8 },
    limbs: ["feet", "snare", "cymbals"],
  },

  bridge_sparse: {
    feel: { density: 2, syncopation: 0.3, weight: 0.35 },
    limbs: ["feet", "snare"],
  },

  intense: {
    feel: { density: 9, dynamics: 0.5, motion: 0.4, weight: 0.85 },
    limbs: ["feet", "snare", "cymbals", "toms"],
  },

  // E-GMD is a human-performed acoustic corpus; nobody plays a programmed
  // drum'n'bass break on a kit, so there is no genuine dnb material in it.
  // This asks for the closest analogue available — the busiest, most
  // syncopated playing in the corpus — which is a real groove, just not
  // actually drum'n'bass. See the workbench note in the library README:
  // filling this gap for real means authoring programmed patterns by hand.
  dnb: {
    feel: { density: 10, syncopation: 0.7, motion: 0.5 },
    limbs: ["feet", "snare", "cymbals"],
  },

  "78": null,

  "68": {
    feel: { density: 4, swing: 0.5 },
    limbs: ["feet", "snare", "cymbals"],
    timeSignature: { numerator: 6, denominator: 8 },
  },

  "54": {
    feel: { density: 3, swing: 0.5 },
    limbs: ["feet", "snare"],
    timeSignature: { numerator: 5, denominator: 4 },
  },
};
