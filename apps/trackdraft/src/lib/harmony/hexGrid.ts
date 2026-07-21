
/** Re-exports from honeycombWalk.ts — the single source of truth for
 *  hex-grid math, pixel conversion, and the static diatonic cell map.
 *
 *  Previously this file had its own copies of degreeAt(), hexToPixel(),
 *  hexPoints(), and getDiatonicHexCells().  Now that the honeycomb walk
 *  engine is the canonical implementation, hexGrid just re-exports so
 *  existing callers (e.g. HexWheel) don't need updating. */

export {
  degreeAt,
  hexDistance,
  hexToPixel,
  hexPoints,
  getDiatonicHexCells,
} from "./honeycombWalk";

export type { DiatonicHexCell } from "./honeycombWalk";

// Keep the old HexCell name as a type alias for backward compat
import type { DiatonicHexCell } from "./honeycombWalk";
export type HexCell = DiatonicHexCell;