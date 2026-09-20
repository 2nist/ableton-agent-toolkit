/**
 * Groove DNA — a genre's characteristic drum *family* vocabulary.
 *
 * The Bend layer (style.ts) tints HOW a groove is played; this is the
 * complementary layer that decides WHICH groove families a genre even
 * reaches for, per section role. Without it, a bossa and a rock song with
 * the same section roles resolve to the same families and only the tint
 * differs — with it, a rock chorus leans `intense` while a bossa section
 * stays light and sparse.
 *
 * A genre = a `GrooveProfile` of per-role family preferences (falling back
 * to the existing heuristic when a genre/role isn't listed). Resolution
 * order (shared by the web app and the bridge, so parity holds):
 *
 *   authored `drumPattern`  >  odd meter (7/8 → "78", …)  >
 *   genre family-lean for the role  >  existing heuristic
 *
 * v1 is family selection only (reuses existing groove content — no new
 * audio). Per-voice signature overrides, fill-family lean and
 * transition-flavor lean are the natural follow-on planes.
 */

import { inferDrumPattern } from "./infer.js";
import { PRESET_DATA } from "./presetData.js";
import type { PackedPreset } from "./presetData.js";
import type { DrumPattern } from "./presets.js";
import type { InferSection, InferSong } from "./infer.js";

/** A genre's drum-family vocabulary, keyed by section role. Each list is a
 *  preference order; the first entry that has a resolvable preset wins. */
export interface GrooveProfile {
  /** Per-role family preferences. Roles not listed fall to `fallback`. */
  patternsByRole?: Partial<Record<string, DrumPattern[]>>;
  /** Families to try when the section's role isn't listed. */
  fallback: DrumPattern[];
}

/**
 * The genre → groove-vocabulary table. Keys align with `STYLE_RECIPES`
 * (a Bend style recipe writes both `song.bend` and `song.genre`), so
 * picking a recipe sets the tint AND the groove identity together.
 */
export const GENRE_GROOVES: Record<string, GrooveProfile> = {
  rock: {
    patternsByRole: {
      intro: ["bridge_sparse", "standard"],
      verse: ["standard", "driving"],
      pre_chorus: ["driving", "standard"],
      chorus: ["intense", "driving"],
      bridge: ["bridge_sparse", "half_time"],
      solo: ["driving", "intense"],
      breakdown: ["half_time", "bridge_sparse"],
      outro: ["bridge_sparse", "standard"],
    },
    fallback: ["standard", "driving"],
  },
  pop: {
    patternsByRole: {
      intro: ["bridge_sparse", "standard"],
      verse: ["standard", "half_time"],
      pre_chorus: ["driving", "standard"],
      chorus: ["driving", "intense"],
      bridge: ["bridge_sparse", "standard"],
      solo: ["driving", "standard"],
      outro: ["standard", "bridge_sparse"],
    },
    fallback: ["standard", "driving"],
  },
  bossa: {
    patternsByRole: {
      intro: ["bridge_sparse", "standard"],
      verse: ["bridge_sparse", "standard"],
      pre_chorus: ["standard", "bridge_sparse"],
      chorus: ["standard", "bridge_sparse"],
      bridge: ["bridge_sparse", "standard"],
      solo: ["standard", "bridge_sparse"],
      outro: ["bridge_sparse", "standard"],
    },
    fallback: ["bridge_sparse", "standard"],
  },
  ballad: {
    patternsByRole: {
      intro: ["bridge_sparse", "standard"],
      verse: ["standard", "bridge_sparse"],
      pre_chorus: ["standard", "half_time"],
      chorus: ["half_time", "standard"],
      bridge: ["bridge_sparse", "standard"],
      outro: ["bridge_sparse", "standard"],
    },
    fallback: ["standard", "bridge_sparse"],
  },
  trap: {
    patternsByRole: {
      intro: ["kick_only", "trap"],
      verse: ["trap", "half_time"],
      pre_chorus: ["half_time", "trap"],
      chorus: ["trap", "half_time"],
      bridge: ["half_time", "kick_only"],
      breakdown: ["kick_only", "half_time"],
      solo: ["trap", "half_time"],
      outro: ["kick_only", "trap"],
    },
    fallback: ["trap", "half_time"],
  },
  house: {
    patternsByRole: {
      intro: ["four_on_floor", "kick_only"],
      verse: ["four_on_floor"],
      pre_chorus: ["four_on_floor"],
      chorus: ["four_on_floor"],
      bridge: ["breakbeat", "four_on_floor"],
      breakdown: ["kick_only", "four_on_floor"],
      solo: ["four_on_floor"],
      outro: ["four_on_floor", "kick_only"],
    },
    fallback: ["four_on_floor"],
  },
  "neo-soul": {
    patternsByRole: {
      intro: ["bridge_sparse", "half_time"],
      verse: ["half_time", "standard"],
      pre_chorus: ["half_time", "standard"],
      chorus: ["standard", "half_time"],
      bridge: ["bridge_sparse", "half_time"],
      solo: ["standard", "half_time"],
      outro: ["bridge_sparse", "half_time"],
    },
    fallback: ["half_time", "standard"],
  },
  "math-rock": {
    patternsByRole: {
      intro: ["standard", "bridge_sparse"],
      verse: ["standard", "driving"],
      pre_chorus: ["driving", "standard"],
      chorus: ["driving", "intense"],
      bridge: ["half_time", "standard"],
      solo: ["driving", "intense"],
      outro: ["standard", "bridge_sparse"],
    },
    fallback: ["standard", "driving"],
  },
};

/**
 * Pick a drum pattern for one section, honoring (in order):
 * 1. Odd meter — a genre lean must never put a 4/4 family on a 7/8 bar.
 * 2. The genre's family-lean for the section's role (first usable family).
 * 3. The existing heuristic (`inferDrumPattern`) when there's no genre or
 *    the lean is empty.
 *
 * This is the SINGLE resolver both the web app and the bridge call, so a
 * genre resolves to the same family on both sides (parity).
 */
export function inferPatternForGenre(
  section: InferSection,
  song: InferSong,
  genre: string | undefined,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): DrumPattern {
  const numerator = section.timeSignatureNumerator ?? 4;
  const denominator = section.timeSignatureDenominator ?? 4;
  // Odd meters win regardless of genre (mirrors inferDrumPattern's own rule:
  // dedicated families are quarter-metred — 7/8 → 3.5, 6/8 and 3/4 → 3,
  // 5/4 → 5; x/8 fives fall through so the meter-aware pick reaches the
  // mined 5/8 grooves in the role families).
  if (numerator === 7 && denominator === 8) return "78";
  if (numerator === 6 && denominator === 8) return "68";
  if (numerator === 5 && denominator === 4) return "54";
  if (numerator === 3 && denominator === 4) return "68";

  if (genre) {
    const profile = GENRE_GROOVES[genre];
    // A refrain IS a chorus (matches the heuristic's normalization).
    const role = section.role === "refrain" ? "chorus" : section.role;
    const lean = (profile?.patternsByRole?.[role ?? "custom"] ?? profile?.fallback) ?? [];
    const usable = lean.find((p) => p !== "none" && (presetData[p]?.variants.length ?? 0) > 0);
    if (usable) return usable;
  }

  return inferDrumPattern(section, song);
}
