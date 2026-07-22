# @platform/blueprint-store

A Node-side SQLite catalog for `BlueprintSong` data. Separate from TrackDraft's web app on purpose — the browser keeps using `localStorage` + JSON import/export exactly as before; this package is for ingestion/extraction scripts (docx, audio, future MIDI) and other Node tooling that wants a durable, queryable archive without a backend server.

## Hybrid schema, not fully normalized

```sql
CREATE TABLE blueprints (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT,
  key TEXT NOT NULL, scale TEXT NOT NULL, bpm REAL NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  data TEXT NOT NULL  -- the full BlueprintSong, as JSON
);
```

Typed columns exist so `listBlueprints()` can browse/filter without deserializing every song's full nested content; `data` is the actual source of truth on load. Deliberately not normalized into separate `sections`/`chords` tables — this data is always read/written as one whole "song" unit in practice, so full relational normalization would mean migration ceremony without a real query benefit today.

## Upsert semantics

`saveBlueprint()` replaces by `id` (SQLite `ON CONFLICT DO UPDATE`) rather than accumulating duplicates on repeated ingestion runs — matches TrackDraft's own `songStore.importSong` dedupe behavior.

## Default DB location

`~/.trackdraft/blueprints.db` — a personal catalog, not project-scoped. Pass an explicit path (or `":memory:"` for tests) to `openBlueprintStore()` to override.
