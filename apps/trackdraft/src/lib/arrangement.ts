import { resolveArrangement, sectionDurationBeats, beatsPerBar } from "../types/blueprint";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";

export interface SectionSpan {
  sectionId: string;
  section: BlueprintSection;
  /** Which repeat pass this span is (0-based) — always 0 for a section
   *  that plays once. Mirrors extensions/trackdraft-bridge/src/blueprint.ts's
   *  `occurrenceIndex`, so a repeated section (e.g. three Chorus passes)
   *  renders as three distinct timeline blocks, not one. */
  occurrenceIndex: number;
  variation?: string;
  startBeat: number;
  durationBeats: number;
  startBar: number;
  bars: number;
}

/**
 * The app-side equivalent of the bridge's `sectionSpans`
 * (extensions/trackdraft-bridge/src/blueprint.ts) — same algorithm, built
 * from the same shared `resolveArrangement`/`sectionDurationBeats`/
 * `beatsPerBar` math (`@music-theory/song-blueprint`) so the Studio tab's
 * timeline can't drift from what the Ableton extension actually renders.
 * Deliberately not importing the bridge's own copy: that file lives in a
 * separate extension package the web app has no dependency on, and the
 * underlying math is already shared, not duplicated.
 */
export function sectionSpans(song: BlueprintSong): SectionSpan[] {
  const sectionsById = new Map(song.sections.map((section) => [section.id, section]));
  const spans: SectionSpan[] = [];
  let startBeat = 0;

  for (const entry of resolveArrangement(song)) {
    const base = sectionsById.get(entry.sectionId);
    if (!base) continue; // stale reference (section since deleted) — skip rather than crash
    const section: BlueprintSection = entry.overrides ? { ...base, ...entry.overrides } : base;
    const durationBeats = sectionDurationBeats(section);
    const bpb = beatsPerBar(section);

    const repeats = Math.max(0, Math.floor(entry.repeats));
    for (let occurrenceIndex = 0; occurrenceIndex < repeats; occurrenceIndex++) {
      spans.push({
        sectionId: entry.sectionId,
        section,
        occurrenceIndex,
        variation: entry.variation,
        startBeat,
        durationBeats,
        startBar: startBeat / bpb,
        bars: section.bars,
      });
      startBeat += durationBeats;
    }
  }
  return spans;
}

/** Total song length in bars across every expanded pass — the timeline's
 *  ruler needs this, and it's cheap to derive from the last span rather
 *  than re-summing bars separately. */
export function totalBars(spans: SectionSpan[]): number {
  const last = spans[spans.length - 1];
  if (!last) return 0;
  return last.startBar + last.bars;
}
