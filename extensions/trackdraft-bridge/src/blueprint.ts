export interface BlueprintChord {
  romanNumeral: string;
  root: string;
  quality: string;
  beats: number;
}

export interface BlueprintSection {
  id: string;
  name: string;
  bars: number;
  timeSignatureNumerator: number;
  role?: string;
  chords?: BlueprintChord[];
  transitionNote?: string;
}

export interface BlueprintSongNotes {
  vocalDelivery?: string;
  dynamics?: string;
  instrumentation?: string[];
  lyricalContent?: string;
}

export interface BlueprintSong {
  id: string;
  title: string;
  bpm: number;
  sections: BlueprintSection[];
  key?: string;
  scale?: string;
  concept?: string;
  notes?: BlueprintSongNotes;
}

export interface SectionSpan {
  section: BlueprintSection;
  startBeat: number;
  durationBeats: number;
}

/**
 * Cumulative section start/duration offsets in beats, shared by every
 * "one clip/cue point per section" generator (CuePoints, chord/drum/bass
 * clips). A section's beat length is bars * its own numerator (Live's
 * arrangement time is beats, not bars, so a numerator change mid-song
 * changes how many beats each of its bars contributes).
 */
export function sectionSpans(song: BlueprintSong): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let startBeat = 0;
  for (const section of song.sections) {
    const durationBeats = section.bars * section.timeSignatureNumerator;
    spans.push({ section, startBeat, durationBeats });
    startBeat += durationBeats;
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
