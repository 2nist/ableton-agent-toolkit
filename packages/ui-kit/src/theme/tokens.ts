/**
 * Design tokens: a fixed, small set of semantic ROLES (not per-widget
 * colors), plus one hue-parameterized generator that derives every role
 * from a single input hue via HSL math. The generator is the reusable
 * piece — pass any hue, get a coherent dark palette back.
 *
 * (Historical note: the role-set + hue-generator approach was inspired by
 * a Reaper theming script's design, but this is a from-scratch TypeScript
 * implementation with Ableton-specific presets below — no shared code.)
 */

export interface PaletteRoles {
  background: string;
  panel: string;
  text: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  border: string;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Derives a full role palette from a single hue (0-360). Fixed
 * saturation/lightness offsets per role, mirroring the documented pattern:
 * dark, desaturated background; near-white, slightly warm text; a saturated
 * mid-lightness accent; lighter/darker accent variants for hover/active.
 */
export function generateFromHue(hue: number): PaletteRoles {
  return {
    background: hslToHex(hue, 0.25, 0.13),
    panel: hslToHex(hue, 0.22, 0.19),
    text: hslToHex(hue + 20, 0.15, 0.92),
    textMuted: hslToHex(hue + 20, 0.1, 0.65),
    accent: hslToHex(hue, 0.65, 0.5),
    accentHover: hslToHex(hue, 0.65, 0.58),
    accentActive: hslToHex(hue, 0.65, 0.42),
    border: hslToHex(hue, 0.2, 0.27),
  };
}

/** Named presets — fixed hues through the same generator, not hand-tuned per-role. */
export const PRESETS: Record<string, PaletteRoles> = {
  slate: generateFromHue(220),
  blue: generateFromHue(210),
  green: generateFromHue(150),
  purple: generateFromHue(265),
  orange: generateFromHue(28),
};

/** Ableton's own dark chrome — a fixed palette, not hue-generated, so webview UI can match the host it's embedded in. Values from the SDK's own webview boilerplate (docs/essentials/interface/2-user-interface-with-webviews). */
export const ABLETON_DARK: PaletteRoles = {
  background: "#383838",
  panel: "#4E4E4E",
  text: "#FFFFFF",
  textMuted: "#B0B0B0",
  accent: "#FFA500",
  accentHover: "#FFB733",
  accentActive: "#CC8400",
  border: "#2C2C2C",
};
