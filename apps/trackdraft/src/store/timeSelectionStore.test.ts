import { beforeEach, describe, expect, it } from "vitest";
import {
  drumRangeForSection,
  selectionForSection,
  selectionWithin,
  useTimeSelectionStore,
  type TimeSelection,
} from "./timeSelectionStore";

beforeEach(() => {
  useTimeSelectionStore.getState().clearSelection();
});

describe("time selection store", () => {
  it("normalizes reversed ranges", () => {
    useTimeSelectionStore.getState().setSelection({
      sectionId: "verse-1",
      startBeat: 8,
      endBeat: 4,
      lanes: [],
    });
    expect(useTimeSelectionStore.getState().selection).toMatchObject({ startBeat: 4, endBeat: 8 });
  });

  it("clamps negative starts", () => {
    useTimeSelectionStore.getState().setSelection({
      sectionId: "verse-1",
      startBeat: -4,
      endBeat: 2,
      lanes: ["kick"],
    });
    expect(useTimeSelectionStore.getState().selection?.startBeat).toBe(0);
  });

  it("clamps both ends of a fully negative range to zero", () => {
    useTimeSelectionStore.getState().setSelection({
      sectionId: "verse-1",
      startBeat: -8,
      endBeat: -4,
      lanes: [],
    });
    expect(useTimeSelectionStore.getState().selection).toMatchObject({ startBeat: 0, endBeat: 0 });
  });

  it("only exposes a selection to the section that owns it", () => {
    useTimeSelectionStore.getState().setSelection({
      sectionId: "chorus-1",
      startBeat: 0,
      endBeat: 4,
      lanes: [],
    });
    expect(selectionForSection("chorus-1")).not.toBeNull();
    expect(selectionForSection("verse-1")).toBeNull();
    expect(selectionForSection(null)).toBeNull();
  });

  it("maps to the drums tool range shape", () => {
    useTimeSelectionStore.getState().setSelection({
      sectionId: "chorus-1",
      startBeat: 2,
      endBeat: 6,
      lanes: ["kick", "snare"],
    });
    expect(drumRangeForSection("chorus-1")).toEqual({
      startBeat: 2,
      endBeat: 6,
      laneKeys: ["kick", "snare"],
    });
    expect(drumRangeForSection("verse-1")).toBeNull();
  });

  it("clears", () => {
    useTimeSelectionStore.getState().setSelection({ sectionId: "a", startBeat: 0, endBeat: 1, lanes: [] });
    useTimeSelectionStore.getState().clearSelection();
    expect(useTimeSelectionStore.getState().selection).toBeNull();
  });

  it("returns null for a range that belongs to another section", () => {
    const range: TimeSelection = { sectionId: "a", startBeat: 0, endBeat: 4, lanes: [] };
    expect(selectionWithin(range, "b", 16)).toBeNull();
  });

  it("clamps a range that outlived its section's length", () => {
    // The section was resized from 8 beats to 4 after the range was drawn.
    const range: TimeSelection = { sectionId: "a", startBeat: 2, endBeat: 8, lanes: [] };
    expect(selectionWithin(range, "a", 4)).toMatchObject({ startBeat: 2, endBeat: 4 });
  });

  it("collapses a range that now starts past the end", () => {
    const range: TimeSelection = { sectionId: "a", startBeat: 6, endBeat: 8, lanes: [] };
    expect(selectionWithin(range, "a", 4)).toMatchObject({ startBeat: 4, endBeat: 4 });
  });

  it("returns the same object when nothing needed clamping", () => {
    const range: TimeSelection = { sectionId: "a", startBeat: 0, endBeat: 4, lanes: [] };
    expect(selectionWithin(range, "a", 8)).toBe(range);
  });

  it("treats a degenerate section length as no selection", () => {
    const range: TimeSelection = { sectionId: "a", startBeat: 0, endBeat: 4, lanes: [] };
    expect(selectionWithin(range, "a", 0)).toBeNull();
  });
});
