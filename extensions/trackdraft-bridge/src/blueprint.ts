export type {
  BlueprintSong,
  BlueprintSection,
  Chord as BlueprintChord,
  SongNotes as BlueprintSongNotes,
  ArrangementRepeat,
} from "@music-theory/song-blueprint";

import { resolveArrangement, sectionDurationBeats, type BlueprintSong, type BlueprintSection } from "@music-theory/song-blueprint";

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
    // The shared helper also honours `meterMap`, so a section that changes
    // meter mid-way is the same length here as it is in the app — parity by
    // construction instead of by a duplicated formula.
    const durationBeats = sectionDurationBeats(section);

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

/**
 * Applies a song's rendered-output offset (BlueprintSong.outputOffsetBeats)
 * to any "one clip per section" plan: negative shifts everything earlier
 * against the record it was transcribed from, positive later. Clip start
 * positions move by the offset; a first clip that would begin before bar 1
 * stays at 0 and has its notes shifted instead (clamped at 0) — the same
 * clamping midiExport.ts applies to note-on ticks when rendering the SMF,
 * so both outputs sit identically against the record. Durations are kept
 * as authored in the clamped case (Live clip notes can't start before 0,
 * and a short note at bar 1 beats a dropped one).
 */
export function applyOutputOffset<T extends { startBeat: number; notes: { startTime: number }[] }>(
  plan: T[],
  offsetBeats: number,
): T[] {
  if (!offsetBeats) return plan;
  return plan.map((entry) => {
    const target = entry.startBeat + offsetBeats;
    const clipStart = Math.max(0, target);
    const noteShift = target - clipStart; // negative only for the clamp case
    if (noteShift === 0) return { ...entry, startBeat: clipStart };
    return {
      ...entry,
      startBeat: clipStart,
      notes: entry.notes.map((note) => ({ ...note, startTime: Math.max(0, note.startTime + noteShift) })),
    };
  });
}
