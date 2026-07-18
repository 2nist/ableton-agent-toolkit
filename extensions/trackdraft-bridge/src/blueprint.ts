export interface BlueprintChord {
  romanNumeral: string;
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

export interface CuePointPlan {
  name: string;
  beat: number;
}

/**
 * Cumulative section start offsets in beats. A section's beat length is
 * bars * its own numerator (Live's arrangement time is beats, not bars,
 * so a numerator change mid-song changes how many beats each of its bars
 * contributes).
 */
export function planCuePoints(song: BlueprintSong): CuePointPlan[] {
  const plan: CuePointPlan[] = [];
  let beat = 0;
  for (const section of song.sections) {
    plan.push({ name: section.name, beat });
    beat += section.bars * section.timeSignatureNumerator;
  }
  return plan;
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
