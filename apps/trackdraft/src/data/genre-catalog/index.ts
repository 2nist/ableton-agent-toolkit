import type { SongMap } from "../songMaps";

// Individual genre map JSON files — each exports a valid SongMap object.
// Add new genres by dropping a .json file in this directory following the
// schema below. The catalog auto-discovers them via this static import list.
//
// Schema per file (matching SongMap from songMaps.ts):
// {
//   "id": "genre-<slug>",
//   "name": "Human-readable genre name",
//   "description": "One-line summary of the template's shape",
//   "defaults": { "bpm", "key", "scale", "concept" } (all optional),
//   "slots": [{ "role", "label", "purpose", "bars?", "velocity?", "beatsPerChord?", "timeSignatureNumerator?", "timeSignatureDenPower?" }]
// }

import mathRock from "./math-rock.json";
import stonerSludge from "./stoner-sludge.json";
import grunge from "./grunge.json";
import progRock from "./prog-rock.json";
import neoSoul from "./neo-soul.json";
import boomBap from "./boom-bap.json";
import indieFolk from "./indie-folk.json";
import blues from "./blues.json";

/** All genre maps in the catalog, keyed by map id for O(1) lookup. */
export const GENRE_CATALOG: SongMap[] = [
  mathRock,
  stonerSludge,
  grunge,
  progRock,
  neoSoul,
  boomBap,
  indieFolk,
  blues,
] as SongMap[];

/** Look up a genre map by its catalog id. Returns undefined if not found. */
export function getGenreMap(id: string): SongMap | undefined {
  return GENRE_CATALOG.find((m) => m.id === id);
}

/** All genre map ids currently in the catalog — for checking which genres
 *  have been researched vs. which are still unresearched. */
export const CATALOGED_GENRE_NAMES: Set<string> = new Set(
  GENRE_CATALOG.map((m) => m.name.toLowerCase()),
);