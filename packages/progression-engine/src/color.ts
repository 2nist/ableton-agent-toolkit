export interface TensionColor {
  hue: number;
  hsl: string;
  hex: string;
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Diverging tension ramp: 0 = deep blue (resolved) -> 1 = red (high tension).
 * Kept at a low-ish lightness so white text stays readable on every color
 * (a bright yellow-green at l=0.5 washes white labels out). Use this to color
 * chord cards as the user builds a progression.
 */
export function tensionColor(tension: number): TensionColor {
  const t = Math.max(0, Math.min(1, tension));
  const hue = 220 * (1 - t);
  const sat = 0.8;
  const light = 0.36;
  return {
    hue,
    hsl: `hsl(${hue.toFixed(1)} ${(sat * 100).toFixed(1)}% ${(light * 100).toFixed(1)}%)`,
    hex: hslToHex(hue, sat, light),
  };
}
