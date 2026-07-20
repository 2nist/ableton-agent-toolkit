import type { CanonicalRole } from "./types.js";

/**
 * The single shared synonym map from a raw section label (McGill's
 * `sectionType`, a Beatles-catalog section `name`, a BlueprintSection
 * `role`/`name`) to a `CanonicalRole`.
 *
 * Labels are normalized to space-separated words before matching —
 * `_`/`-` count as word characters in JS regex, so `\bverse\b` silently
 * fails to match inside `verse_(instrumental)` or `half_verse_(climax)`
 * (verified directly: false on both) unless the separators are converted
 * to spaces first. This one preprocessing step is what makes every
 * `\bword\b` test below actually fire on real corpus labels, which are
 * almost all underscore- or hyphen-joined.
 *
 * Order matters and is deliberate: more specific patterns are tested
 * before the ones they'd otherwise be swallowed by. `pre_chorus` must be
 * tested before `chorus` (its own name contains "chorus"), and `solo` must
 * be tested before `verse` — a label like `verse_(guitar_solo)` names a
 * guitar solo, not a verse, but naive leading-word matching would say
 * verse.
 *
 * Returns null for labels that are not a section at all — "silence" is the
 * #2 most common raw label in the Beatles catalog (319 occurrences) and
 * every similar annotation gap (applause, count-in, spoken intro) belongs
 * in the same bucket: dropped entirely, not kept as "other".
 */
export function normalizeRole(rawLabel: string): CanonicalRole | null {
  const s = rawLabel
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length === 0) return null;

  if (/\b(silence|applause|noise|no ?function|count ?in|spoken|crowd)\b/.test(s)) return null;

  if (/pre ?chorus/.test(s)) return "pre_chorus";
  if (/\b(chorus|refrain)\b/.test(s)) return "chorus";
  if (/\b(bridge|middle ?eight)\b/.test(s)) return "bridge";
  if (/\bsolo\b/.test(s)) return "solo";
  if (/\bverse\b/.test(s)) return "verse";
  if (/\bintro\b/.test(s)) return "intro";
  if (/\b(outro|fade|coda|ending)\b/.test(s)) return "outro";
  if (/\b(instrumental|break(down)?|interlude|transition|link)\b/.test(s)) return "link";

  return "other";
}
