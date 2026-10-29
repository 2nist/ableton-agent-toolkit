import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildManifest,
  formatManifestSummary,
  loadAuditIndex,
  sha256Of,
  songFactsFromFile,
} from "./manifest";

let root: string;

function writeSong(dir: string, id: string, extra: Record<string, unknown> = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.trackdraft.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      id,
      title: id.replace(/-/g, " "),
      artist: "Test",
      sections: [
        { chords: [{}, {}], lyrics: "line one\nline two\n" },
        { chords: [{}], lyrics: "" },
      ],
      provenance: { source: "catalog-lookup", warnings: ["a", "b"] },
      ...extra,
    }),
  );
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-manifest-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("songFactsFromFile", () => {
  it("reads counts, hash and licence from the file and its corpus", () => {
    const file = writeSong(path.join(root, "catalog"), "beatles-01-please-please-me");
    const row = songFactsFromFile(file, "catalog");

    expect(row.songId).toBe("beatles-01-please-please-me");
    expect(row.sectionCount).toBe(2);
    expect(row.chordCount).toBe(3);
    expect(row.lyricLines).toBe(2);
    expect(row.hasLyrics).toBe(true);
    expect(row.source).toBe("beatles");
    expect(row.licence).toBe("copyrighted");
    expect(row.redistributable).toBe(false);
    expect(row.sha256).toBe(sha256Of(file));
    expect(row.importWarnings).toBe(2);
    expect(row.rebuild.ingestScript).toBe("scripts/ingest-beatles-catalog.ts");
  });

  it("marks a locally authored song as shippable", () => {
    const file = writeSong(path.join(root, "local-catalog"), "local-my-tune");
    const row = songFactsFromFile(file, "local-catalog");
    expect(row.licence).toBe("cleared");
    expect(row.redistributable).toBe(true);
  });

  it("treats an unidentifiable song as unshippable", () => {
    const file = writeSong(path.join(root, "misc"), "mystery-song");
    const row = songFactsFromFile(file, "misc");
    expect(row.licence).toBe("unknown");
    expect(row.redistributable).toBe(false);
  });

  it("never grants shipping rights from a directory name alone", () => {
    // Dropping an unidentified file into the cleared folder must not launder it.
    const file = writeSong(path.join(root, "local-catalog"), "mystery-song");
    const row = songFactsFromFile(file, "local-catalog");
    expect(row.licence).not.toBe("cleared");
    expect(row.redistributable).toBe(false);
  });
});

describe("buildManifest", () => {
  it("totals by source and licence, and counts nothing as shippable in a research library", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    writeSong(path.join(root, "catalog"), "beatles-02-b");
    writeSong(path.join(root, "mcgill-catalog"), "mcgill-x");

    const manifest = buildManifest({
      dirs: [path.join(root, "catalog"), path.join(root, "mcgill-catalog")],
      generatedAt: "2026-01-01T00:00:00.000Z",
      gitSha: "abc1234",
    });

    expect(manifest.format).toBe(1);
    expect(manifest.generator).toContain("build-catalog-manifest");
    expect(manifest.totals.songs).toBe(3);
    expect(manifest.totals.bySource).toEqual({ beatles: 2, mcgill: 1 });
    expect(manifest.totals.byLicence).toEqual({ copyrighted: 2, "research-only": 1 });
    expect(manifest.totals.redistributable).toBe(0);
    expect(manifest.totals.restricted).toBe(3);
    expect(manifest.gitSha).toBe("abc1234");
  });

  it("sorts songs by id so two runs on unchanged input produce identical files", () => {
    writeSong(path.join(root, "catalog"), "beatles-03-c");
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    writeSong(path.join(root, "catalog"), "beatles-02-b");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog")], generatedAt: "x", gitSha: null });
    expect(manifest.songs.map((song) => song.songId)).toEqual([
      "beatles-01-a",
      "beatles-02-b",
      "beatles-03-c",
    ]);
  });

  it("reports song ids that exist in more than one directory", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    writeSong(path.join(root, "mcgill-catalog"), "beatles-01-a");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog"), path.join(root, "mcgill-catalog")], gitSha: null });
    expect(manifest.duplicateSongIds).toEqual([
      { songId: "beatles-01-a", files: ["catalog/beatles-01-a.trackdraft.json", "mcgill-catalog/beatles-01-a.trackdraft.json"] },
    ]);
  });

  it("counts unparseable files instead of failing the run, and excludes them", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    fs.writeFileSync(path.join(root, "catalog", "beatles-02-broken.trackdraft.json"), "{ not json");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog")], gitSha: null });
    expect(manifest.totals.songs).toBe(1);
    expect(manifest.totals.unreadable).toBe(1);
  });

  it("ignores directories that do not exist", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    const manifest = buildManifest({ dirs: [path.join(root, "nope"), path.join(root, "catalog")], gitSha: null });
    expect(manifest.totals.songs).toBe(1);
  });

  it("records the resolved corpus roots it read from", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    writeSong(path.join(root, "rock-catalog"), "rock-01-a");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog"), path.join(root, "rock-catalog")], gitSha: null });
    const keys = manifest.roots.map((entry) => entry.key).sort();
    expect(keys).toEqual(["beatles", "rock"]);
    for (const entry of manifest.roots) {
      expect(entry.envVar).toMatch(/^[A-Z_]+$/);
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("legacy");
    }
  });
});

describe("audit join", () => {
  it("attaches confidence by song id and by file name", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    const auditPath = path.join(root, "catalog-audit.json");
    fs.writeFileSync(
      auditPath,
      JSON.stringify({
        songs: [
          { songId: "beatles-01-a", file: "beatles-01-a.trackdraft.json", confidence: 0.91, tier: "high" },
        ],
      }),
    );

    const index = loadAuditIndex(auditPath);
    expect(index.get("beatles-01-a")).toEqual({ confidence: 0.91, tier: "high" });
    expect(index.get("beatles-01-a.trackdraft.json")).toEqual({ confidence: 0.91, tier: "high" });

    const manifest = buildManifest({ dirs: [path.join(root, "catalog")], auditPath, gitSha: null });
    expect(manifest.songs[0].quality).toEqual({ confidence: 0.91, tier: "high" });
  });

  it("treats a missing or corrupt audit as no audit", () => {
    expect(loadAuditIndex(path.join(root, "missing.json")).size).toBe(0);
    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, "{ nope");
    expect(loadAuditIndex(bad).size).toBe(0);
  });

  it("leaves quality null when no audit covers the song", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog")], gitSha: null });
    expect(manifest.songs[0].quality).toBeNull();
  });
});

describe("formatManifestSummary", () => {
  it("states the shippable count, which is the number that matters", () => {
    writeSong(path.join(root, "catalog"), "beatles-01-a");
    writeSong(path.join(root, "local-catalog"), "local-tune");
    const manifest = buildManifest({ dirs: [path.join(root, "catalog"), path.join(root, "local-catalog")], gitSha: null });
    const summary = formatManifestSummary(manifest);
    expect(summary).toContain("2 songs");
    expect(summary).toContain("1 redistributable");
    expect(summary).toContain("1 restricted");
    expect(summary).toMatch(/Locally authored/);
  });
});
