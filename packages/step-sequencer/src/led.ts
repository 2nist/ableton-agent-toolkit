/**
 * LED rendering for the 8×8 pad grid.
 *
 * Pure: given the pattern, the visible bank/page state, the clock position and
 * the hardware grid (an `ElementMatrix` from `@hardware/controller-bridge`),
 * returns the list of LED writes (note + LED channel + palette color) to send.
 *
 * Color language (palette from the APC script's colors.py):
 *  - Hit step:                    YELLOW
 *  - Hit step on the focused row: OCEAN
 *  - Playhead column, empty cell: GREEN PULSE (dim sweeping line)
 *  - Playhead column, hit cell:   GREEN (firing right now)
 *  - Everything else:             off
 */
import {
  APC_MINI_MK2_PALETTE as P,
  cellLedChannel,
  cellNote,
  type ElementMatrix,
} from "@hardware/controller-bridge";
import type { ClockState } from "./clock.js";
import { createGridState, padToEdit, type GridState } from "./grid.js";
import { getStep, STEPS_PER_PAGE, type StepPattern } from "./pattern.js";

export interface LedCell {
  row: number;
  col: number;
  note: number;
  ledChannel: number;
  /** Palette color value (sent as note velocity on the LED channel). */
  color: number;
  /**
   * Optional MIDI channel override — when present, send on this channel
   * instead of `ledChannel`. Used for pulse/blink/half-brightness variants
   * (e.g. the sweeping playhead line on the PULSE channel).
   */
  channel?: number;
}

export interface LedRenderInput {
  pattern: StepPattern;
  gridState?: GridState;
  clock?: ClockState;
  /** Focus a single voice row for accent coloring (0-7 within the visible bank). */
  selectedRow?: number;
}

/**
 * Render the full 8×8 grid to LED writes for an 8×8 hardware pad matrix.
 * `matrix` provides note numbers + LED channel; the standard APC clip-launch
 * matrix is the caller's usual choice (drum matrix also works — both are RGB).
 */
export function renderGrid(matrix: ElementMatrix, input: LedRenderInput): LedCell[] {
  const gridState = input.gridState ?? createGridState();
  const clock = input.clock;
  const cells: LedCell[] = [];

  // Playhead column visible only when the clock's current step is on this page.
  let playheadCol: number | null = null;
  if (clock?.isPlaying) {
    const pageStart = gridState.stepPage * STEPS_PER_PAGE;
    const pageEnd = pageStart + STEPS_PER_PAGE;
    if (clock.step >= pageStart && clock.step < pageEnd) {
      playheadCol = clock.step % STEPS_PER_PAGE;
    }
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const edit = padToEdit(gridState, row, col);
      const note = cellNote(matrix, row, col);
      const ledChannel = cellLedChannel(matrix, row, col);
      if (!edit || note === null) continue;

      const hit = getStep(input.pattern, edit.voice, edit.step);
      const isPlayhead = playheadCol === col;

      let color: number;
      let channel: number | undefined;
      if (isPlayhead) {
        color = P.colors.green.value;
        // Hit cell = solid green (firing now); empty cell = green pulse sweep.
        if (!hit) channel = P.channels.pulse;
      } else if (hit) {
        color = input.selectedRow === row ? P.colors.ocean.value : P.colors.yellow.value;
      } else {
        color = P.colors.black.value;
      }

      cells.push({ row, col, note, ledChannel, color, channel });
    }
  }
  return cells;
}
