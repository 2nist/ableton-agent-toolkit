import { APC_MINI_MK2, type ElementMatrix } from "@hardware/controller-bridge";
import { describe, expect, it } from "vitest";
import {
  bankOfPad,
  bankSlotPad,
  clearPad,
  createDrumRackPattern,
  drumPadAt,
  drumRackTriggers,
  fxSlotAt,
  getHit,
  hasHits,
  padBankSlot,
  padLength,
  padLevel,
  padMuted,
  rackNoteAt,
  rackNoteOfPad,
  randomizePad,
  regionOf,
  renderDrumRackLeds,
  resolvePadPress,
  setPadLength,
  setPadLevel,
  stepAt,
  stepNumber,
  toggleDrumStep,
  togglePadMuted,
} from "../src/index.js";

const matrix = APC_MINI_MK2.matrices.clip_launch_buttons as ElementMatrix;
const RACK_NOTES_36_51 = Array.from({ length: 16 }, () => 36 + 0).map((_, i) => 36 + i);

describe("geometry", () => {
  it("splits the 8×8 grid into step / drum / fx regions", () => {
    expect(regionOf(0, 0)).toBe("step");
    expect(regionOf(3, 7)).toBe("step");
    expect(regionOf(4, 0)).toBe("drum");
    expect(regionOf(7, 3)).toBe("drum");
    expect(regionOf(4, 4)).toBe("fx");
    expect(regionOf(7, 7)).toBe("fx");
  });

  it("maps top cells to row-major step numbers 1-32", () => {
    expect(stepAt(0, 0)).toBe(0);
    expect(stepNumber(0, 0)).toBe(1);
    expect(stepNumber(0, 7)).toBe(8);
    expect(stepNumber(1, 0)).toBe(9);
    expect(stepNumber(3, 7)).toBe(32);
  });

  it("maps bottom-left cells to drum pad index and rack note 36-51", () => {
    expect(drumPadAt(7, 0)).toBe(12); // bottom-left → pad 12
    expect(rackNoteAt(7, 0)).toBe(36); // kick
    expect(rackNoteAt(7, 3)).toBe(39);
    expect(rackNoteAt(6, 0)).toBe(40);
    expect(rackNoteAt(4, 3)).toBe(51);
    // 16 distinct rack notes 36-51
    const notes = RACK_NOTES_36_51;
    for (let row = 4; row < 8; row++) for (let col = 0; col < 4; col++) {
      expect(rackNoteAt(row, col)).toBe(36 + (7 - row) * 4 + col);
    }
    expect(new Set(Array.from({ length: 16 }, (_, i) => rackNoteOfPad(i))).size).toBe(16);
  });

  it("maps bottom-right cells to fx slots 0-15", () => {
    expect(fxSlotAt(4, 4)).toBe(0);
    expect(fxSlotAt(7, 7)).toBe(15);
  });
});

describe("pattern editing", () => {
  it("toggles hits and sets length via shift", () => {
    let drum = createDrumRackPattern();
    expect(getHit(drum, 0, 0)).toBeNull();

    drum = toggleDrumStep(drum, 0, 0, false, 100);
    expect(getHit(drum, 0, 0)).toEqual({ velocity: 100, accent: false });

    drum = toggleDrumStep(drum, 0, 0, false);
    expect(getHit(drum, 0, 0)).toBeNull();

    // shift + step 16 (index 15) → length 16
    drum = toggleDrumStep(drum, 0, 15, true);
    expect(padLength(drum, 0)).toBe(16);
  });

  it("clearPad and randomizePad affect only one pad", () => {
    let drum = createDrumRackPattern();
    drum = toggleDrumStep(drum, 0, 0, false);
    drum = toggleDrumStep(drum, 3, 2, false);
    expect(hasHits(drum, 0)).toBe(true);
    expect(hasHits(drum, 3)).toBe(true);

    drum = clearPad(drum, 0);
    expect(hasHits(drum, 0)).toBe(false);
    expect(hasHits(drum, 3)).toBe(true);

    drum = randomizePad(drum, 3, 1.0, () => 0.5);
    for (let s = 0; s < padLength(drum, 3); s++) expect(getHit(drum, 3, s)).not.toBeNull();
  });

  it("setPadLength clamps to 1-32", () => {
    let drum = createDrumRackPattern();
    drum = setPadLength(drum, 1, 99);
    expect(padLength(drum, 1)).toBe(32);
    drum = setPadLength(drum, 1, 0);
    expect(padLength(drum, 1)).toBe(1);
  });
});

