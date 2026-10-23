/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // The palette is a RUNTIME theme, not a build-time constant: each
        // token resolves to a CSS variable holding an "r g b" channel triple,
        // so `bg-panel/40` still works (Tailwind substitutes the alpha into
        // `<alpha-value>`) while a `[data-theme]` block can swap the whole
        // palette without touching a component.
        //
        // This used to import @platform/ui-kit's ABLETON_DARK directly. Those
        // values now live in `src/index.css` as the `:root` defaults — the
        // dark theme is still exactly Ableton's chrome, it just arrives via a
        // variable. NEVER write a hex here: a literal breaks the theme, and
        // the opacity modifiers silently stop working.
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        panelAlt: "rgb(var(--c-panelAlt) / <alpha-value>)",
        edge: "rgb(var(--c-edge) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        inkMuted: "rgb(var(--c-inkMuted) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        accentHover: "rgb(var(--c-accentHover) / <alpha-value>)",
        accentActive: "rgb(var(--c-accentActive) / <alpha-value>)",
        // Foreground for anything on `bg-accent`. Never hardcode `text-black`
        // there: the accent is orange in the dark theme and ink on paper, so
        // the readable partner colour is whatever the theme says it is.
        accentInk: "rgb(var(--c-accentInk) / <alpha-value>)",
        ok: "rgb(var(--c-ok) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        info: "rgb(var(--c-info) / <alpha-value>)",
        accentAlt: "rgb(var(--c-accentAlt) / <alpha-value>)",
        // Instrument surfaces — drawn-code colours that a few layouts still
        // express as classes (`bg-well/80` over the harmony scene).
        track: "rgb(var(--c-track) / <alpha-value>)",
        scene: "rgb(var(--c-scene) / <alpha-value>)",
        deep: "rgb(var(--c-deep) / <alpha-value>)",
        well: "rgb(var(--c-well) / <alpha-value>)",
        label: "rgb(var(--c-label) / <alpha-value>)",
        grid: "rgb(var(--c-grid) / <alpha-value>)",
        cream: "rgb(var(--c-cream) / <alpha-value>)",
      },
      fontFamily: {
        // Two more voices for the studio-log theme. `sans`/`mono` are the
        // dark theme's; `type` (typewriter) and `hand` (pencil) are what the
        // log sheet substitutes for labels and written values.
        type: ["'Courier Prime'", "'Courier New'", "Courier", "monospace"],
        hand: ["Caveat", "'Segoe Script'", "'Bradley Hand'", "cursive"],
        marker: ["'Permanent Marker'", "Caveat", "cursive"],
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
