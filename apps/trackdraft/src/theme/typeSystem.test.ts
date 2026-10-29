/**
 * The studio-log type system exists in two places: the app's `themes.css` and
 * the design prototype in `docs/design/prototypes/sketchbook-theme.html`.
 *
 * They drifted exactly once and the symptom was a judgement call — "the app
 * doesn't look like the mock" — which no test could catch. This suite turns it
 * into a red test: the prototype's four voice tokens and its written ink must
 * equal the app's.
 *
 * If you change a voice on purpose, change BOTH files in the same commit.
 *
 * The second half of the suite locks the two properties that are invisible in
 * a diff but decided the whole look: the tape's size ramp, and the fact that
 * the naming voice is declared BELOW the pen (equal specificity, so order is
 * what wins — a `.marker-label hand-value` call site silently rendered in the
 * pen when it was declared above).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTES } from "./palette";
import { resolve } from "node:path";

const APP_CSS = readFileSync(resolve(__dirname, "themes.css"), "utf8");
const MOCK = readFileSync(
  resolve(__dirname, "../../../../docs/design/prototypes/sketchbook-theme.html"),
  "utf8",
);

/** First font family in a CSS value, quotes stripped: "Kalam", "Segoe" → Kalam. */
function firstFamily(value: string): string {
  const m = value.match(/(['"])([^'"]+)\1/);
  return (m ? m[2] : value.split(",")[0]).trim();
}

function mockToken(name: string): string {
  const m = MOCK.match(new RegExp(`--${name}:([^;]+);`));
  if (!m) throw new Error(`prototype has no --${name} token`);
  return m[1].trim();
}

function appPen(): string {
  const m = APP_CSS.match(/--hand-pen:\s*([^;]+);/);
  if (!m) throw new Error("themes.css has no --hand-pen token");
  return m[1].trim();
}

function appInk(): string {
  const m = APP_CSS.match(/--ink-hand:\s*([^;]+);/);
  if (!m) throw new Error("themes.css has no --ink-hand token");
  return m[1].trim();
}

function mockLogsheetInk(): string {
  // the log-sheet block only — the dark theme keeps white ink
  const block = MOCK.slice(MOCK.indexOf('[data-theme="logsheet"]'));
  const m = block.match(/--handInk:\s*([^;]+);/);
  if (!m) throw new Error("prototype has no log-sheet --handInk");
  return m[1].trim();
}

describe("type system — app and prototype agree", () => {
  it("uses the same pen", () => {
    expect(firstFamily(appPen())).toBe(firstFamily(mockToken("hand")));
  });

  it("uses the same printed face", () => {
    // `--ui-font` is declared twice: the dark theme's system sans first, the
    // log sheet's typewriter second. The paper one is the last.
    const declared = [...APP_CSS.matchAll(/--ui-font:\s*([^;]+);/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(1);
    expect(firstFamily(declared[declared.length - 1])).toBe(firstFamily(mockToken("type")));
  });

  it("uses the same marker on tape", () => {
    // the app names it in the tape recipe (via --marker-pen); the mock in --marker
    const appTape = APP_CSS.match(/\.tape-label \{[\s\S]*?font-family:\s*([^;]+);/);
    expect(appTape).not.toBeNull();
    // The recipe points at a token; resolve the indirection so the voice
    // itself is compared, not the variable's name.
    const value = appTape![1].trim();
    const varRef = value.match(/^var\((--[\w-]+)\)$/);
    const stack = varRef
      ? APP_CSS.match(new RegExp(`${varRef[1]}:\\s*([^;]+);`))?.[1].trim()
      : value;
    expect(stack).toBeDefined();
    expect(firstFamily(stack!)).toBe(firstFamily(mockToken("marker")));
  });

  it("writes in the same ink", () => {
    expect(appInk().toLowerCase()).toBe(mockLogsheetInk().toLowerCase());
  });

  it("sizes the tape as one ramp, not per call site", () => {
    // Read the size out of each variant's own block: `.tape-label` first, then
    // the three modifiers.
    const sizeOf = (selector: string) => {
      const at = APP_CSS.indexOf(selector + " {");
      if (at < 0) throw new Error(`themes.css has no ${selector}`);
      const block = APP_CSS.slice(at, APP_CSS.indexOf("}", at));
      const m = block.match(/--tape-size:\s*(\d+)px/);
      if (!m) throw new Error(`${selector} sets no --tape-size`);
      return Number(m[1]);
    };
    const base = sizeOf(".tape-label");
    expect(sizeOf(".tape-label--sm")).toBeLessThan(base);
    expect(base).toBeLessThan(sizeOf(".tape-label--lg"));
    // md is the panel default and must agree with the base recipe.
    expect(sizeOf(".tape-label--md")).toBe(base);
  });

  it("declares the tape field below the pen", () => {
    // `[data-theme="logsheet"] .tape-input` and `.hand-value` are the same
    // specificity; whichever comes last sets the font on a call site that
    // carries both. The section name field must come out as tape, not pen.
    const pen = APP_CSS.indexOf('[data-theme="logsheet"] .hand-value {');
    const tapeInput = APP_CSS.indexOf('[data-theme="logsheet"] .tape-input {');
    expect(pen).toBeGreaterThan(-1);
    expect(tapeInput).toBeGreaterThan(pen);
  });

  it("draws the two kinds of canvas text in their own voices", () => {
    // A drawing surface can't carry a tape background, so its lettering has to
    // state the voice itself:
    //   labelFont — printed on the machine (KICK, SNR, BUILD ·AUTO)
    //   penFont   — a section name, which the person wrote
    expect(firstFamily(PALETTES.logsheet.labelFont)).toBe(firstFamily(mockToken("type")));
    expect(firstFamily(PALETTES.logsheet.penFont)).toBe(firstFamily(mockToken("hand")));
    // The dark theme is untouched: both faces are the mono it always drew in,
    // which is why one palette entry used to be enough.
    expect(PALETTES.dark.labelFont).toBe(PALETTES.dark.penFont);
  });
});