describe("resolvePadPress", () => {
  it("auditions a drum pad (preview only) on tap; selects with shift; edits steps; toggles fx", () => {
    // plain tap → preview only, keeps the step editor where it is
    expect(resolvePadPress(7, 0, false, 0)).toEqual({ type: "previewPad", pad: 12, previewNote: 36 });
    // SHIFT + tap → select for editing (and preview)
    expect(resolvePadPress(7, 0, true, 0)).toEqual({ type: "selectPad", pad: 12, previewNote: 36 });
    expect(resolvePadPress(0, 0, false, 5)).toEqual({ type: "toggleStep", pad: 5, step: 0, shift: false });
    expect(resolvePadPress(0, 0, true, 5)).toEqual({ type: "toggleStep", pad: 5, step: 0, shift: true });
    expect(resolvePadPress(5, 6, false, 0)).toEqual({ type: "toggleFx", slot: 6 });
  });
});

describe("drumRackTriggers", () => {
  it("fires rack notes only for hits within each pad's length", () => {
    let drum = createDrumRackPattern();
    // pad 12 (kick, note 36) hit on step 0; pad 13 (note 37) hit on step 0 but length 1
    drum = toggleDrumStep(drum, 12, 0, false, 100);
    drum = toggleDrumStep(drum, 13, 0, false, 90);
    drum = setPadLength(drum, 13, 1);
    // a hit beyond pad 13's length is not fired
    drum = toggleDrumStep(drum, 13, 1, false, 90); // step 1 > length-1 → silent

    const t0 = drumRackTriggers(drum, 0);
    expect(t0).toEqual([
      { pitch: 36, velocity: 100 },
      { pitch: 37, velocity: 90 },
    ]);
    expect(drumRackTriggers(drum, 1)).toEqual([]);
  });
});

describe("renderDrumRackLeds", () => {
  it("renders selected pad ocean, hit steps yellow, fx blue", () => {
    let drum = createDrumRackPattern();
    drum = toggleDrumStep(drum, 12, 0, false); // give pad 12 (kick) a hit on step 1
    const leds = renderDrumRackLeds(matrix, { drum, selectedPad: 12, fx: Array(16).fill(false) });
    expect(leds).toHaveLength(64);

    // selected drum pad (row 7 col 0) → ocean (41)
    const sel = leds.find((c) => c.row === 7 && c.col === 0)!;
    expect(sel.color).toBe(41);
    // hit step 1 (row 0 col 0) on pad 12 → yellow (13)
    const stepCell = leds.find((c) => c.row === 0 && c.col === 0)!;
    expect(stepCell.color).toBe(13);
  });

  it("colors beyond-length steps dim and loop-end amber", () => {
    let drum = createDrumRackPattern();
    drum = setPadLength(drum, 12, 4);
    // a hit beyond length: pad 12 step 20 (row 2 col 4)
    drum = toggleDrumStep(drum, 12, 20, false);
    const leds = renderDrumRackLeds(matrix, { drum, selectedPad: 12, fx: Array(16).fill(false) });
    const beyond = leds.find((c) => c.row === 2 && c.col === 4)!;
    expect(beyond.color).toBe(9); // amber (dim)
    // loop-end step 4 (row 0 col 3), empty → amber marker
    const end = leds.find((c) => c.row === 0 && c.col === 3)!;
    expect(end.color).toBe(9);
  });

  it("keeps the last step black (off) at full length — no loop-end marker on n32", () => {
    // Default length 32: step 32 (row 3 col 7) must read OFF when empty,
    // not amber — otherwise it looks permanently lit.
    const drum = createDrumRackPattern();
    const leds = renderDrumRackLeds(matrix, { drum, selectedPad: 12, fx: Array(16).fill(false) });
    const last = leds.find((c) => c.row === 3 && c.col === 7)!;
    expect(last.color).toBe(0); // black
  });

  it("lights the playhead column green with pulse channel on empty cells", () => {
    const clock = { isPlaying: true, bpm: 120, resolution: "16" as const, fractionalStep: 2, step: 2, phase: 0 };
    const leds = renderDrumRackLeds(matrix, { drum: createDrumRackPattern(), selectedPad: 12, fx: Array(16).fill(false), clock });
    const playheadEmpty = leds.find((c) => c.row === 0 && c.col === 2)!;
    expect(playheadEmpty.color).toBe(21); // green
    expect(playheadEmpty.channel).toBe(10); // pulse channel
  });
});

