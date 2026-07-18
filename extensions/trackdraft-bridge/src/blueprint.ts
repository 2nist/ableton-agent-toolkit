export interface BlueprintSection {
  id: string;
  name: string;
  bars: number;
  timeSignatureNumerator: number;
}

export interface BlueprintSong {
  id: string;
  title: string;
  bpm: number;
  sections: BlueprintSection[];
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
