import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PALETTES, type Palette } from "./palette";

/** The scalar instrument colours live in two places on purpose: components
 *  that draw SVG read `palette.ts`, and a handful of class-based layouts read
 *  the `--c-*` mirror in themes.css. Two sources drift, so this test pins
 *  them together. */
const MIRRORED: [keyof Palette, string][] = [
  ["track", "--c-track"],
  ["scene", "--c-scene"],
  ["deep", "--c-deep"],
  ["well", "--c-well"],
  ["label", "--c-label"],
  ["grid", "--c-grid"],
  ["cream", "--c-cream"],
];

const css = readFileSync(resolve(__dirname, "themes.css"), "utf8");

/** Pull the declarations of one selector block out of the stylesheet. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in themes.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

/** "232 181 74" → "#e8b54a" */
function toHex(triplet: string): string {
  const parts = triplet.trim().split(/\s+/).map(Number);
  return (
    "#" +
    parts.map((n) => n.toString(16).padStart(2, "0")).join("")
  ).toLowerCase();
}

function declared(selector: string, name: string): string {
  const match = block(selector).match(new RegExp(`${name}:\\s*([0-9]+\\s+[0-9]+\\s+[0-9]+)`));
  if (!match) throw new Error(`${name} not declared in ${selector}`);
  return toHex(match[1]);
}

describe("instrument palette ↔ themes.css mirror", () => {
  it("keeps the dark theme identical", () => {
    for (const [key, varName] of MIRRORED) {
      expect(declared(":root", varName), `${varName} (${key})`).toBe(
        (PALETTES.dark[key] as string).toLowerCase(),
      );
    }
  });

  it("keeps the log-sheet theme identical", () => {
    for (const [key, varName] of MIRRORED) {
      expect(declared('[data-theme="logsheet"]', varName), `${varName} (${key})`).toBe(
        (PALETTES.logsheet[key] as string).toLowerCase(),
      );
    }
  });

  it("gives every harmony degree a legible hue in both themes", () => {
    for (const theme of ["dark", "logsheet"] as const) {
      expect(PALETTES[theme].hues).toHaveLength(7);
      for (const hue of PALETTES[theme].hues) {
        expect(hue.fill).toMatch(/^#[0-9a-f]{6}$/i);
        expect(hue.rim).toMatch(/^#[0-9a-f]{6}$/i);
        expect(hue.ink).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
