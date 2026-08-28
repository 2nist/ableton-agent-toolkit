import type { DrumPattern } from "./presets.js";

/**
 * Heuristic pattern selection — the default when a section has no explicit
 * `drumPattern` override.
 *
 * TrackDraft's Structure tab now has a per-section "Drums" dropdown that
 * lets a user choose a specific pattern and variant, which the bridge's
 * `planDrumClips` reads directly. This function is the fallback for any
 * section left on "auto (heuristic)": pattern names like `driving` or
 * `bridge_sparse` are engine vocabulary, not something a songwriter should
 * be forced to pick from a flat list for every section. The blueprint
 * already carries every signal the choice depends on — section role,
 * dynamics, meter, tempo, and the song's own description of itself — so
 * the heuristic picks a sensible default that can still be overridden.
 *
 * Inputs are structural (plain fields, not schema imports) so this package
 * stays decoupled from `@music-theory/song-structure` — the engine's
 * pattern vocabulary is already a superset of the schema's legacy one.
 */

export interface InferSection {
  /** SectionRole in the blueprint schema: intro/verse/pre_chorus/chorus/bridge/solo/breakdown/outro/custom. */
  role?: string;
  /** VelocityPreset: ppp..fff. */
  velocity?: string;
  timeSignatureNumerator?: number;
  /** Actual denominator (8 for x/8), not the den-power the schema stores. */
  timeSignatureDenominator?: number;
  name?: string;
}

export interface InferSong {
  bpm?: number;
  title?: string;
  concept?: string;
  notes?: { instrumentation?: string[]; dynamics?: string; vocalDelivery?: string; lyricalContent?: string };
}

export type DrumStyle = "acoustic" | "electronic";

const VELOCITY_RANK: Record<string, number> = {
  ppp: 0, pp: 1, p: 2, mp: 3, mf: 4, f: 5, ff: 6, fff: 7,
};

/**
 * Markers that read as "this song is programmed/electronic". Matched against
 * the song's concept text, instrumentation list and title — the only places
 * a blueprint describes its own sound. Word-boundary matching so "housed"
 * or "entrapment" don't trigger.
 */
const ELECTRONIC_MARKERS =
  /\b(electronic|electro|synth\w*|edm|house|techno|trance|trap|dnb|drum\s*(?:'n'|and|&)\s*bass|jungle|dubstep|club|dance|808|909|drum\s*machine|programmed|glitch|idm|breakbeat)\b/i;

/**
 * Whether the song reads as electronic or acoustic — the coarse fork that
 * decides which pattern family the per-section mapping draws from.
 */
export function inferDrumStyle(song: InferSong): DrumStyle {
  const haystack = [
    song.title,
    song.concept,
    song.notes?.instrumentation?.join(" "),
    song.notes?.dynamics,
    song.notes?.lyricalContent,
  ]
    .filter(Boolean)
    .join(" ");
  return ELECTRONIC_MARKERS.test(haystack) ? "electronic" : "acoustic";
}

function velocityRank(velocity: string | undefined): number {
  return VELOCITY_RANK[velocity ?? "mf"] ?? 4;
}

/**
 * Pick a pattern for one section.
 *
 * Meter wins first — an odd-meter section *must* get an odd-meter groove
 * (a 4/4 pattern tiled into 7/8 bars is structurally wrong, which is worse
 * than any feel mismatch). Then the song's style (electronic vs acoustic)
 * picks a family, and within the family the section's role and dynamics
 * pick the pattern. The mapping is deliberately a plain readable table —
 * this is the part of the engine a future session will most want to tweak.
 */
export function inferDrumPattern(section: InferSection, song: InferSong = {}): DrumPattern {
  const numerator = section.timeSignatureNumerator ?? 4;
  const denominator = section.timeSignatureDenominator ?? 4;

  // Odd meters, regardless of style or role.
  if (numerator === 7 && denominator === 8) return "78";
  if (numerator === 6 && denominator === 8) return "68";
  if (numerator === 5) return "54";
  // 3/4 shares the 6/8 grooves' 3-quarter-beat bar; a compound-feel waltz
  // is an approximation, but an honest one — the corpus has no simple-3/4
  // preset and a 4-beat groove in a 3-beat bar is not an option.
  if (numerator === 3 && denominator === 4) return "68";

  const rank = velocityRank(section.velocity);
  const quiet = rank <= 2; // p and below
  const loud = rank >= 6; // ff and above
  // A refrain IS a chorus (Beatles-style song sections are often labelled
  // "refrain") — normalize so it gets the same pattern/dynamics a chorus
  // does instead of falling through to `default`.
  const role = (section.role === "refrain" ? "chorus" : section.role) ?? "custom";
  const bpm = song.bpm ?? 120;

  if (inferDrumStyle(song) === "electronic") {
    // Tempo splits the electronic family: ≥160 is dnb territory, the trap
    // marker or a mid-tempo groove with heavy 808 language reads half-time,
    // everything else four-on-the-floor.
    if (bpm >= 160) {
      switch (role) {
        case "intro": return quiet ? "kick_only" : "breakbeat";
        case "breakdown":
        case "bridge": return "trap";
        case "outro": return "breakbeat";
        default: return "dnb";
      }
    }
    const trapLeaning = /\b(trap|808|hip\s*hop|hiphop)\b/i.test(
      [song.concept, song.notes?.instrumentation?.join(" ")].filter(Boolean).join(" "),
    );
    if (trapLeaning) {
      switch (role) {
        case "intro":
        case "outro": return quiet ? "kick_only" : "trap";
        case "bridge":
        case "breakdown": return "half_time";
        default: return "trap";
      }
    }
    switch (role) {
      case "intro": return quiet ? "kick_only" : "four_on_floor";
      case "verse": return "four_on_floor";
      case "pre_chorus": return "four_on_floor";
      case "chorus":
      case "solo": return "four_on_floor";
      case "bridge": return "breakbeat";
      case "breakdown": return quiet ? "kick_only" : "half_time";
      case "outro": return quiet ? "kick_only" : "four_on_floor";
      default: return "four_on_floor";
    }
  }

  // Acoustic family.
  switch (role) {
    // Intros settle into the song: keep them sparse up to mf so a short
    // intro reads as a setup, not a full groove (the "train wreck" feel).
    case "intro": return rank <= 4 ? "bridge_sparse" : "standard";
    case "verse": return quiet ? "bridge_sparse" : "standard";
    case "pre_chorus": return "driving";
    case "chorus": return loud ? "intense" : "driving";
    case "solo": return loud ? "intense" : "driving";
    case "bridge": return "bridge_sparse";
    case "breakdown": return quiet ? "kick_only" : "half_time";
    case "outro": return quiet ? "bridge_sparse" : "half_time";
    default: return quiet ? "bridge_sparse" : loud ? "driving" : "standard";
  }
}
