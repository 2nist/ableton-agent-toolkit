/**
 * Grid ↔ pattern mapping for the 8×8 pad grid.
 *
 * Layout (from the design doc): rows = samples (voices), columns = steps.
 *  - 16 voices → 2 sample banks of 8 rows   (voice = bank * 8 + row)
 *  - 32 steps  → 4 step pages of 8 columns  (step  = page * 8 + col)
 *
 * Also defines the role tables for the 8 track buttons and 8 scene buttons so
 * the browser app doesn't hardcode note numbers — it asks the controller-bridge
 * resolver for the hardware control and this module for its meaning.
 */
export const GRID_ROWS = 8;
export const GRID_COLS = 8;
export const SAMPLE_BANKS = 2;
export const STEP_PAGES = 4;

export interface GridState {
  sampleBank: 0 | 1;
  stepPage: 0 | 1 | 2 | 3;
}

export function createGridState(
  sampleBank: 0 | 1 = 0,
  stepPage: 0 | 1 | 2 | 3 = 0,
): GridState {
  return { sampleBank, stepPage };
}

/** A grid cell's meaning under the current state. */
export interface GridCellEdit {
  /** Drum-rack voice (0-15). */
  voice: number;
  /** Pattern step (0-31). */
  step: number;
}

/** Map a physical pad (row, col) to a (voice, step) edit under the current state. */
export function padToEdit(state: GridState, row: number, col: number): GridCellEdit | null {
  if (row < 0 || row >= GRID_ROWS) return null;
  if (col < 0 || col >= GRID_COLS) return null;
  return {
    voice: state.sampleBank * GRID_ROWS + row,
    step: state.stepPage * GRID_COLS + col,
  };
}

/** Every visible cell under the current state (for LED render / UI mirror). */
export interface GridCell {
  row: number;
  col: number;
  voice: number;
  step: number;
}

export function visibleCells(state: GridState): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const edit = padToEdit(state, row, col);
      if (edit) cells.push({ row, col, voice: edit.voice, step: edit.step });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Track button roles (notes 100-107)
// ---------------------------------------------------------------------------

export type TrackButtonRole =
  | "sample_bank_a"
  | "sample_bank_b"
  | "step_page_0"
  | "step_page_1"
  | "step_page_2"
  | "step_page_3";

export const TRACK_BUTTON_ROLES: TrackButtonRole[] = [
  "sample_bank_a",
  "sample_bank_b",
  "step_page_0",
  "step_page_1",
  "step_page_2",
  "step_page_3",
];

export function trackButtonRole(index: number): TrackButtonRole | null {
  return TRACK_BUTTON_ROLES[index] ?? null;
}

// ---------------------------------------------------------------------------
// Scene button roles (notes 112-119)
// ---------------------------------------------------------------------------

export type SceneButtonRole =
  | "play_stop"
  | "solo_pad"
  | "mute_pad"
  | "resolution"
  | "pattern_toggle"
  | "clear_pad"
  | "follow_live"
  | "commit_clip";

export const SCENE_BUTTON_ROLES: SceneButtonRole[] = [
  "play_stop",
  "solo_pad",
  "mute_pad",
  "resolution",
  "pattern_toggle",
  "clear_pad",
  "follow_live",
  "commit_clip",
];

export function sceneButtonRole(index: number): SceneButtonRole | null {
  return SCENE_BUTTON_ROLES[index] ?? null;
}