describe("banks", () => {
  it("splits 16 pads into Bank A (8-15) and Bank B (0-7)", () => {
    expect(bankOfPad(0)).toBe("B");
    expect(bankOfPad(7)).toBe("B");
    expect(bankOfPad(8)).toBe("A");
    expect(bankOfPad(15)).toBe("A");
  });

  it("maps bank slots to pads bottom-left first, and round-trips", () => {
    expect(bankSlotPad("A", 0)).toBe(12); // bottom-left of bank A
    expect(bankSlotPad("A", 3)).toBe(15);
    expect(bankSlotPad("A", 7)).toBe(11);
    expect(bankSlotPad("B", 0)).toBe(4); // bottom-left of bank B
    expect(bankSlotPad("B", 7)).toBe(3);
    expect(padBankSlot(12)).toBe(0);
    expect(padBankSlot(11)).toBe(7);
    expect(padBankSlot(4)).toBe(0);
    expect(padBankSlot(3)).toBe(7);
  });
});

describe("per-pad level + mute", () => {
  it("defaults to level 1 and unmuted", () => {
    const drum = createDrumRackPattern();
    expect(padLevel(drum, 0)).toBe(1);
    expect(padMuted(drum, 0)).toBe(false);
  });

  it("sets level (clamped 0-1) and toggles mute immutably", () => {
    let drum = createDrumRackPattern();
    drum = setPadLevel(drum, 0, 0.5);
    expect(padLevel(drum, 0)).toBe(0.5);
    drum = setPadLevel(drum, 0, 2);
    expect(padLevel(drum, 0)).toBe(1);
    drum = togglePadMuted(drum, 0);
    expect(padMuted(drum, 0)).toBe(true);
    drum = togglePadMuted(drum, 0);
    expect(padMuted(drum, 0)).toBe(false);
    expect(padLevel(drum, 1)).toBe(1); // untouched pad
  });

  it("drumRackTriggers scales velocity by level and skips muted pads", () => {
    let drum = createDrumRackPattern();
    drum = toggleDrumStep(drum, 12, 0, false, 100); // pad 12 (note 36)
    drum = toggleDrumStep(drum, 13, 0, false, 90); // pad 13 (note 37)
    drum = setPadLevel(drum, 12, 0.5);
    drum = togglePadMuted(drum, 13);
    expect(drumRackTriggers(drum, 0)).toEqual([{ pitch: 36, velocity: 50 }]); // 100 * 0.5; muted 37 skipped
  });
});

describe("fx mode row", () => {
  it("maps fx slots 0-3 to bank/device/live actions and the rest to FX toggles", () => {
    expect(resolvePadPress(4, 4, false, 0)).toEqual({ type: "selectBank", bank: "A" });
    expect(resolvePadPress(4, 5, false, 0)).toEqual({ type: "selectBank", bank: "B" });
    expect(resolvePadPress(4, 6, false, 0)).toEqual({ type: "setFaderMode", mode: "device" });
    expect(resolvePadPress(4, 7, false, 0)).toEqual({ type: "toggleLive" });
    expect(resolvePadPress(5, 6, false, 0)).toEqual({ type: "toggleFx", slot: 6 });
  });

  it("renders the mode-row LEDs (active bank green, device blue, live red)", () => {
    const leds = renderDrumRackLeds(matrix, {
      drum: createDrumRackPattern(),
      selectedPad: 12,
      fx: Array(16).fill(false),
      bank: "A",
      faderMode: "device",
      liveMode: true,
      advanced: true,
    });
    expect(leds.find((c) => c.row === 4 && c.col === 4)!.color).toBe(21); // bank A active → green
    expect(leds.find((c) => c.row === 4 && c.col === 5)!.color).toBe(0); // bank B inactive → black
    expect(leds.find((c) => c.row === 4 && c.col === 6)!.color).toBe(45); // device active → blue
    expect(leds.find((c) => c.row === 4 && c.col === 7)!.color).toBe(5); // live active → red
  });

  it("renders the FX region as plain FX toggles in Basic mode (no mode row)", () => {
    const leds = renderDrumRackLeds(matrix, {
      drum: createDrumRackPattern(),
      selectedPad: 12,
      fx: Array(16).fill(true), // all FX on
      advanced: false, // Basic mode
    });
    // Even the first-row cells are FX toggles in Basic mode → all blue.
    expect(leds.find((c) => c.row === 4 && c.col === 4)!.color).toBe(45);
    expect(leds.find((c) => c.row === 4 && c.col === 6)!.color).toBe(45);
  });

  it("renders a muted drum pad red", () => {
    let drum = createDrumRackPattern();
    drum = togglePadMuted(drum, 12);
    const leds = renderDrumRackLeds(matrix, { drum, selectedPad: 0, fx: Array(16).fill(false) });
    expect(leds.find((c) => c.row === 7 && c.col === 0)!.color).toBe(5); // red
  });
});
