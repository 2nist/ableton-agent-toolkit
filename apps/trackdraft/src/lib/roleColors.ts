import type { SectionRole } from "../types/blueprint";

export interface RoleStyle {
  /** Solid block background — used by the arrangement timeline. */
  bg: string;
  /** Foreground for text sitting on `bg`. */
  text: string;
  /** Short display label (roles use snake_case internally, e.g. "pre_chorus"). */
  label: string;
}

/** No role→color mapping exists elsewhere in the app (SectionCard only offers
 *  a role <select>) — this is the first one, built for the arrangement
 *  timeline but generic enough for any future section visualization.
 *  Chorus gets the app's one accent color (#ffa500, matching ProgressionTrack's
 *  substitution/effect highlighting); everything else is a muted panel tone
 *  so the chorus (the section that repeats and anchors the form) reads as
 *  the visual anchor of the timeline, the same way it's the anchor of the
 *  narrative-form skeleton. */
export const ROLE_STYLE: Record<SectionRole, RoleStyle> = {
  intro: { bg: "#2e2e34", text: "#8a8a92", label: "Intro" },
  verse: { bg: "#3a4a5c", text: "#cfe0ee", label: "Verse" },
  pre_chorus: { bg: "#5c4a3a", text: "#eedcc0", label: "Pre-chorus" },
  chorus: { bg: "#ffa500", text: "#1a1200", label: "Chorus" },
  bridge: { bg: "#4a3a5c", text: "#dfd0ee", label: "Bridge" },
  solo: { bg: "#3a5c4a", text: "#c9eedc", label: "Solo" },
  breakdown: { bg: "#5c3a3a", text: "#eed0d0", label: "Breakdown" },
  outro: { bg: "#232328", text: "#8a8a92", label: "Outro" },
  custom: { bg: "#1a1a1e", text: "#8a8a92", label: "Custom" },
};

export function roleStyle(role: SectionRole): RoleStyle {
  return ROLE_STYLE[role] ?? ROLE_STYLE.custom;
}
