import { describe, expect, it } from "vitest";
import {
  createGridState,
  padToEdit,
  sceneButtonRole,
  trackButtonRole,
  visibleCells,
} from "../src/index.js";

describe("padToEdit", () => {
  it("maps the default state (bank 0, page 0) to voices 0-7 and steps 0-7", () => {
    const state = createGridState(0, 0);
    expect(padToEdit(state, 0, 0)).toEqual({ voice: 0, step: 0 });
    expect(padToEdit(state, 7, 7)).toEqual({ voice: 7, step: 7 });
  });

  it("maps bank 1 to voices 8-15", () => {
    const state = createGridState(1, 0);
    expect(padToEdit(state, 0, 0)).toEqual({ voice: 8, step: 0 });
    expect(padToEdit(state, 7, 7)).toEqual({ voice: 15, step: 7 });
  });

  it("maps page 3 to steps 24-31", () => {
    const state = createGridState(0, 3);
    expect(padToEdit(state, 0, 0)).toEqual({ voice: 0, step: 24 });
    expect(padToEdit(state, 3, 6)).toEqual({ voice: 3, step: 30 });
  });

  it("returns null out of range", () => {
    const state = createGridState(0, 0);
    expect(padToEdit(state, -1, 0)).toBeNull();
    expect(padToEdit(state, 8, 0)).toBeNull();
    expect(padToEdit(state, 0, 8)).toBeNull();
  });
});

describe("visibleCells", () => {
  it("yields all 64 cells for the current state", () => {
    const cells = visibleCells(createGridState(1, 2));
    expect(cells).toHaveLength(64);
    expect(cells[0]).toEqual({ row: 0, col: 0, voice: 8, step: 16 });
    expect(cells[63]).toEqual({ row: 7, col: 7, voice: 15, step: 23 });
  });
});

describe("button roles", () => {
  it("maps track buttons 0-5 and null beyond", () => {
    expect(trackButtonRole(0)).toBe("sample_bank_a");
    expect(trackButtonRole(1)).toBe("sample_bank_b");
    expect(trackButtonRole(2)).toBe("step_page_0");
    expect(trackButtonRole(5)).toBe("step_page_3");
    expect(trackButtonRole(6)).toBeNull();
    expect(trackButtonRole(7)).toBeNull();
  });

  it("maps scene buttons 0-7", () => {
    expect(sceneButtonRole(0)).toBe("play_stop");
    expect(sceneButtonRole(7)).toBe("commit_clip");
    expect(sceneButtonRole(8)).toBeNull();
  });
});
