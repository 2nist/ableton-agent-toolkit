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
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    // the app names it in the tape recipe; the mock in --marker
    const appTape = APP_CSS.match(/\.tape-label \{[\s\S]*?font-family:\s*([^;]+);/);
    expect(appTape).not.toBeNull();
    expect(firstFamily(appTape![1])).toBe(firstFamily(mockToken("marker")));
  });

  it("writes in the same ink", () => {
    expect(appInk().toLowerCase()).toBe(mockLogsheetInk().toLowerCase());
  });
});
