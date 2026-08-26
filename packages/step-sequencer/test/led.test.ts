import { APC_MINI_MK2, type ElementMatrix } from "@hardware/controller-bridge";
import { describe, expect, it } from "vitest";
import { renderGrid, type LedCell } from "../src/index.js";
import { createPattern, setStep } from "../src/pattern.js";

const matrix = APC_MINI_MK2.matrices.clip_launch_buttons as ElementMatrix;

function colors(cells: LedCell[]): Map<string, number> {
  return new Map(cells.map((c) => [`${c.row},${c.col}`, c.color]));
}

describe("renderGrid", () => {
  it("lights hits yellow and everything else off (no clock)", () => {
    let pattern = createPattern(16, 32);
    pattern = setStep(pattern, 0, 0, { velocity: 100, accent: false });
    pattern = setStep(pattern, 9, 9, { velocity: 100, accent: false }); // bank 1 row 1
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 0, stepPage: 0 } });
    expect(cells).toHaveLength(64);
    const c = colors(cells);
    expect(c.get("0,0")).toBe(13); // yellow (hit)
    expect(c.get("1,1")).toBe(0); // empty
    // Voice 9 is on bank 1 — not visible on bank 0.
    expect(c.get("1,1")).toBe(0);
  });

  it("shows bank 1 hits when the bank is switched", () => {
    let pattern = createPattern(16, 32);
    pattern = setStep(pattern, 9, 9, { velocity: 100, accent: false });
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 1, stepPage: 1 } });
    const c = colors(cells);
    expect(c.get("1,1")).toBe(13); // voice 9 = row 1, step 9 = page 1 col 1
  });

  it("lights the playhead column green, pulse on empty cells", () => {
    const pattern = createPattern(16, 32);
    const clock = { isPlaying: true, bpm: 120, resolution: "16" as const, fractionalStep: 3, step: 3, phase: 0 };
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 0, stepPage: 0 }, clock });
    const c = colors(cells);
    // Playhead col = 3: empty → green pulse channel + green value
    const playheadCell = cells.find((cell) => cell.col === 3 && cell.row === 0)!;
    expect(playheadCell.color).toBe(21); // green
    expect(playheadCell.channel).toBe(10); // pulse channel
    expect(c.get("0,4")).toBe(0); // next col off
  });

  it("renders playhead hit cells solid green (no pulse channel)", () => {
    let pattern = createPattern(16, 32);
    pattern = setStep(pattern, 2, 3, { velocity: 100, accent: false });
    const clock = { isPlaying: true, bpm: 120, resolution: "16" as const, fractionalStep: 3, step: 3, phase: 0 };
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 0, stepPage: 0 }, clock });
    const hit = cells.find((cell) => cell.row === 2 && cell.col === 3)!;
    expect(hit.color).toBe(21);
    expect(hit.channel).toBeUndefined(); // solid green on default LED channel
  });

  it("does not show the playhead when the current step is on another page", () => {
    const pattern = createPattern(16, 32);
    const clock = { isPlaying: true, bpm: 120, resolution: "16" as const, fractionalStep: 20, step: 20, phase: 0 };
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 0, stepPage: 0 }, clock });
    const c = colors(cells);
    // step 20 is on page 2 — no playhead on page 0.
    expect([...c.values()].every((v) => v === 0)).toBe(true);
  });

  it("accents the focused row in ocean", () => {
    let pattern = createPattern(16, 32);
    pattern = setStep(pattern, 3, 5, { velocity: 100, accent: false });
    pattern = setStep(pattern, 4, 5, { velocity: 100, accent: false });
    const cells = renderGrid(matrix, { pattern, gridState: { sampleBank: 0, stepPage: 0 }, selectedRow: 3 });
    const c = colors(cells);
    expect(c.get("3,5")).toBe(41); // ocean
    expect(c.get("4,5")).toBe(13); // yellow
  });
});
