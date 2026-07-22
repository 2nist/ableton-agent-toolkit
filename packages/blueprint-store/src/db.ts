import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BlueprintSong } from "@music-theory/song-blueprint";

/** A personal catalog, not project-scoped — matches how the Ableton
 *  Extensions storageDirectory convention worked out elsewhere in this
 *  toolkit (per-user, not per-repo). */
export const DEFAULT_DB_PATH = path.join(os.homedir(), ".trackdraft", "blueprints.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT,
    key TEXT NOT NULL,
    scale TEXT NOT NULL,
    bpm REAL NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
`;

/** Lightweight browsing/filtering shape — the typed columns, without
 *  deserializing every full blueprint's nested JSON just to list songs. */
export interface BlueprintSummary {
  id: string;
  title: string;
  artist?: string;
  key: string;
  scale: string;
  bpm: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintStore {
  /** Upserts by id — re-saving the same song's id replaces it, matching
   *  TrackDraft's own songStore.importSong dedupe semantics, rather than
   *  accumulating duplicates on repeated ingestion runs. */
  saveBlueprint(song: BlueprintSong): void;
  loadBlueprint(id: string): BlueprintSong | undefined;
  listBlueprints(): BlueprintSummary[];
  deleteBlueprint(id: string): void;
  close(): void;
}

interface BlueprintRow {
  id: string;
  title: string;
  artist: string | null;
  key: string;
  scale: string;
  bpm: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export function openBlueprintStore(dbPath: string = DEFAULT_DB_PATH): BlueprintStore {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec(SCHEMA);

  const upsertStmt = db.prepare(`
    INSERT INTO blueprints (id, title, artist, key, scale, bpm, source, created_at, updated_at, data)
    VALUES (@id, @title, @artist, @key, @scale, @bpm, @source, @createdAt, @updatedAt, @data)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      key = excluded.key,
      scale = excluded.scale,
      bpm = excluded.bpm,
      source = excluded.source,
      updated_at = excluded.updated_at,
      data = excluded.data
  `);
  const selectStmt = db.prepare<[string], { data: string }>(`SELECT data FROM blueprints WHERE id = ?`);
  const listStmt = db.prepare<[], BlueprintRow>(
    `SELECT id, title, artist, key, scale, bpm, source, created_at, updated_at
     FROM blueprints ORDER BY updated_at DESC`,
  );
  const deleteStmt = db.prepare(`DELETE FROM blueprints WHERE id = ?`);

  return {
    saveBlueprint(song) {
      upsertStmt.run({
        id: song.id,
        title: song.title,
        artist: song.artist ?? null,
        key: song.key,
        scale: song.scale,
        bpm: song.bpm,
        source: song.provenance?.source ?? "manual",
        createdAt: song.createdAt,
        updatedAt: song.updatedAt,
        data: JSON.stringify(song),
      });
    },
    loadBlueprint(id) {
      const row = selectStmt.get(id);
      return row ? (JSON.parse(row.data) as BlueprintSong) : undefined;
    },
    listBlueprints() {
      return listStmt.all().map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist ?? undefined,
        key: r.key,
        scale: r.scale,
        bpm: r.bpm,
        source: r.source,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    deleteBlueprint(id) {
      deleteStmt.run(id);
    },
    close() {
      db.close();
    },
  };
}
