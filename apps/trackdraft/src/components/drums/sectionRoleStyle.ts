import type { SectionRole } from "../../types/blueprint";

/** Section-band coloring for the Drums whole-song timeline — the same
 *  verse/chorus/bridge fill+rim values as HoneycombWheel's design
 *  reference (Groove Chain), so a section reads as the same "kind of
 *  place in the song" whether you're looking at Harmony's wheel or here.
 *  Roles that reference doesn't cover fall back to a neutral slate tone
 *  rather than inventing new hues nothing else in the app uses. */
export const SECTION_ROLE_COLOR: Record<SectionRole, { fill: string; rim: string }> = {
  verse: { fill: "#232C1E", rim: "#7FA86B" },
  chorus: { fill: "#3A2F16", rim: "#E8B54A" },
  bridge: { fill: "#1A2334", rim: "#5B84C4" },
  intro: { fill: "#1A1D24", rim: "#565F70" },
  pre_chorus: { fill: "#1A1D24", rim: "#8B94A1" },
  solo: { fill: "#2E1B1A", rim: "#D96459" },
  breakdown: { fill: "#1A2334", rim: "#5B84C4" },
  outro: { fill: "#1A1D24", rim: "#565F70" },
  custom: { fill: "#1A1D24", rim: "#565F70" },
};
