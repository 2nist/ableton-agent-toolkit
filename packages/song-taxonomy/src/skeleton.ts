import type { CanonicalRole, SectionToken } from "./types.js";
import { LOAD_BEARING } from "./types.js";

const MAX_SKELETON_LENGTH = 10;

/** Minimum sung lyric lines inside a section's time window for the repair
 *  below to trust it as real content rather than an ad-lib over an
 *  otherwise-instrumental intro. */
const LYRIC_EVIDENCE_THRESHOLD = 2;

export interface SkeletonResult {
  skeleton: CanonicalRole[];
  tags: string[];
}

/**
 * Relabel sections whose raw "intro" tag doesn't hold up.
 *
 * McGill's `Intro` is a catch-all for any non-vocal-sounding segment, not
 * "the song's opening" — 423 of 739 songs (57%) have a mid-song Intro,
 * averaging 2.77 per song. Verified directly against aligned LRCLIB lyrics
 * (Rare Earth, "Get Ready"): mid-song sections labeled Intro carried 12-13
 * sung lyric lines each. They are verses, not intros.
 *
 * Repair has two tiers, in order of evidence strength:
 * - Mid-song "intro" WITH lyric evidence (>= LYRIC_EVIDENCE_THRESHOLD sung
 *   lines land in its time window): reclassified to "verse" — the content
 *   is real and load-bearing, and verse is the least-committal correct
 *   guess (not chorus, which needs repetition to identify; not bridge,
 *   which is a one-off departure by definition).
 * - Mid-song "intro" with no lyric evidence (alignment unavailable, or the
 *   section really is near-silent): demoted to "link" — treated as filler
 *   and dropped from the skeleton, the weaker heuristic used when there's
 *   no positive evidence either way.
 *
 * First and last sections keep their intro/outro label regardless of
 * lyric content — a real intro can carry a spoken or ad-libbed line
 * without ceasing to be an intro.
 */
export function repairFraming(tokens: SectionToken[]): SectionToken[] {
  return tokens.map((token, index) => {
    const isTerminal = index === 0 || index === tokens.length - 1;
    if (token.role !== "intro" || isTerminal) return token;

    if ((token.lyricLineCount ?? 0) >= LYRIC_EVIDENCE_THRESHOLD) {
      return { ...token, role: "verse" as const };
    }
    return { ...token, role: "link" as const };
  });
}

/**
 * Reduce a song's (repaired) role sequence to its narrative skeleton: only
 * the roles that carry the arc, consecutive repeats collapsed to one,
 * capped at MAX_SKELETON_LENGTH so jam-band outliers don't distort distance
 * comparisons against normal-length songs.
 *
 * Measured impact of this reduction on 739 McGill songs: 469 distinct raw
 * signatures collapse to 157 distinct skeletons, with the top 20 covering
 * 71% of the corpus (vs 23% for raw signatures).
 *
 * Framing facts are returned as tags, not folded into the skeleton — doing
 * that would double the count of every distinct form (with-intro and
 * without-intro variants of the same arc), defeating the point of the
 * reduction.
 */
export function toSkeleton(tokens: SectionToken[]): SkeletonResult {
  const repaired = repairFraming(tokens);

  const tags: string[] = [];
  if (repaired.length > 0 && repaired[0].role === "intro") tags.push("has-intro");
  if (repaired.length > 0 && repaired[repaired.length - 1].role === "outro") tags.push("has-outro");

  const lastLoadBearing = [...repaired].reverse().find((t) => LOAD_BEARING.includes(t.role));
  if (lastLoadBearing?.role === "chorus") tags.push("ends-on-chorus");
  if (!repaired.some((t) => t.role === "verse" || t.role === "chorus")) tags.push("instrumental");

  const loadBearing = repaired.filter((t) => LOAD_BEARING.includes(t.role)).map((t) => t.role);

  const collapsed: CanonicalRole[] = [];
  for (const role of loadBearing) {
    if (collapsed[collapsed.length - 1] !== role) collapsed.push(role);
  }

  return { skeleton: collapsed.slice(0, MAX_SKELETON_LENGTH), tags };
}
