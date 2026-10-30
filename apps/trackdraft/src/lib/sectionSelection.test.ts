import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  rangeIds,
  reconcileSelection,
  selectSections,
  selectedSpans,
  sharedRepeats,
  type SelectionState,
} from "./sectionSelection";

const order = ["a", "b", "c", "d", "e"];

const selected = (ids: string[], anchor: string | null = ids[0] ?? null, focus: string | null = ids[ids.length - 1] ?? null): SelectionState => ({
  selected: ids,
  anchor,
  focus,
});

describe("rangeIds", () => {
  it("includes both ends and everything between", () => {
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("works backwards", () => {
    expect(rangeIds(order, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns just the target when an end is unknown", () => {
    expect(rangeIds(order, "zz", "c")).toEqual(["c"]);
    expect(rangeIds(order, "b", "zz")).toEqual([]);
  });
});

describe("selectSections", () => {
  it("replaces on a plain click and moves the anchor", () => {
    expect(selectSections(selected(["a", "b", "c"]), "d", "replace", order)).toEqual(selected(["d"]));
  });

  it("extends from the anchor with shift", () => {
    const start = selectSections(EMPTY_SELECTION, "b", "replace", order);
    expect(selectSections(start, "d", "extend", order)).toEqual({ selected: ["b", "c", "d"], anchor: "b", focus: "d" });
  });

  it("shrinks a shift range when clicking back towards the anchor", () => {
    const start = selected(["b", "c", "d"], "b", "d");
    expect(selectSections(start, "c", "extend", order).selected).toEqual(["b", "c"]);
  });

  it("toggles a section in and out with cmd", () => {
    const start = selected(["a", "c"], "a", "c");
    const added = selectSections(start, "d", "toggle", order);
    // Always stored in song order, whatever order they were clicked.
    expect(added.selected).toEqual(["a", "c", "d"]);
    expect(added.focus).toBe("d");
    expect(selectSections(added, "c", "toggle", order).selected).toEqual(["a", "d"]);
  });

  it("falls back to the remaining focus when the focused section is toggled off", () => {
    const start = selected(["a", "b"], "a", "b");
    const next = selectSections(start, "b", "toggle", order);
    expect(next.selected).toEqual(["a"]);
    expect(next.focus).toBe("a");
    expect(next.anchor).toBe("a");
  });

  it("ignores ids that are not in the song", () => {
    const start = selected(["a"]);
    expect(selectSections(start, "gone", "replace", order)).toBe(start);
  });

  it("a sweep is just repeated extension from the anchor", () => {
    let state = selectSections(EMPTY_SELECTION, "b", "replace", order);
    state = selectSections(state, "c", "extend", order);
    state = selectSections(state, "d", "extend", order);
    expect(state.selected).toEqual(["b", "c", "d"]);
    // Sweeping back shrinks rather than growing a second range.
    state = selectSections(state, "c", "extend", order);
    expect(state.selected).toEqual(["b", "c"]);
  });
});

describe("reconcileSelection", () => {
  it("drops sections that no longer exist", () => {
    const state = selected(["a", "z"], "a", "z");
    expect(reconcileSelection(state, order)).toEqual({ selected: ["a"], anchor: "a", focus: "a" });
  });

  it("keeps a valid selection untouched", () => {
    const state = selected(["a", "b"], "a", "b");
    expect(reconcileSelection(state, order)).toBe(state);
  });

  it("rescues the focus when only it disappeared", () => {
    const state = selected(["a", "b"], "a", "b");
    expect(reconcileSelection(state, ["a", "c"]).focus).toBe("a");
  });
});

describe("sharedRepeats", () => {
  it("returns the common value or null", () => {
    expect(sharedRepeats([2, 2, 2])).toBe(2);
    expect(sharedRepeats([2, 3])).toBeNull();
    expect(sharedRepeats([])).toBeNull();
  });
});

describe("selectedSpans", () => {
  const spans = [
    { sectionId: "a", pass: 0 },
    { sectionId: "a", pass: 1 },
    { sectionId: "b", pass: 0 },
    { sectionId: "c", pass: 0 },
  ];

  it("is empty for a single section — that is not a multi-selection", () => {
    expect(selectedSpans(spans, [])).toEqual([]);
    expect(selectedSpans(spans, ["b"])).toEqual([]);
  });

  it("keeps song order whatever order the ids were clicked", () => {
    expect(selectedSpans(spans, ["c", "a"]).map((s) => s.sectionId)).toEqual(["a", "c"]);
  });

  it("shows a repeated section once", () => {
    expect(selectedSpans(spans, ["a", "b"]).map((s) => s.pass)).toEqual([0, 0]);
  });

  it("ignores ids that are not in the arrangement", () => {
    expect(selectedSpans(spans, ["a", "zzz", "c"]).map((s) => s.sectionId)).toEqual(["a", "c"]);
  });
});
