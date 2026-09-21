# TrackDraft genre maps (SongMap system)

The "genre map" system lets a researched genre template program a song's
structure, harmony rhythm, and drum identity in one apply. This is the
global picture; the code lives in `apps/trackdraft/src/data/`.

## Two map sources

| Source | File | What it is |
|---|---|---|
| **Narrative / mood maps** | `data/songMaps.ts` (`SONG_MAPS`) | Hand-authored forms with dramatic purpose per slot (Classic Pop, PEC, Journey, Minimal/Ambient). No genre identity. |
| **Genre catalog** | `data/genre-catalog/*.json` | AI-researched, per-genre maps (14 so far, from a 119-genre master list). Richer: progressions, groove prose, harmony rhythm, swing, variants. |

Two maps that used to sit in both places (math-rock-78, stoner-sludge) were
retired from `SONG_MAPS` in 2026-09 — the catalog versions superseded them.

## Authoring flow — Genre Workbench

`/genre-workbench` (linked from the Dashboard header as "Genre Maps"):

1. Pick an un-researched genre from the master list (✓ = already cataloged;
   matching is slug-based, so "Neo Soul" counts as covered by the catalog's
   "Neo-Soul / Jazz Fusion").
2. "Generate prompt" builds the full system prompt (`data/genre-prompt.ts`).
3. Hand it to an AI agent; paste the returned JSON back.
4. "Validate JSON" runs `validateSongMapShape` (roles, meter, harmony
   rhythm, engine genre — all checked against the real unions).
5. "Copy to catalog" emits the JSON with its **exact required filename**.

### Filename contract

Each catalog file is named exactly `genreMapFilename()`'s output: the map
`id` minus the leading `genre-`, slugified (`genre-math-rock-78` →
`math-rock-78.json`). Five legacy files were renamed to match on 2026-09-21.
`data/genre-prompt.test.ts` locks the contract against the real directory.

## Apply flow

`applySongMap` (`src/lib/sections.ts`) is called by the Structure tab's
MapPicker and by Dashboard → Templates (cards now apply immediately on
create). What it does:

- Mints fresh sections from the selected slots (or a named variant);
  `optional` slots can be dropped for a shorter edit.
- `progression` → real chords via the honeycomb parser, in the map's key/scale.
- `harmonyRhythm` → euclid outlines / follow-drums / push offsets.
- `groove` prose → legacy `drumPattern` only when unambiguously representable.
- `defaults` (bpm/key/scale/concept) applied where set — never clearing
  what the map doesn't declare.
- **Engine genre (`defaults.genre`)**: when the genre IS one of the drum
  engine's eight families (`rock, pop, bossa, ballad, trap, house,
  neo-soul, math-rock` — the `GENRE_GROOVES` / `STYLE_RECIPES` key set in
  `@drum/library`), the slug is written to `song.genre`, engaging Groove
  DNA (family-lean drum selection) exactly like manually applying a style
  recipe in Mix/Bend. The MapPicker additionally offers an opt-in
  checkbox to seed the Bend sliders from that genre's `STYLE_RECIPES`
  entry (tempo excluded — the map's researched BPM wins).
- `concept` remains the general channel for genres *outside* the eight —
  its keyword scan routes acoustic vs. electronic and stays the mechanism
  for hybrid/no-family genres.

## Tests

- `src/lib/sections.test.ts` — applySongMap: variants, optional slots,
  progressions, harmony rhythm, engine genre writes, recipe seeding.
- `src/data/genre-prompt.test.ts` — validator accepts the whole catalog,
  rejects bad roles/rhythm/genre; filename contract vs. real files.

## Consumers elsewhere

- `packages/song-mcp` exposes `song_create_template` with a zod schema
  mirroring `MapSlot` (updated 2026-09-21 — previously it silently stripped
  the progression/groove/harmony fields).
- The Ableton extension (`extensions/trackdraft-bridge`) never sees maps —
  only applied songs, and reads `song.genre` for the same family-lean
  resolution (parity-tested).
