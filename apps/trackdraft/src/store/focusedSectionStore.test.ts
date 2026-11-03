import { describe, expect, it, beforeEach } from "vitest";
import { useFocusedSectionStore } from "./focusedSectionStore";

/**
 * The shared section focus now carries a PASS (§P4.2).
 *
 * A section that plays three times is three nodes with one id, so every verb the
 * canvas owns — park, delete, the menu — needs to know which one you clicked,
 * not just which section. The pass is deliberately a separate field rather than
 * a compound key: the workbench and every other route keep reading
 * `selectedSectionId` and never learn that passes exist.
 */
describe("focusedSectionStore — the pass", () => {
  const store = () => useFocusedSectionStore.getState();

  beforeEach(() => {
    store().clearSelection();
  });

  it("starts every section on its first pass", () => {
    store().setSelectedSectionId("chorus");
    expect(store().focusedPass).toBe(0);
  });

  it("remembers the pass while you stay on the same section", () => {
    store().setSelectedSectionId("chorus");
    store().setFocusedPass(2);
    // Re-picking the same section (a click on its other pass, a re-render's
    // focus call) must not reset the pass you are working on.
    store().setSelectedSectionId("chorus");
    expect(store().focusedPass).toBe(2);
  });

  it("starts a different section at its first pass", () => {
    store().setSelectedSectionId("chorus");
    store().setFocusedPass(2);
    store().setSelectedSectionId("verse");
    expect(store().focusedPass).toBe(0);
  });

  it("a section-level pick — a sweep or a multi-select — starts at pass 0", () => {
    store().setSelectedSectionId("chorus");
    store().setFocusedPass(1);
    store().selectSection("verse", "replace", ["chorus", "verse"]);
    expect(store().focusedPass).toBe(0);
    store().setFocusedPass(1);
    store().setSelection(["chorus", "verse"], "chorus");
    expect(store().focusedPass).toBe(0);
  });

  it("never goes negative or fractional", () => {
    store().setFocusedPass(-3);
    expect(store().focusedPass).toBe(0);
    store().setFocusedPass(1.7);
    expect(store().focusedPass).toBe(1);
  });
});
