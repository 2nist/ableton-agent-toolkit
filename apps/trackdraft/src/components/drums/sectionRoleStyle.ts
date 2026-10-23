import type { SectionRole } from "../../types/blueprint";
import type { Palette } from "../../theme/palette";
import { usePalette } from "../../theme/palette";
import { useMemo } from "react";

/** Section-band coloring for the Drums whole-song timeline — the same
 *  verse/chorus/bridge fill+rim values as HoneycombWheel's design
 *  reference (Groove Chain), so a section reads as the same "kind of
 *  place in the song" whether you're looking at Harmony's wheel or here.
 *  Roles that reference doesn't cover fall back to a neutral slate tone
 *  rather than inventing new hues nothing else in the app uses. */
/** Degree hues carry the meaning: verse is the green plate, chorus amber,
 *  bridge blue, solo red — the same colours those degrees wear on the wheel. */
const ROLE_HUE: Record<SectionRole, number | null> = {
  verse: 1,
  chorus: 0,
  bridge: 3,
  intro: null,
  pre_chorus: null,
  solo: 4,
  breakdown: 3,
  outro: null,
  custom: null,
};

/** Section-band colours for the current theme. Roles with no hue take the
 *  neutral well + grid, which is what the reference's slate band was. */
export function sectionRoleColors(P: Palette): Record<SectionRole, { fill: string; rim: string }> {
  const out = {} as Record<SectionRole, { fill: string; rim: string }>;
  for (const role of Object.keys(ROLE_HUE) as SectionRole[]) {
    const hue = ROLE_HUE[role];
    out[role] = hue === null ? { fill: P.well, rim: P.grid } : { fill: P.hues[hue].fill, rim: P.hues[hue].rim };
  }
  return out;
}

export function useSectionRoleColors(): Record<SectionRole, { fill: string; rim: string }> {
  const P = usePalette();
  return useMemo(() => sectionRoleColors(P), [P]);
}
