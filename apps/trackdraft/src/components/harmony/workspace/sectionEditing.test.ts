import { describe, expect, it } from "vitest";
import { resolveSectionName } from "./SectionNameInput";
import { sectionShortcutFor } from "../useSectionShortcuts";

describe("resolveSectionName — what an inline rename settles on", () => {
  it("keeps a changed, trimmed name", () => {
    expect(resolveSectionName("Verse", "  Piano vamp ")).toBe("Piano vamp");
  });

  it("cancels when nothing changed", () => {
    expect(resolveSectionName("Verse", "Verse")).toBeNull();
    expect(resolveSectionName("Verse", "  Verse  ")).toBeNull();
  });

  it("cancels on a blank name — the picker has nothing to show", () => {
    expect(resolveSectionName("Verse", "")).toBeNull();
    expect(resolveSectionName("Verse", "   ")).toBeNull();
  });
});

describe("sectionShortcutFor — the section key map", () => {
  const order = ["a", "b", "c"];
  const key = (over: Partial<Parameters<typeof sectionShortcutFor>[0]>) => ({
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it("walks the song with the arrows", () => {
    expect(sectionShortcutFor(key({ key: "ArrowRight" }), { order, focusedId: "a" })).toEqual({
      kind: "focus",
      sectionId: "b",
    });
    expect(sectionShortcutFor(key({ key: "ArrowUp" }), { order, focusedId: "c" })).toEqual({
      kind: "focus",
      sectionId: "b",
    });
  });

  it("extends instead of moving when shift is held", () => {
    expect(sectionShortcutFor(key({ key: "ArrowLeft", shiftKey: true }), { order, focusedId: "c" })).toEqual({
      kind: "extend",
      sectionId: "b",
    });
  });

  it("stays inside the ends of the song", () => {
    expect(sectionShortcutFor(key({ key: "ArrowLeft" }), { order, focusedId: "a" })).toBeNull();
    expect(sectionShortcutFor(key({ key: "ArrowRight" }), { order, focusedId: "c" })).toBeNull();
  });

  it("starts from the first section when nothing is focused", () => {
    expect(sectionShortcutFor(key({ key: "ArrowRight" }), { order, focusedId: null })).toEqual({
      kind: "focus",
      sectionId: "a",
    });
  });

  it("selects all and collapses", () => {
    expect(sectionShortcutFor(key({ key: "a", metaKey: true }), { order, focusedId: "b" })).toEqual({ kind: "all" });
    expect(sectionShortcutFor(key({ key: "Escape" }), { order, focusedId: "b" })).toEqual({ kind: "collapse" });
  });

  it("ignores ⌘⇧A, ⌥-chords and unrelated keys", () => {
    expect(sectionShortcutFor(key({ key: "a", metaKey: true, shiftKey: true }), { order, focusedId: "a" })).toBeNull();
    expect(sectionShortcutFor(key({ key: "ArrowRight", altKey: true }), { order, focusedId: "a" })).toBeNull();
    expect(sectionShortcutFor(key({ key: "x" }), { order, focusedId: "a" })).toBeNull();
  });

  it("does nothing in an empty song", () => {
    expect(sectionShortcutFor(key({ key: "ArrowRight" }), { order: [], focusedId: null })).toBeNull();
    expect(sectionShortcutFor(key({ key: "Escape" }), { order: [], focusedId: null })).toBeNull();
  });
});
