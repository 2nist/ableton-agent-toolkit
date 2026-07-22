import { ABLETON_DARK } from "@platform/ui-kit";

/** panelAlt has no equivalent role in @platform/ui-kit's PaletteRoles (one
 *  "panel" role, not two nested shades) — TrackDraft needs a second, lighter
 *  panel-on-panel tone (e.g. a nested card inside a panel), so it's derived
 *  here rather than hand-picked, keeping the whole palette traceable back to
 *  one source. */
function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.min(255, ((n >> shift) & 255) + amount);
  return `#${[channel(16), channel(8), channel(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Adopted directly from @platform/ui-kit's ABLETON_DARK — Ableton's
        // own webview chrome palette, not a TrackDraft-specific one. Same
        // token names as before (canvas/panel/panelAlt/edge/ink/inkMuted/
        // accent) so no component needs to change, only what they resolve
        // to. `accent` was already this exact hex before this change; every
        // other role shifts from TrackDraft's original near-black, ad hoc
        // dark theme to Ableton's actual mid-gray chrome.
        canvas: ABLETON_DARK.background,
        panel: ABLETON_DARK.panel,
        panelAlt: lighten(ABLETON_DARK.panel, 14),
        edge: ABLETON_DARK.border,
        ink: ABLETON_DARK.text,
        inkMuted: ABLETON_DARK.textMuted,
        accent: ABLETON_DARK.accent,
        accentHover: ABLETON_DARK.accentHover,
        accentActive: ABLETON_DARK.accentActive,
      },
      // Tightened from Tailwind's defaults (sm 2px/DEFAULT 4px/md 6px/lg 8px)
      // toward Live's own near-square clip cells, buttons, and knob chips —
      // barely-there rounding rather than the soft "card" radius most of
      // TrackDraft currently uses via `rounded-lg`.
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "5px",
      },
      // Two extra small steps for readouts/labels — Live's transport bar,
      // clip-grid footer counts, and knob value readouts all run smaller
      // than Tailwind's `text-xs` (12px). Named steps here so future
      // components converge on these instead of one-off `text-[10.5px]`
      // brackets (the existing pattern this whole file exists to fix).
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        "3xs": ["9px", { lineHeight: "12px" }],
      },
    },
  },
  plugins: [],
};
