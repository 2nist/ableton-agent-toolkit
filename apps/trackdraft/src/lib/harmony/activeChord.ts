/**
 * "Which chord is sounding right now" — the lookup behind every playback
 * highlight. Chord occurrences come from `resolveChordOccurrences`, so the
 * answer always matches what the generators (and the export) actually play.
 */

export interface TimedChordLike {
  startTime: number;
  chord: { id: string };
}

/**
 * The chord whose occurrence covers `beat` (section-relative), or null when
 * the playhead is outside the section. A beat before the first chord's onset
 * (possible with a syncopated push) counts as the first chord.
 */
export function activeChordIdAt(
  occurrences: TimedChordLike[],
  beat: number | null,
): string | null {
  if (beat == null || occurrences.length === 0) return null;
  let active: string | null = null;
  for (let index = occurrences.length - 1; index >= 0; index -= 1) {
    if (occurrences[index].startTime <= beat + 1e-6) {
      active = occurrences[index].chord.id;
      break;
    }
  }
  return active ?? occurrences[0]?.chord.id ?? null;
}

/** Step index of the active chord inside a walk, for highlighting one hex. */
export function activeStepIndex(
  occurrences: TimedChordLike[],
  beat: number | null,
): number {
  const id = activeChordIdAt(occurrences, beat);
  if (!id) return -1;
  return occurrences.findIndex((occurrence) => occurrence.chord.id === id);
}
