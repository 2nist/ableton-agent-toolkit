import type { DrumLaneId } from "@drum/library";
import { resolveSectionLaneHits, type LaneHits } from "../../../lib/timeline/drumLaneHits";
import { stepIndexOf, STEP_SNAP } from "./meterGrid";
import type { BlueprintSection, BlueprintSong } from "../../../types/blueprint";

/**
 * Per-section cache for the resolved lane hits.
 *
 * `resolveSectionLaneHits` runs the full block compiler (`applyDrumBlocks`)
 * plus the base-variant tiling — cheap once, fatal per pointer move. The
 * view used to re-resolve EVERY section on every edit because the memo
 * depended on the whole draft section; the effect of a one-bar change was
 * five sections' worth of work and a re-render of ~5,800 SVG nodes.
 *
 * Sections are immutable, so the section object itself is a sound cache key:
 * an edit to section A produces a new object for A only, and B/C/D keep
 * their entries. The song object is checked by identity inside the entry
 * because bpm/genre/bend/notes change what the base groove resolves to.
 */
type Entry = { song: BlueprintSong | undefined; hits: LaneHits };

const cache = new WeakMap<BlueprintSection, Map<number, Entry>>();

export function laneHitsFor(
  section: BlueprintSection,
  song: BlueprintSong | undefined,
  occurrenceIndex: number,
): LaneHits {
  let byOccurrence = cache.get(section);
  if (!byOccurrence) {
    byOccurrence = new Map();
    cache.set(section, byOccurrence);
  }
  const hit = byOccurrence.get(occurrenceIndex);
  if (hit && hit.song === song) return hit.hits;
  const hits = resolveSectionLaneHits(section, song, occurrenceIndex);
  byOccurrence.set(occurrenceIndex, { song, hits });
  return hits;
}

/** The peak hit per step index for one lane — what a lane row draws. */
export function peakVelocityByStep(
  hits: readonly { beat: number; velocity: number }[],
  stepBeats: number,
  stepCount: number,
): { peak: Map<number, number>; offGrid: { beat: number; velocity: number }[] } {
  const peak = new Map<number, number>();
  const offGrid: { beat: number; velocity: number }[] = [];
  for (const h of hits) {
    const idx = stepIndexOf(h.beat, stepBeats);
    // A hit belongs to a cell only when it is ON that step. Anything else —
    // a 16th ghost under a quarter-note grid, a swung hat — is drawn as a
    // diamond at its true position rather than folded into a neighbour,
    // because folding it in is what made cells un-toggleable.
    const onStep = Math.abs(h.beat - idx * stepBeats) <= STEP_SNAP;
    if (onStep && idx >= 0 && idx < stepCount) {
      peak.set(idx, Math.max(peak.get(idx) ?? 0, h.velocity));
    } else {
      offGrid.push({ beat: h.beat, velocity: h.velocity });
    }
  }
  return { peak, offGrid };
}

/** Re-export for callers that only need the type. */
export type { LaneHits, DrumLaneId };
