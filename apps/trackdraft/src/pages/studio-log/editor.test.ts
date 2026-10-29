import { describe, expect, it } from "vitest";
import { buildEditorCss, DEFAULT_EDITOR, normalizeEditor } from "./editor";

describe("Studio Log workshop state", () => {
  it("keeps valid saved colors and discards malformed values", () => {
    const editor = normalizeEditor({ colors: { "--c-canvas": "#aabbcc", "--c-panel": "not-a-color" } });
    expect(editor.colors["--c-canvas"]).toBe("#AABBCC");
    expect(editor.colors["--c-panel"]).toBeUndefined();
    expect(editor.voices).toEqual(DEFAULT_EDITOR.voices);
  });

  it("clamps saved geometry and falls back for unknown fonts", () => {
    const editor = normalizeEditor({ sizes: { ...DEFAULT_EDITOR.sizes, written: 500 }, fonts: { ...DEFAULT_EDITOR.fonts, printed: "missing-font" as never } });
    expect(editor.sizes.written).toBe(32);
    expect(editor.fonts.printed).toBe("courier");
  });

  it("generates CSS for colors, font roles, sizes, and layout", () => {
    const editor = normalizeEditor({ colors: { "--c-panel": "#AABBCC" } });
    const css = buildEditorCss(editor, { "--c-canvas": "#112233" });
    expect(css).toContain("--c-canvas: 17 34 51");
    expect(css).toContain("--c-panel: 170 187 204");
    expect(css).toContain("--hand-pen:");
    expect(css).toContain(".hand-value--title { font-size: 21px; }");
    expect(css).toContain("border-radius: 2px");
  });
});
