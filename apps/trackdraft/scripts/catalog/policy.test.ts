import { describe, expect, it } from "vitest";
import { selectForPack, tallyByLicence, type AllowlistEntry } from "./policy";
import type { CatalogManifest, ManifestSong } from "./manifest";

function song(songId: string, licence: ManifestSong["licence"], redistributable: boolean): ManifestSong {
  return {
    songId,
    file: `${songId}.trackdraft.json`,
    dir: "catalog",
    sha256: "0".repeat(64),
    bytes: 100,
    title: songId,
    artist: null,
    sectionCount: 1,
    chordCount: 1,
    lyricLines: 0,
    hasLyrics: false,
    source: licence === "cleared" ? "local" : "beatles",
    sourceLabel: licence,
    licence,
    redistributable,
    licenceNote: "test",
    rebuild: { rootEnv: "X", ingestScript: "y" },
    provenanceSource: null,
    importWarnings: 0,
    quality: null,
  };
}

function manifest(songs: ManifestSong[]): CatalogManifest {
  return {
    format: 1,
    generator: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    gitSha: null,
    roots: [],
    totals: {
      songs: songs.length,
      bytes: 0,
      bySource: {},
      byLicence: {},
      redistributable: songs.filter((s) => s.redistributable).length,
      restricted: songs.filter((s) => !s.redistributable).length,
      unreadable: 0,
    },
    duplicateSongIds: [],
    songs,
  };
}

const restricted = song("beatles-01-a", "copyrighted", false);
const research = song("mcgill-x", "research-only", false);
const cleared = song("local-tune", "cleared", true);
const library = manifest([restricted, research, cleared]);

describe("release profile", () => {
  it("ships cleared songs only when the allowlist is empty", () => {
    const result = selectForPack(library, [], { profile: "release", acknowledgedRestricted: false });
    expect(result.selected.map((s) => s.songId)).toEqual(["local-tune"]);
    expect(result.excluded.map((s) => s.songId)).toEqual(["beatles-01-a", "mcgill-x"]);
    expect(result.distributable).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.containsRestricted).toBe(false);
  });

  it("is distributable and empty when nothing is cleared", () => {
    const result = selectForPack(manifest([restricted, research]), [], {
      profile: "release",
      acknowledgedRestricted: false,
    });
    expect(result.selected).toEqual([]);
    expect(result.distributable).toBe(true);
    expect(result.excluded).toHaveLength(2);
  });

  it("ships a restricted song that is explicitly attested", () => {
    const allowlist: AllowlistEntry[] = [{ songId: "mcgill-x", attested: true, note: "licensed 2026" }];
    const result = selectForPack(library, allowlist, { profile: "release", acknowledgedRestricted: false });
    expect(result.selected.map((s) => s.songId).sort()).toEqual(["local-tune", "mcgill-x"]);
    expect(result.attested).toEqual(["mcgill-x"]);
    expect(result.distributable).toBe(true);
    // It is in the pack, but the pack still carries restricted material and
    // must say so.
    expect(result.containsRestricted).toBe(true);
  });

  it("refuses a restricted song listed without attestation", () => {
    const result = selectForPack(library, [{ songId: "beatles-01-a" }], {
      profile: "release",
      acknowledgedRestricted: false,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("without \"attested\": true");
    expect(result.selected.map((s) => s.songId)).toEqual(["local-tune"]);
    expect(result.distributable).toBe(false);
  });

  it("refuses an allowlist entry that names a song the manifest does not have", () => {
    const result = selectForPack(library, [{ songId: "ghost-song", attested: true }], {
      profile: "release",
      acknowledgedRestricted: false,
    });
    expect(result.violations[0]).toContain("ghost-song");
    expect(result.distributable).toBe(false);
  });

  it("does not require attestation for a song already cleared by class", () => {
    const result = selectForPack(library, [{ songId: "local-tune" }], {
      profile: "release",
      acknowledgedRestricted: false,
    });
    expect(result.violations).toEqual([]);
    expect(result.attested).toEqual([]);
    expect(result.selected.map((s) => s.songId)).toEqual(["local-tune"]);
  });
});

describe("internal profile", () => {
  it("includes everything, and is never distributable", () => {
    const result = selectForPack(library, [], { profile: "internal", acknowledgedRestricted: true });
    expect(result.selected).toHaveLength(3);
    expect(result.excluded).toEqual([]);
    expect(result.distributable).toBe(false);
    expect(result.containsRestricted).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("refuses to run without the acknowledgement", () => {
    const result = selectForPack(library, [], { profile: "internal", acknowledgedRestricted: false });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("--acknowledge-restricted");
  });

  it("still reports an allowlist entry for a song that does not exist", () => {
    const result = selectForPack(library, [{ songId: "ghost-song" }], {
      profile: "internal",
      acknowledgedRestricted: true,
    });
    expect(result.violations[0]).toContain("ghost-song");
  });

  it("is never distributable even when every song is cleared", () => {
    const result = selectForPack(manifest([cleared]), [], {
      profile: "internal",
      acknowledgedRestricted: true,
    });
    expect(result.distributable).toBe(false);
    expect(result.containsRestricted).toBe(false);
  });
});

describe("tallyByLicence", () => {
  it("counts the classes in the selection", () => {
    expect(tallyByLicence([restricted, research, cleared, cleared])).toEqual({
      copyrighted: 1,
      "research-only": 1,
      cleared: 2,
    });
  });
});
