import { describe, expect, it } from "vitest";
import { roleStyles } from "./roleColors";

/**
 * Referential stability (§S1.5).
 *
 * `useRoleStyle()` feeds `React.memo`'d columns. Building a fresh object per
 * call made every memo comparison fail, which turned a camera pan into a full
 * re-render of every visible section — the "memoising columns" item in the
 * perf plan was already written, but its precondition was not met.
 */
describe("roleStyles", () => {
  it("returns the same object for the same role", () => {
    const style = roleStyles("dark");
    expect(style("chorus")).toBe(style("chorus"));
  });

  it("still differs between roles", () => {
    const style = roleStyles("dark");
    expect(style("chorus")).not.toBe(style("verse"));
  });

  it("differs between themes, and is stable within each", () => {
    const dark = roleStyles("dark");
    const paper = roleStyles("logsheet");
    expect(dark("chorus")).not.toEqual(paper("chorus"));
    expect(dark("chorus")).toBe(dark("chorus"));
    expect(paper("chorus")).toBe(paper("chorus"));
  });

  it("caches the fallback too", () => {
    // An unknown role falls back to `custom`; it must be as stable as a real
    // one, or a section with a bad role re-renders forever.
    const style = roleStyles("dark");
    const a = style("nonsense" as never);
    const b = style("nonsense" as never);
    expect(a).toBe(b);
  });

  it("keeps the values it always had", () => {
    const chorus = roleStyles("dark")("chorus");
    expect(chorus.bg).toMatch(/^#/);
    expect(chorus.label.length).toBeGreaterThan(0);
  });
});
