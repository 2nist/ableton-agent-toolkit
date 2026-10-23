/**
 * TrackDraft palette — the single source for colors that can't be Tailwind
 * classes (SVG `fill`/`stroke`, canvas draw code, inline styles).
 *
 * Tailwind's chrome tokens (canvas/panel/edge/ink/accent/…) are CSS variables
 * in theme/themes.css. THIS file covers the *instrument* colours: the amber
 * graphic accent, the dark wells an instrument is drawn into, the six drums
 * voices, and the seven harmony hues.
 *
 * A theme has to relight all of that, not just the chrome: an SVG that fills
 * `#E8B54A` on a grey plate is invisible once the plate is paper, and there is
 * no Tailwind class to rewrite in a `fill=` attribute. So each theme carries a
 * full set here, components read them through `usePalette()`, and the scalar
 * ones are mirrored as `--c-*` variables in themes.css for the places that
 * must stay class-based (`bg-well/80`). `palette.test.ts` asserts the two
 * stay equal.
 */
import { useThemeStore, type ThemeId } from "../store/themeStore";

export interface HueSet {
  /** Plate interior. */
  fill: string;
  /** Border, and the solid used for "current" markers. */
  rim: string;
  /** Lettering drawn inside the plate. */
  ink: string;
}

export interface VoiceColors {
  kick: string;
  snare: string;
  rim: string;
  hat: string;
  cym: string;
  tom: string;
}

export interface Palette {
  /** Instrument/graphic accent — drum graphics, canvas rims, slider accents. */
  track: string;
  /** Backdrop of a drawn instrument (the scene rect, the step-grid floor). */
  scene: string;
  /** Near-black plate inside an instrument (knob bodies, pad wells). */
  deep: string;
  /** Recessed chip/knob well that floats over a scene. */
  well: string;
  /** Instrument label lettering (axis names, tick numerals). */
  label: string;
  /** Hairline grid rules inside an instrument. */
  grid: string;
  /** Preview/ghost highlight — the "this is a choice, not a chord" blue. */
  select: string;
  /** Chalk writing on a dark plate — becomes ink on paper. */
  cream: string;
  voices: VoiceColors;
  hues: HueSet[];
}

const DARK: Palette = {
  track: "#E8B54A",
  scene: "#0B0E13",
  deep: "#0B0D11",
  well: "#0E1116",
  label: "#CFCFCF",
  grid: "#565F70",
  select: "#8FD3FF",
  cream: "#F5E7C8",
  voices: {
    kick: "#D96459",
    snare: "#8B94A1",
    rim: "#4FA3A5",
    hat: "#E8B54A",
    cym: "#D9954A",
    tom: "#9678C8",
  },
  hues: [
    { fill: "#3A2F16", rim: "#E8B54A", ink: "#F2D9A0" },
    { fill: "#232C1E", rim: "#7FA86B", ink: "#C9DDBC" },
    { fill: "#172C2D", rim: "#4FA3A5", ink: "#BBDFE0" },
    { fill: "#1A2334", rim: "#5B84C4", ink: "#C2D4EF" },
    { fill: "#33201D", rim: "#D96459", ink: "#F1C4BE" },
    { fill: "#261F33", rim: "#9678C8", ink: "#D9CBEF" },
    { fill: "#232128", rim: "#8A8496", ink: "#CFCBD8" },
  ],
};

/** The studio-log reading: no LEDs, so the graphic accent is a coloured-pencil
 *  ochre and every plate is a paper tint with ink-drawn rims. The hues keep
 *  their degree→colour identity, tinted like crayon on stock. */
const LOGSHEET: Palette = {
  track: "#8A6A12",
  scene: "#EFE7D6",
  deep: "#F8F3E7",
  well: "#E7DDC8",
  label: "#26221B",
  grid: "#7D7160",
  select: "#1F5FA8",
  cream: "#26221B",
  voices: {
    kick: "#A03A31",
    snare: "#5E6672",
    rim: "#2E7375",
    hat: "#8A6A12",
    cym: "#8F5E22",
    tom: "#6A4F96",
  },
  hues: [
    { fill: "#F3E6C4", rim: "#8A6A12", ink: "#4A3806" },
    { fill: "#E3EBD6", rim: "#4E6B36", ink: "#2C3E1E" },
    { fill: "#DCEBEA", rim: "#2E7375", ink: "#1B4545" },
    { fill: "#DFE6F2", rim: "#3B5C8A", ink: "#22344F" },
    { fill: "#F1DFDB", rim: "#A03A31", ink: "#5C1F1A" },
    { fill: "#E7E1F0", rim: "#6A4F96", ink: "#3B2B55" },
    { fill: "#E6E3DC", rim: "#7A7488", ink: "#43404B" },
  ],
};

export const PALETTES: Record<ThemeId, Palette> = { dark: DARK, logsheet: LOGSHEET };

/** `#rrggbb` + 0–1 alpha → an `rgba()` string. Instrument SVG needs real
 *  transparency for "off" steps and ghost cells; a white-alpha veil only works
 *  while the plate behind it is dark. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Non-reactive read, for a draw loop that already re-runs every frame. */
export function paletteFor(theme: ThemeId): Palette {
  return PALETTES[theme];
}

/** Reactive read — subscribes to the theme, so switching repaints every
 *  instrument instead of leaving the old ink on the new paper. */
export function usePalette(): Palette {
  return PALETTES[useThemeStore((s) => s.theme)];
}

/** Kept for older call sites that imported the raw constants. Prefer
 *  `usePalette()` in components: these are the dark theme's values and do not
 *  follow the theme. */
export const TRACKDRAFT = {
  amber: DARK.track,
  deep: DARK.deep,
  voices: DARK.voices,
} as const;
