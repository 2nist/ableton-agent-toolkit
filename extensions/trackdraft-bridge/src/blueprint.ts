export type {
  BlueprintSong,
  BlueprintSection,
  Chord as BlueprintChord,
  SongNotes as BlueprintSongNotes,
  ArrangementRepeat,
} from "@music-theory/song-blueprint";

import type { BlueprintSong, BlueprintSection, ArrangementRepeat } from "@music-theory/song-blueprint";

export interface SectionSpan {
  section: BlueprintSection;
  startBeat: number;
  durationBeats: number;
  /** Which repeat pass this span is (0-based) — always 0 for a section
   *  that plays once. Lets downstream generators (drums, chiefly) seed
   *  deterministic-but-*varied* output per repeat instead of accidentally
   *  rendering every pass of a repeated section byte-identical. */
  occurrenceIndex: number;
}

/**
 * Expands `song.arrangement` into the full, ordered list of
 * (sectionId, repeats, overrides) passes — filling in any section from
 * `song.sections` that no entry references as an implicit
 * `{sectionId, repeats: 1}`, appended in `sections` list order.
 *
 * This is what makes `arrangement` optional-to-author: an empty array
 * (every song today, and every brand-new song) resolves to exactly
 * "every section once, in list order" — current behavior, unchanged.
 * A section is never silently dropped from export just because it's
 * missing from `arrangement` — same "never silently drop" discipline as
 * the rest of this schema.
 */
function resolveArrangement(song: BlueprintSong): ArrangementRepeat[] {
  const covered = new Set(song.arrangement.map((entry) => entry.sectionId));
  const implicit: ArrangementRepeat[] = song.sections
    .filter((section) => !covered.has(section.id))
    .map((section) => ({ sectionId: section.id, repeats: 1 }));
  return [...song.arrangement, ...implicit];
}

/**
 * Cumulative section start/duration offsets in beats, shared by every
 * "one clip/cue point per section" generator (CuePoints, chord/drum/bass
 * clips). A section's beat length is bars * its own numerator (Live's
 * arrangement time is beats, not bars, so a numerator change mid-song
 * changes how many beats each of its bars contributes).
 *
 * Expands via `resolveArrangement` rather than iterating `song.sections`
 * directly — a section referenced by an arrangement entry with
 * `repeats > 1` produces multiple spans (one per pass), each carrying that
 * entry's `overrides` merged on top of the canonical section, so a single
 * authored Chorus can repeat without ever being duplicated into an
 * independent, driftable section object.
 */
export function sectionSpans(song: BlueprintSong): SectionSpan[] {
  const sectionsById = new Map(song.sections.map((section) => [section.id, section]));
  const spans: SectionSpan[] = [];
  let startBeat = 0;

  for (const entry of resolveArrangement(song)) {
    const base = sectionsById.get(entry.sectionId);
    if (!base) continue; // stale reference (section since deleted) — skip rather than crash
    const section: BlueprintSection = entry.overrides ? { ...base, ...entry.overrides } : base;

    // Beats here are quarter notes (Ableton's beat-time unit), so the
    // denominator matters: a 7/8 bar is 3.5 beats, not 7. `bars *
    // numerator` alone doubled every x/8 section's span — first caught
    // when an 8-bar 7/8 template produced a 56-beat drum clip.
    const denominator = 2 ** section.timeSignatureDenPower;
    const durationBeats = section.bars * section.timeSignatureNumerator * (4 / denominator);

    const repeats = Math.max(0, Math.floor(entry.repeats));
    for (let occurrenceIndex = 0; occurrenceIndex < repeats; occurrenceIndex++) {
      spans.push({ section, startBeat, durationBeats, occurrenceIndex });
      startBeat += durationBeats;
    }
  }
  return spans;
}

export interface CuePointPlan {
  name: string;
  beat: number;
}

export function planCuePoints(song: BlueprintSong): CuePointPlan[] {
  return sectionSpans(song).map(({ section, startBeat }) => ({ name: section.name, beat: startBeat }));
}

/**
 * Section names for this blueprint, used to find and clear cue points left
 * by a previous "Apply Song Blueprint" run before creating fresh ones — so
 * re-applying after an edit replaces the old markers instead of piling up
 * duplicates. A cue point only gets cleared if its name still exactly
 * matches one of the blueprint's current section names, so a marker the
 * user has since renamed away is left alone.
 */
export function cuePointNamesFor(song: BlueprintSong): Set<string> {
  return new Set(song.sections.map((section) => section.name));
}
