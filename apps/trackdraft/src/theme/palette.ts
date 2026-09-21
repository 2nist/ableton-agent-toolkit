/**
 * TrackDraft palette — the single source for colors that can't be Tailwind
 * classes (canvas/SVG draw code, inline styles).
 *
 * Tailwind's own tokens (canvas/panel/panelAlt/edge/ink/inkMuted/accent/…)
 * are derived in tailwind.config.js from @platform/ui-kit's ABLETON_DARK.
 * THIS file covers the TrackDraft-specific additions, decided hands-on in
 * the Design Lab (2026-09-21):
 *
 *   - amber — the instrument/graphic accent (D1): coexists with the
 *     interactive orange token; used for drums graphics, canvas rims,
 *     slider accent-color, ◆ ghosts.
 *   - voices — the six drums voice colors (D5): kick red · snare slate ·
 *     rim teal · hat amber · cym orange · tom purple.
 *   - deep — the near-black fill used inside drums panels/SVG wells.
 */
export const TRACKDRAFT = {
  /** Instrument/graphic accent (was an untokenized literal used 115×). */
  amber: "#E8B54A",
  /** Deep near-black fill for drums panels/SVG wells. */
  deep: "#0B0D11",
  /** Drums voice palette — the canonical assignments (D5). */
  voices: {
    kick: "#D96459",
    snare: "#8B94A1",
    rim: "#4FA3A5",
    hat: "#E8B54A",
    cym: "#D9954A",
    tom: "#9678C8",
  },
} as const;
