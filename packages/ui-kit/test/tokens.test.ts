import { describe, expect, it } from "vitest";
import { ABLETON_DARK, generateFromHue, PRESETS } from "../src/theme/tokens.js";

const HEX = /^#[0-9a-f]{6}$/;

describe("generateFromHue", () => {
  it("produces valid hex colors for every role", () => {
    const palette = generateFromHue(210);
    for (const value of Object.values(palette)) {
      expect(value).toMatch(HEX);
    }
  });

  it("is deterministic — same hue always produces the same palette", () => {
    expect(generateFromHue(150)).toEqual(generateFromHue(150));
  });

  it("wraps hues outside [0, 360) the same as their normalized equivalent", () => {
    expect(generateFromHue(370)).toEqual(generateFromHue(10));
    expect(generateFromHue(-10)).toEqual(generateFromHue(350));
  });

  it("keeps the background darker than the text role (basic legibility sanity check)", () => {
    const { background, text } = generateFromHue(90);
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(background)).toBeLessThan(luminance(text));
  });
});

describe("PRESETS", () => {
  it("every preset is itself a valid role palette", () => {
    for (const palette of Object.values(PRESETS)) {
      for (const value of Object.values(palette)) {
        expect(value).toMatch(HEX);
      }
    }
  });

  it("presets are produced by the same generator, not hand-tuned overrides", () => {
    expect(PRESETS.blue).toEqual(generateFromHue(210));
  });
});

describe("ABLETON_DARK", () => {
  it("matches the exact palette from the SDK's own webview boilerplate", () => {
    expect(ABLETON_DARK.background).toBe("#383838");
    expect(ABLETON_DARK.panel).toBe("#4E4E4E");
    expect(ABLETON_DARK.accent).toBe("#FFA500");
  });
});
