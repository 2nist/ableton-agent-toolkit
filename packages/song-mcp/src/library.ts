import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintSong } from "@music-theory/song-blueprint";

/**
 * Filesystem access for the song library. Extracted from the MCP entrypoint
 * so the path handling can be tested without starting the stdio server.
 *
 * Ids reach this module from model-authored tool arguments, so they are
 * validated before being joined into a path: `../../.ssh/authorized_keys`
 * must not be able to read or write outside the library.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeId(id: string): boolean {
  return typeof id === "string" && id !== "." && id !== ".." && SAFE_ID.test(id);
}

export function assertSafeId(id: string, label = "songId"): string {
  if (!isSafeId(id)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(id)}. Use the id only (letters, digits, dot, dash, underscore) — paths are not accepted.`,
    );
  }
  return id;
}

export interface SongLibrary {
  dir: string;
  templatesDir: string;
  backupsDir: string;
  readSong: (id: string) => BlueprintSong | null;
  writeSong: (song: BlueprintSong) => void;
  backupSong: (songId: string) => string | null;
  listBackups: (songId: string) => string[];
  listAllSongs: () => BlueprintSong[];
}

export function createSongLibrary(libraryDir: string): SongLibrary {
  const dir = path.resolve(libraryDir);
  const templatesDir = path.resolve(dir, "..", "templates");
  const backupsDir = path.resolve(dir, "..", ".backups");

  function ensureDir(target: string): void {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  }

  function songFile(id: string): string {
    return path.join(dir, `${assertSafeId(id)}.blueprint.json`);
  }

  function readSong(id: string): BlueprintSong | null {
    const file = songFile(id);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as BlueprintSong;
    } catch {
      return null;
    }
  }

  function writeSong(song: BlueprintSong): void {
    ensureDir(dir);
    const file = songFile(song.id);
    song.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(song, null, 2), "utf-8");
  }

  function backupSong(songId: string): string | null {
    const src = songFile(songId);
    if (!fs.existsSync(src)) return null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(backupsDir, assertSafeId(songId));
    ensureDir(backupDir);
    const dest = path.join(backupDir, `${timestamp}.json`);
    fs.copyFileSync(src, dest);
    return dest;
  }

  function listBackups(songId: string): string[] {
    const backupDir = path.join(backupsDir, assertSafeId(songId));
    if (!fs.existsSync(backupDir)) return [];
    return fs
      .readdirSync(backupDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse();
  }

  function listAllSongs(): BlueprintSong[] {
    ensureDir(dir);
    const songs: BlueprintSong[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".blueprint.json")) continue;
      const id = file.replace(".blueprint.json", "");
      // Skip anything that isn't a valid id rather than failing the whole list.
      if (!isSafeId(id)) continue;
      const song = readSong(id);
      if (song) songs.push(song);
    }
    return songs;
  }

  return { dir, templatesDir, backupsDir, readSong, writeSong, backupSong, listBackups, listAllSongs };
}
