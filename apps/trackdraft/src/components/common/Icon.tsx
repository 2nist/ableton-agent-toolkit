import type { ReactElement, SVGProps } from "react";

/** The app's SVG icon set — hand-drawn geometric glyphs on a 16×16 grid,
 *  stroke-based with currentColor so they inherit text color (the icon
 *  pass that replaced every placeholder glyph in the shell chrome:
 *  views rail, inspector facets, spine strip). Kept dependency-free and
 *  tiny on purpose; a handful of icons override fill/stroke for solid
 *  shapes (transport, dots). */
export type IconName =
  | "workbench"
  | "studio"
  | "structure"
  | "harmony"
  | "drums"
  | "lyrics"
  | "melody"
  | "library"
  | "settings"
  | "mix"
  | "song"
  | "play"
  | "pause"
  | "stop"
  | "loop"
  | "undo"
  | "redo"
  | "plus"
  | "minus"
  | "fit"
  | "frame"
  | "follow"
  | "import"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down";

const PATHS: Record<IconName, ReactElement> = {
  // Layout: a panel with a left column — the section workspace.
  workbench: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M6.5 3.5v9" />
    </>
  ),
  // Vertical bars — the arrangement on a time axis.
  studio: <path d="M3 5.2v5.6M6 3.8v8.4M9 5.8v4.4M12 4.4v7.2" />,
  // Stacked layers — the section's form.
  structure: (
    <>
      <path d="M8 2.6 13.4 5.4 8 8.2 2.6 5.4Z" />
      <path d="M2.6 8.6 8 11.4l5.4-2.8" />
      <path d="M2.6 11.4 8 14.2l5.4-2.8" />
    </>
  ),
  // Two beamed notes — harmony (chords move together).
  harmony: (
    <>
      <circle cx="5" cy="11.6" r="1.6" />
      <circle cx="11" cy="10.1" r="1.6" />
      <path d="M6.6 11.6V5l6-1.5V10" />
    </>
  ),
  // A 3×3 pad — drums.
  drums: (
    <g fill="currentColor" stroke="none">
      <circle cx="4" cy="4" r="1.05" />
      <circle cx="8" cy="4" r="1.05" />
      <circle cx="12" cy="4" r="1.05" />
      <circle cx="4" cy="8" r="1.05" />
      <circle cx="8" cy="8" r="1.05" />
      <circle cx="12" cy="8" r="1.05" />
      <circle cx="4" cy="12" r="1.05" />
      <circle cx="8" cy="12" r="1.05" />
      <circle cx="12" cy="12" r="1.05" />
    </g>
  ),
  // A pencil — lyrics.
  lyrics: (
    <>
      <path d="M3.5 12.5l.9-2.9 7.1-7.1a1.3 1.3 0 0 1 1.9 1.9l-7.1 7.1-2.8.9z" />
      <path d="M10.6 3.4l2 2" />
    </>
  ),
  // A single flagged note — melody.
  melody: (
    <>
      <circle cx="5.4" cy="11.8" r="1.7" />
      <path d="M7.1 11.8V4.2" />
      <path d="M7.1 4.2c2.6.4 3.8 1.9 2.4 4.2" />
    </>
  ),
  // A folder — the browser of sources.
  library: (
    <path d="M2.5 12.5v-7a1 1 0 0 1 1-1h3l1.3 1.5h4.7a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  ),
  // A gear — settings.
  settings: (
    <>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </>
  ),
  // Sliders — mix / bend (the lens).
  mix: (
    <>
      <path d="M2.5 5.5h11M2.5 10.5h11" />
      <circle cx="5.5" cy="5.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="10.5" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
  // Info — song identity.
  song: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5v.01" />
    </>
  ),
  // Transport — solid shapes read best tiny.
  play: <path d="M5.4 3.6 12.4 8l-7 4.4Z" fill="currentColor" stroke="none" />,
  pause: <path d="M5.6 4.2v7.6M10.4 4.2v7.6" strokeWidth={2.2} />,
  stop: <rect x="4.8" y="4.8" width="6.4" height="6.4" rx="0.8" fill="currentColor" stroke="none" />,
  // A circular arrow — loop.
  loop: (
    <>
      <path d="M12.9 8a4.9 4.9 0 1 1-1.44-3.47" />
      <path d="M12.9 2.5v3h-3" />
    </>
  ),
  undo: (
    <>
      <path d="M3.2 7.4h6.5a3.3 3.3 0 0 1 0 6.6H6.4" />
      <path d="M5.8 4.8 3.2 7.4l2.6 2.6" />
    </>
  ),
  redo: (
    <>
      <path d="M12.8 7.4H6.3a3.3 3.3 0 0 0 0 6.6h3.3" />
      <path d="M10.2 4.8l2.6 2.6-2.6 2.6" />
    </>
  ),
  plus: <path d="M8 3.6v8.8M3.6 8h8.8" />,
  minus: <path d="M3.6 8h8.8" />,
  // Squeeze to fit — arrows pointing at each other in a line.
  fit: <path d="M2.6 8h10.8M5.4 5.2 2.6 8l2.8 2.8M10.6 5.2 13.4 8l-2.8 2.8" />,
  // Corner brackets — zoom to the framed section.
  frame: <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />,
  // Follow — a bar and an arrow chasing it.
  follow: (
    <>
      <path d="M4 4.5v7" />
      <path d="M7 8h6M10.4 5.4 13 8l-2.6 2.6" />
    </>
  ),
  // Import — an arrow dropping into a tray (a file coming into the song).
  import: (
    <>
      <path d="M8 2.8v6.4M5.6 6.8 8 9.2l2.4-2.4" />
      <path d="M2.9 11v1.9h10.2V11" />
    </>
  ),
  "chevron-left": <path d="M9.8 3.6 5.4 8l4.4 4.4" />,
  "chevron-right": <path d="M6.2 3.6 10.6 8l-4.4 4.4" />,
  "chevron-down": <path d="M3.6 6.2 8 10.6l4.4-4.4" />,
};

export default function Icon({
  name,
  size = 14,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
