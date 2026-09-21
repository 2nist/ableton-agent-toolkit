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
//   "defaults": { "bpm", "key", "scale", "concept", "genre" } (all optional;
//               "genre" is an ENGINE family slug — one of rock, pop, bossa,
//               ballad, trap, house, neo-soul, math-rock — set only when the
//               genre IS that family; it drives Groove DNA + Bend seeding),
//   "slots": [{ "role", "label", "purpose", "bars?", "velocity?", "beatsPerChord?",
//               "timeSignatureNumerator?", "timeSignatureDenPower?",
//               "progression?", "groove?", "swing?", "optional?",
//               "harmonyRhythm? (\"beats\"|\"euclid\"|\"follow drums\")",
//               "harmonyCellCount?", "harmonyRotation?", "syncopationOffset?" }],
//   "variants": [{ "name", "description?", "slots": [...] }] (optional — alternate
//               structures for genres with more than one canonical form, e.g. a
//               loop-based vs. song-oriented shape; shares this file's "defaults")
// }
//
// Filename contract (reconciled 2026-09-21): each file is named exactly
// genreMapFilename()'s output — the map id minus the leading "genre-",
// slugified ("genre-math-rock-78" → "math-rock-78.json"). Five legacy files
// that predated this rule were renamed to match (math-rock, prog-rock, blues,
// grunge, neo-soul), so the Genre Workbench's "Copy to catalog" now always
// names the file that actually exists. Keep new files on the contract.

import mathRock from "./math-rock-78.json";
import stonerSludge from "./stoner-sludge.json";
import grunge from "./grunge-soft-loud.json";
import progRock from "./prog-rock-54.json";
import neoSoul from "./neo-soul-modal.json";
import boomBap from "./boom-bap.json";
import indieFolk from "./indie-folk.json";
import blues from "./blues-12bar.json";
import industrial from "./industrial.json";
import electroIndustrialEbm from "./electro-industrial-ebm.json";
import trapMetal from "./trap-metal.json";
import bossaNova from "./bossa-nova.json";
import neoPsychedelia from "./neo-psychedelia.json";
import synthwave from "./synthwave.json";

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
  industrial,
  electroIndustrialEbm,
  trapMetal,
  bossaNova,
  neoPsychedelia,
  synthwave,
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
