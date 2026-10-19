/**
 * Re-rooting the hex lattice at a modulation.
 *
 * The wheel's cells are scale degrees: `degreeAt(q, r) = (3q + r) mod 7`. That
 * invariant only holds relative to *one* tonic, so in a modulated section the
 * chords after the key change were being placed as if they were still in the
 * old key — every chord measured against one home, which is why a modulation
 * could not show as movement.
 *
 * A region translation fixes that: when the home changes, the walk continues
 * from the same cell shifted by `MODULATION_SHIFT`, which is a vector the
 * lattice maps back onto itself (3·3 + (−2) = 7 ≡ 0 mod 7). So every cell
 * still reports exactly the degree it was placed at, the neighbourhood is
 * still a valid hex neighbourhood, and the progression visibly *steps* to new
 * ground instead of folding back onto the same degrees.
 *
 * On screen the shift is ~3.5 cells right and 3 cells up — far enough to read
 * as a new area, close enough that a four-bar modulation still fits the wheel.
 */

import { DIRS, degreeAt, type HexCell } from "./honeycombWalk";

/** Lattice translation applied to everything after a modulation. Preserves
 *  `degreeAt` because 3·3 + (−2) ≡ 0 (mod 7). */
export const MODULATION_SHIFT: HexCell = { q: 3, r: -2 };

/** One chord as the walk needs it: a degree, and which tonic region it is in. */
export interface RegionStep {
  deg: number;
  region: number;
}

export interface RegionSeam {
  /** Index of the first step in the new region. */
  step: number;
  region: number;
  /** Last cell of the previous region. */
  from: HexCell;
  /** Where that cell moved to — the new region's frame of reference. */
  to: HexCell;
}

export interface RegionWalk {
  walk: HexCell[];
  regionOfStep: number[];
  seams: RegionSeam[];
  /** First cell of each region, for labelling the home in place. */
  anchors: { region: number; cell: HexCell }[];
}

/**
 * Build the walk, translating the lattice whenever `region` changes.
 * Identical to `buildWalk` for a single region.
 */
export function buildRegionWalk(
  steps: RegionStep[],
  shift: HexCell = MODULATION_SHIFT,
): RegionWalk {
  if (steps.length === 0) return { walk: [], regionOfStep: [], seams: [], anchors: [] };

  const walk: HexCell[] = [{ q: 0, r: steps[0].deg }];
  const regionOfStep: number[] = [steps[0].region];
  const seams: RegionSeam[] = [];
  const anchors: { region: number; cell: HexCell }[] = [
    { region: steps[0].region, cell: walk[0] },
  ];

  for (let i = 1; i < steps.length; i++) {
    const previous = walk[walk.length - 1];
    let cursor = previous;

    if (steps[i].region !== steps[i - 1].region) {
      cursor = { q: cursor.q + shift.q, r: cursor.r + shift.r };
      seams.push({ step: i, region: steps[i].region, from: previous, to: cursor });
      anchors.push({ region: steps[i].region, cell: cursor });
    }

    const deg = steps[i].deg;
    if (degreeAt(cursor.q, cursor.r) === deg) {
      walk.push(cursor);
    } else {
      const dir = DIRS.find(([a, b]) => degreeAt(cursor.q + a, cursor.r + b) === deg);
      walk.push(dir ? { q: cursor.q + dir[0], r: cursor.r + dir[1] } : cursor);
    }
    regionOfStep.push(steps[i].region);
  }

  return { walk, regionOfStep, seams, anchors };
}
