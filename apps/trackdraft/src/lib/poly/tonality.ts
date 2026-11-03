/**
 * A section's own key and mode — set, or genuinely cleared.
 *
 * "Use the song's key" has to mean *no field*, not "the song's key, copied in".
 * A copied key stops following the song: change the song from C to D and that
 * section stays in C for no reason the writer can see. So clearing deletes the
 * field, and this is the only place that decides it.
 */

import type { NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSection, TonicRegion } from "../../types/blueprint";

export interface TonalityPatch {
  /** `null` clears the override; `undefined` leaves it alone. */
  key?: NoteName | null;
  scale?: ScaleType | null;
}

export function withSectionTonality(
  section: BlueprintSection,
  patch: TonalityPatch,
): BlueprintSection {
  const next: BlueprintSection = { ...section };
  if (patch.key !== undefined) {
    if (patch.key === null) delete next.key;
    else next.key = patch.key;
  }
  if (patch.scale !== undefined) {
    if (patch.scale === null) delete next.scale;
    else next.scale = patch.scale;
  }
  return next;
}

/** Where a section changes key, as a fraction across its own width. */
export interface ModulationMark {
  /** 0..1 across the column. */
  at: number;
  bar: number;
  key: NoteName;
  scale: ScaleType;
  label: string;
  title: string;
}

/**
 * The modulations inside a section, positioned rather than counted.
 *
 * The `+N` badge says something happened; this says *where*, which is what a
 * musician needs to line a key change up against a lyric or a drum fill. A
 * region starting on the first beat is the section's home, not a change, so it
 * is not a mark.
 */
export function modulationMarks(
  section: Pick<BlueprintSection, "tonicRegions">,
  durationBeats: number,
  beatsPerBar = 4,
): ModulationMark[] {
  if (durationBeats <= 0) return [];
  const bar = Math.max(0.25, beatsPerBar);
  return (section.tonicRegions ?? [])
    .filter((region) => region.startBeat > 0)
    .map((region: TonicRegion) => {
      const at = Math.min(1, Math.max(0, region.startBeat / durationBeats));
      const barIndex = Math.floor(region.startBeat / bar) + 1;
      const home = `${region.key} ${region.scale}`;
      return {
        at,
        bar: barIndex,
        key: region.key,
        scale: region.scale,
        label: region.key,
        title: `Key changes to ${home} at bar ${barIndex}${
          region.source === "inferred" ? " (suggested, not authored)" : ""
        }`,
      };
    });
}
