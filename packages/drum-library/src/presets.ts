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
  | "54"
  // Synthesized-only patterns. These are programmed-machine idioms with no
  // acoustic-corpus analogue — E-GMD is human kit performances, and a house
  // four-on-the-floor or a trap hat grid *should* sound machine-tight, so
  // they come from `synthesize.ts` rather than the corpus. They are not in
  // song-structure's blueprint DrumPattern union on purpose: pattern choice
  // is now heuristic (see `infer.ts`), so the engine vocabulary no longer
  // has to match the schema's legacy dropdown values.
  | "four_on_floor"
  | "trap"
  | "breakbeat";

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
 *
 * Every other corpus preset pins `4/4` explicitly. Leaving it unset means
 * "whatever meter the first-picked limb happens to be in", and a full-corpus
 * bake proved that actually happens: `bridge_sparse` came back with a 5/8
 * take (2.5-beat loop) and `half_time` with a 6/8 one — grooves that drift
 * across the barline of the 4/4 sections these presets exist to serve.
 */
export const PRESETS: Record<DrumPattern, PresetTarget | null> = {
  none: null,

  kick_only: {
    feel: {},
    limbs: ["feet"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  standard: {
    feel: { density: 5, syncopation: 0.3, swing: 0.5, weight: 0.6 },
    limbs: ["feet", "snare", "cymbals"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  half_time: {
    feel: { density: 2.5, syncopation: 0.25, swing: 0.5, weight: 0.55 },
    limbs: ["feet", "snare", "cymbals"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  driving: {
    feel: { density: 8, syncopation: 0.2, swing: 0.48, weight: 0.8 },
    limbs: ["feet", "snare", "cymbals"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  bridge_sparse: {
    feel: { density: 2, syncopation: 0.3, weight: 0.35 },
    limbs: ["feet", "snare"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  intense: {
    feel: { density: 9, dynamics: 0.5, motion: 0.4, weight: 0.85 },
    limbs: ["feet", "snare", "cymbals", "toms"],
    timeSignature: { numerator: 4, denominator: 4 },
  },

  // E-GMD is a human-performed acoustic corpus; nobody plays a programmed
  // drum'n'bass break on a kit, so there is no genuine dnb material in it.
  // An earlier version asked for the closest corpus analogue (the busiest,
  // most syncopated playing available), which produced real grooves that
  // were simply not drum'n'bass. That gap is now filled the honest way:
  // `synthesize.ts` programs actual two-step patterns, and the corpus is no
  // longer consulted for this preset.
  dnb: null,

  "78": null,

  // Machine idioms — no corpus target at all; every variant is synthesized.
  four_on_floor: null,
  trap: null,
  breakbeat: null,

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
