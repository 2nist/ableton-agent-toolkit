import { useMemo } from "react";
import type { SectionRole } from "../types/blueprint";
import { useThemeStore, type ThemeId } from "../store/themeStore";

export interface RoleStyle {
  /** Solid block background — used by the arrangement timeline. */
  bg: string;
  /** Foreground for text sitting on `bg`. */
  text: string;
  /** Short display label (roles use snake_case internally, e.g. "pre_chorus"). */
  label: string;
}

const LABEL: Record<SectionRole, string> = {
  intro: "Intro",
  verse: "Verse",
  pre_chorus: "Pre-chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  solo: "Solo",
  breakdown: "Breakdown",
  outro: "Outro",
  custom: "Custom",
};

type Tints = Record<SectionRole, { bg: string; text: string }>;

/** Chorus gets the app's one accent colour (matching the substitution and
 *  effect highlighting); everything else is a muted panel tone, so the chorus
 *  — the section that repeats and anchors the form — reads as the visual
 *  anchor of the timeline, the same way it anchors the narrative skeleton. */
const DARK: Tints = {
  intro: { bg: "#2e2e34", text: "#8a8a92" },
  verse: { bg: "#3a4a5c", text: "#cfe0ee" },
  pre_chorus: { bg: "#5c4a3a", text: "#eedcc0" },
  chorus: { bg: "#ffa500", text: "#1a1200" },
  bridge: { bg: "#4a3a5c", text: "#dfd0ee" },
  solo: { bg: "#3a5c4a", text: "#c9eedc" },
  breakdown: { bg: "#5c3a3a", text: "#eed0d0" },
  outro: { bg: "#232328", text: "#8a8a92" },
  custom: { bg: "#1a1a1e", text: "#8a8a92" },
};

/** The same nine roles as poster-paint swatches: chalky fills with ink drawn
 *  on them (every pair ≥ 6:1), and the chorus as a solid amber block so it
 *  still reads as the anchor — the dark theme's chorus accent (orange), on
 *  light stock. Kept LIGHT (butter amber, not a deep tone): the block's
 *  hand-lettered name takes the logsheet pen ink (`--ink-hand`, biro blue),
 *  which was unreadable on the ink-black block this replaced (~2:1) and lands
 *  6.3:1 here — the best name contrast of any role in the set. */
const PAPER: Tints = {
  intro: { bg: "#DED8CA", text: "#3A342B" },
  verse: { bg: "#C9D2DC", text: "#232C36" },
  pre_chorus: { bg: "#E2D3BE", text: "#3F301A" },
  chorus: { bg: "#F6E3B0", text: "#3F301A" },
  bridge: { bg: "#D6CCE2", text: "#2E2440" },
  solo: { bg: "#CBDCCB", text: "#20341F" },
  breakdown: { bg: "#E4CCCA", text: "#402020" },
  outro: { bg: "#D5D0C6", text: "#3A342B" },
  custom: { bg: "#E7DDC8", text: "#3A342B" },
};

const TINTS: Record<ThemeId, Tints> = { dark: DARK, logsheet: PAPER };

export function roleStyles(theme: ThemeId): (role: SectionRole) => RoleStyle {
  const tints = TINTS[theme];
  // One object per role per theme, cached (§S1.5). This used to build a fresh
  // object on every call, which quietly defeated `React.memo` on every consumer
  // of this hook — every canvas column re-rendered on every camera frame, so
  // panning cost a full re-render of the song instead of a transform.
  const cache = new Map<SectionRole, RoleStyle>();
  return (role) => {
    const hit = cache.get(role);
    if (hit) return hit;
    const style: RoleStyle = {
      ...(tints[role] ?? tints.custom),
      label: LABEL[role] ?? LABEL.custom,
    };
    cache.set(role, style);
    return style;
  };
}

/** Section tinting for the current theme. */
export function useRoleStyle(): (role: SectionRole) => RoleStyle {
  const theme = useThemeStore((s) => s.theme);
  return useMemo(() => roleStyles(theme), [theme]);
}
