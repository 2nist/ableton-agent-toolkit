import type { ScaleType, SubstitutionGroup } from "./types";

/**
 * Chord substitution rules for all 7 modes
 *
 * Each mode has substitution groups for each scale degree (1-7),
 * with 3 substitute options per degree and a theoretical explanation.
 *
 * Total: 7 modes × 7 degrees × 3 subs = 147 substitution options (49 groups)
 * Each group also contains modal interchange context for additional substitutions
 *
 * Source: APC64 chord editor (apc64_chord_editor.lua, lines 35-98)
 * Theorized with functional harmony labels by the original author.
 */

export const CHORD_SUBSTITUTIONS: Record<ScaleType, SubstitutionGroup[]> = {
  ionian: [
    {
      base: 1,
      subs: [
        { degree: 2, explanation: "Relative minor (vi-I)" },
        { degree: 4, explanation: "Subdominant (IV)" },
        { degree: 6, explanation: "Mediant bridge" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 4, explanation: "Pre-dominant (ii-IV)" },
        { degree: 6, explanation: "Deceptive (ii-vi)" },
        { degree: 7, explanation: "Leading tone dim" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 1, explanation: "Tonic substitute" },
        { degree: 6, explanation: "Relative minor" },
        { degree: 5, explanation: "Chromatic approach" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 2, explanation: "Subdominant parallel" },
        { degree: 1, explanation: "Plagal cadence" },
        { degree: 5, explanation: "Dominant prep" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 7, explanation: "Leading tone (vii-I)" },
        { degree: 3, explanation: "Deceptive (V-iii)" },
        { degree: 6, explanation: "Deceptive (V-vi)" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 1, explanation: "Relative (vi-I)" },
        { degree: 4, explanation: "Subdominant prep" },
        { degree: 2, explanation: "Parallel minor" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 5, explanation: "Dominant substitute" },
        { degree: 3, explanation: "Mediant" },
        { degree: 2, explanation: "Passing chord" },
      ],
    },
  ],

  dorian: [
    {
      base: 1,
      subs: [
        { degree: 4, explanation: "Subdominant" },
        { degree: 7, explanation: "Subtonic" },
        { degree: 2, explanation: "Supertonic" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 5, explanation: "Minor v" },
        { degree: 1, explanation: "Tonic resolution" },
        { degree: 4, explanation: "Pre-dominant" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 7, explanation: "Modal interchange" },
        { degree: 5, explanation: "Dominant approach" },
        { degree: 1, explanation: "Tonic" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 1, explanation: "Subdominant-tonic" },
        { degree: 2, explanation: "ii-IV" },
        { degree: 6, explanation: "Natural 6th" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 1, explanation: "Dominant-tonic" },
        { degree: 7, explanation: "Subtonic-tonic" },
        { degree: 3, explanation: "Mediant" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 4, explanation: "Modal color" },
        { degree: 2, explanation: "Passing" },
        { degree: 7, explanation: "Leading approach" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 5, explanation: "Subtonic-dominant" },
        { degree: 3, explanation: "Modal III" },
        { degree: 4, explanation: "Subdominant" },
      ],
    },
  ],

  phrygian: [
    {
      base: 1,
      subs: [
        { degree: 7, explanation: "Phrygian cadence" },
        { degree: 2, explanation: "Neapolitan" },
        { degree: 5, explanation: "Dominant" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 1, explanation: "Neapolitan resolution" },
        { degree: 7, explanation: "Descending" },
        { degree: 3, explanation: "Major III" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 1, explanation: "Relative major" },
        { degree: 7, explanation: "Modal VII" },
        { degree: 5, explanation: "Dominant prep" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 2, explanation: "Minor iv" },
        { degree: 6, explanation: "Submediant" },
        { degree: 1, explanation: "Tonic" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 7, explanation: "Phrygian VII" },
        { degree: 3, explanation: "Relative major" },
        { degree: 1, explanation: "Minor v" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 4, explanation: "Modal subdominant" },
        { degree: 2, explanation: "Neapolitan prep" },
        { degree: 7, explanation: "Leading" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 1, explanation: "Phrygian cadence" },
        { degree: 5, explanation: "Modal dominant" },
        { degree: 3, explanation: "III resolution" },
      ],
    },
  ],

  lydian: [
    {
      base: 1,
      subs: [
        { degree: 2, explanation: "Lydian II" },
        { degree: 5, explanation: "Dominant" },
        { degree: 3, explanation: "Mediant" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 5, explanation: "V/V (secondary)" },
        { degree: 7, explanation: "Leading dim" },
        { degree: 4, explanation: "Tritone sub" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 6, explanation: "Relative minor" },
        { degree: 1, explanation: "Tonic" },
        { degree: 5, explanation: "Mediant-dominant" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 2, explanation: "Raised IV" },
        { degree: 5, explanation: "Tritone" },
        { degree: 6, explanation: "Submediant" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 1, explanation: "Authentic cadence" },
        { degree: 3, explanation: "Deceptive" },
        { degree: 7, explanation: "Leading" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 4, explanation: "Lydian color" },
        { degree: 2, explanation: "Relative" },
        { degree: 1, explanation: "Submediant-tonic" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 5, explanation: "Leading-dominant" },
        { degree: 3, explanation: "Diminished sub" },
        { degree: 2, explanation: "vii-II" },
      ],
    },
  ],

  mixolydian: [
    {
      base: 1,
      subs: [
        { degree: 7, explanation: "Subtonic resolve" },
        { degree: 4, explanation: "Subdominant" },
        { degree: 5, explanation: "Modal V" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 5, explanation: "Supertonic-V" },
        { degree: 4, explanation: "Pre-dominant" },
        { degree: 7, explanation: "Passing" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 6, explanation: "Relative minor" },
        { degree: 1, explanation: "Mediant-tonic" },
        { degree: 7, explanation: "iii-VII" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 7, explanation: "Mixolydian color" },
        { degree: 2, explanation: "Subdominant minor" },
        { degree: 1, explanation: "Plagal" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 7, explanation: "Modal VII-I" },
        { degree: 1, explanation: "Dominant-tonic" },
        { degree: 3, explanation: "V-iii" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 4, explanation: "Submediant" },
        { degree: 2, explanation: "vi-ii" },
        { degree: 1, explanation: "Relative" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 1, explanation: "Subtonic cadence" },
        { degree: 5, explanation: "VII-V" },
        { degree: 4, explanation: "Modal color" },
      ],
    },
  ],

  aeolian: [
    {
      base: 1,
      subs: [
        { degree: 6, explanation: "Minor i-VI" },
        { degree: 4, explanation: "Subdominant" },
        { degree: 7, explanation: "Subtonic" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 4, explanation: "Diminished ii" },
        { degree: 7, explanation: "Passing" },
        { degree: 5, explanation: "Pre-dominant" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 1, explanation: "Relative major" },
        { degree: 6, explanation: "Mediant-relative" },
        { degree: 5, explanation: "III-V" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 1, explanation: "Subdominant-tonic" },
        { degree: 6, explanation: "Plagal prep" },
        { degree: 2, explanation: "iv-ii" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 1, explanation: "Minor v resolve" },
        { degree: 7, explanation: "Subtonic" },
        { degree: 3, explanation: "Deceptive" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 4, explanation: "Relative-subdom" },
        { degree: 3, explanation: "VI-III" },
        { degree: 1, explanation: "Major VI" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 3, explanation: "Subtonic-relative" },
        { degree: 5, explanation: "VII-v" },
        { degree: 1, explanation: "Modal cadence" },
      ],
    },
  ],

  locrian: [
    {
      base: 1,
      subs: [
        { degree: 2, explanation: "Diminished tension" },
        { degree: 5, explanation: "Tritone resolve" },
        { degree: 6, explanation: "Relative" },
      ],
    },
    {
      base: 2,
      subs: [
        { degree: 6, explanation: "Locrian II-VI" },
        { degree: 4, explanation: "Neapolitan" },
        { degree: 1, explanation: "ii-i" },
      ],
    },
    {
      base: 3,
      subs: [
        { degree: 6, explanation: "Relative stability" },
        { degree: 1, explanation: "Mediant" },
        { degree: 5, explanation: "Major III" },
      ],
    },
    {
      base: 4,
      subs: [
        { degree: 2, explanation: "Suspended tension" },
        { degree: 6, explanation: "Modal IV" },
        { degree: 1, explanation: "Resolution" },
      ],
    },
    {
      base: 5,
      subs: [
        { degree: 2, explanation: "Diminished V" },
        { degree: 6, explanation: "Tritone sub" },
        { degree: 3, explanation: "Major V" },
      ],
    },
    {
      base: 6,
      subs: [
        { degree: 3, explanation: "Relative escape" },
        { degree: 4, explanation: "Subdominant" },
        { degree: 2, explanation: "VI-II" },
      ],
    },
    {
      base: 7,
      subs: [
        { degree: 6, explanation: "Subtonic-relative" },
        { degree: 4, explanation: "Modal VII" },
        { degree: 2, explanation: "Passing" },
      ],
    },
  ],
};

/**
 * Get substitutions for a specific scale degree in a given mode.
 */
export function getSubstitutionsForDegree(
  mode: ScaleType,
  degree: number
): SubstitutionGroup | undefined {
  return CHORD_SUBSTITUTIONS[mode]?.find((g) => g.base === degree);
}

/**
 * Get all available substitution targets for a given degree and mode.
 * Returns a flat list of {degree, explanation} pairs.
 */
export function getSubstitutionOptions(
  mode: ScaleType,
  degree: number
): Array<{ degree: number; explanation: string }> {
  const group = getSubstitutionsForDegree(mode, degree);
  return group?.subs ?? [];
}

/**
 * Count total substitution rules across all modes.
 */
export function countSubstitutions(): number {
  return Object.values(CHORD_SUBSTITUTIONS).reduce(
    (total, groups) =>
      total + groups.reduce((sum, g) => sum + g.subs.length, 0),
    0
  );
}