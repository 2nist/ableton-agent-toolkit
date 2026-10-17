import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BlueprintSong } from "@music-theory/song-blueprint";
import { assertSafeId, createSongLibrary } from "../src/library.js";

let root: string;

function makeSong(overrides: Partial<BlueprintSong> = {}): BlueprintSong {
  const now = new Date().toISOString();
  return {
    id: "song-1",
    title: "Pilot",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "trackdraft-library-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("id validation", () => {
  it("accepts the ids the app actually uses", () => {
    expect(assertSafeId("song-1")).toBe("song-1");
    expect(assertSafeId("5f0c9b1e-2a3d-4c5e-8f90-abcdef123456")).toMatch(/^5f0c/);
    expect(assertSafeId("lalo.chezia_01")).toBe("lalo.chezia_01");
  });

  it("rejects traversal, absolute paths, and separators", () => {
    for (const id of ["../escape", "..", ".", "/etc/passwd", "a/b", "a\\b", ""]) {
      expect(() => assertSafeId(id)).toThrow(/Invalid songId/);
    }
  });
});

describe("createSongLibrary", () => {
  it("round-trips a song and preserves the directory boundary", () => {
    const library = createSongLibrary(path.join(root, "library"));
    library.writeSong(makeSong());
    expect(library.readSong("song-1")?.title).toBe("Pilot");
    expect(library.listAllSongs()).toHaveLength(1);
  });

  it("refuses to read or write through a traversal id", () => {
    const library = createSongLibrary(path.join(root, "library"));
    expect(() => library.readSong("../../etc/passwd")).toThrow(/Invalid songId/);
    expect(() => library.writeSong(makeSong({ id: "../../pwned" }))).toThrow(/Invalid songId/);
    expect(() => library.backupSong("../x")).toThrow(/Invalid songId/);
    expect(() => library.listBackups("../x")).toThrow(/Invalid songId/);
  });

  it("backs up before a write and lists newest first", () => {
    const library = createSongLibrary(path.join(root, "library"));
    library.writeSong(makeSong());
    const backup = library.backupSong("song-1");
    expect(backup).toBeTruthy();
    expect(fs.existsSync(backup!)).toBe(true);
    expect(library.listBackups("song-1")).toHaveLength(1);

    library.writeSong(makeSong({ title: "Renamed" }));
    expect(library.readSong("song-1")?.title).toBe("Renamed");
  });

  it("skips malformed filenames instead of failing the whole listing", () => {
    const library = createSongLibrary(path.join(root, "library"));
    library.writeSong(makeSong());
    fs.writeFileSync(path.join(library.dir, "bad name.blueprint.json"), "{}");
    const songs = library.listAllSongs();
    expect(songs.map((song) => song.id)).toEqual(["song-1"]);
  });

  it("derives templates and backups as siblings of the library", () => {
    const library = createSongLibrary(path.join(root, "library"));
    expect(library.templatesDir).toBe(path.join(root, "templates"));
    expect(library.backupsDir).toBe(path.join(root, ".backups"));
  });
});
