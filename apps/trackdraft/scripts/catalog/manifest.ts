/**
 * The catalogue manifest — one record per song, of where it came from, what it
 * contains, and whether it may be shipped.
 *
 * Pure functions only (no CLI, no side effects beyond reading files) so the
 * policy can be unit-tested. `build-catalog-manifest.ts` is the thin CLI over
 * this; `pack-starter-catalog.ts` is the only consumer allowed to decide what
 * ships, and it re-checks rather than trusting the manifest blindly.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { isRedistributable, sourceByKey, sourceForSong, type CorpusSource, type LicenceClass } from "./sources";
import { resolveRoot, type RootKey } from "../lib/catalogPaths";

/** The subset of a blueprint song the manifest reads. Loose on purpose: it
 *  parses arbitrary JSON off disk and must not fail on a field the schema has
 *  since renamed. */
export interface CatalogSongFile {
  id?: string;
  title?: string;
  artist?: string;
  sections?: {
    chords?: unknown[] | null;
    lyrics?: string | null;
    lyricsTimeline?: unknown[] | null;
  }[] | null;
  provenance?: {
    source?: string;
    warnings?: string[] | null;
  } | null;
}

export interface ManifestQuality {
  /** 0–1 audit confidence, when an audit report covers this song. */
  confidence: number;
  tier: string;
}

export interface ManifestSong {
  songId: string;
  file: string;
  dir: string;
  sha256: string;
  bytes: number;
  title: string;
  artist: string | null;
  sectionCount: number;
  chordCount: number;
  lyricLines: number;
  hasLyrics: boolean;
  /** Corpus key from `sources.ts`. */
  source: string;
  sourceLabel: string;
  licence: LicenceClass;
  /** False for anything not positively cleared — the packaging gate. */
  redistributable: boolean;
  licenceNote: string;
  /** How to rebuild this song, for whoever has to reproduce the library. */
  rebuild: { rootEnv: string; ingestScript: string };
  /** What the song's own `provenance.source` says (often generic). */
  provenanceSource: string | null;
  importWarnings: number;
  quality: ManifestQuality | null;
}

export interface ManifestRoot {
  key: string;
  envVar: string;
  label: string;
  /** null when the corpus is not installed on this machine. */
  path: string | null;
  /** True when the historical hard-coded path was used instead of the env var. */
  legacy: boolean;
}

export interface CatalogManifest {
  format: 1;
  generator: string;
  generatedAt: string;
  gitSha: string | null;
  roots: ManifestRoot[];
  totals: {
    songs: number;
    bytes: number;
    bySource: Record<string, number>;
    byLicence: Record<string, number>;
    redistributable: number;
    restricted: number;
    unreadable: number;
  };
  /** Song ids that appear in more than one directory (they would collide). */
  duplicateSongIds: { songId: string; files: string[] }[];
  songs: ManifestSong[];
}

export function sha256Of(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Short HEAD sha for the provenance record, or null outside a git checkout. */
export function gitShortSha(cwd = process.cwd()): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function countLyricLines(song: CatalogSongFile): number {
  let lines = 0;
  for (const section of song.sections ?? []) {
    const text = section?.lyrics;
    if (typeof text === "string" && text.trim() !== "") {
      lines += text.split("\n").filter((line) => line.trim() !== "").length;
    } else if (Array.isArray(section?.lyricsTimeline)) {
      lines += section.lyricsTimeline.length;
    }
  }
  return lines;
}

/** Read one catalogue file into a manifest row. Throws only on unreadable JSON;
 *  the caller decides whether that is fatal. */
export function songFactsFromFile(filePath: string, dirName: string, quality: ManifestQuality | null = null): ManifestSong {
  const raw = fs.readFileSync(filePath, "utf8");
  const song = JSON.parse(raw) as CatalogSongFile;
  const file = path.basename(filePath);
  const songId = song.id ?? file.replace(/\.trackdraft\.json$/i, "");
  const source: CorpusSource = sourceForSong(songId, dirName);
  const sections = song.sections ?? [];
  const chordCount = sections.reduce(
    (sum, section) => sum + (Array.isArray(section?.chords) ? section.chords.length : 0),
    0,
  );
  const lyricLines = countLyricLines(song);

  return {
    songId,
    file,
    dir: dirName,
    sha256: sha256Of(filePath),
    bytes: fs.statSync(filePath).size,
    title: song.title ?? songId,
    artist: song.artist ?? null,
    sectionCount: sections.length,
    chordCount,
    lyricLines,
    hasLyrics: lyricLines > 0,
    source: source.key,
    sourceLabel: source.label,
    licence: source.licence,
    redistributable: isRedistributable(source),
    licenceNote: source.licenceNote,
    rebuild: { rootEnv: source.rootEnv, ingestScript: source.ingestScript },
    provenanceSource: song.provenance?.source ?? null,
    importWarnings: song.provenance?.warnings?.length ?? 0,
    quality,
  };
}

/** Audit report → per-song quality, keyed by both id and file name so either
 *  lookup works. */
export function loadAuditIndex(auditPath: string): Map<string, ManifestQuality> {
  const index = new Map<string, ManifestQuality>();
  if (!fs.existsSync(auditPath)) return index;
  try {
    const report = JSON.parse(fs.readFileSync(auditPath, "utf8")) as {
      songs?: { songId?: string; file?: string; confidence?: number; tier?: string }[];
    };
    for (const entry of report.songs ?? []) {
      if (typeof entry.confidence !== "number") continue;
      const quality: ManifestQuality = { confidence: entry.confidence, tier: entry.tier ?? "unknown" };
      if (entry.songId) index.set(entry.songId, quality);
      if (entry.file) index.set(entry.file, quality);
    }
  } catch {
    /* an unreadable audit is a missing audit, not a crash */
  }
  return index;
}

export interface BuildManifestOptions {
  dirs: string[];
  auditPath?: string | null;
  generatedAt?: string;
  gitSha?: string | null;
}

export function buildManifest(options: BuildManifestOptions): CatalogManifest {
  const audit = options.auditPath ? loadAuditIndex(options.auditPath) : new Map<string, ManifestQuality>();
  const songs: ManifestSong[] = [];
  const seen = new Map<string, string[]>();
  let unreadable = 0;

  for (const dir of options.dirs) {
    if (!fs.existsSync(dir)) continue;
    const dirName = path.basename(dir);
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.toLowerCase().endsWith(".trackdraft.json"))
      .sort();
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const row = songFactsFromFile(filePath, dirName, audit.get(file) ?? null);
        songs.push(row);
        const bucket = seen.get(row.songId) ?? [];
        bucket.push(`${dirName}/${file}`);
        seen.set(row.songId, bucket);
      } catch {
        unreadable += 1;
      }
    }
  }

  songs.sort((a, b) => a.songId.localeCompare(b.songId) || a.dir.localeCompare(b.dir));

  const bySource: Record<string, number> = {};
  const byLicence: Record<string, number> = {};
  let bytes = 0;
  let redistributable = 0;
  for (const song of songs) {
    bySource[song.source] = (bySource[song.source] ?? 0) + 1;
    byLicence[song.licence] = (byLicence[song.licence] ?? 0) + 1;
    bytes += song.bytes;
    if (song.redistributable) redistributable += 1;
  }

  const roots: ManifestRoot[] = [...new Set(songs.map((song) => song.source))]
    .map((key) => sourceByKey(key))
    // `local` is authored in-app — there is no corpus to point at.
    .filter((source) => source.key !== "unknown" && source.key !== "local")
    .map((source) => {
      const resolved = resolveRoot(rootKeyFor(source.key), false);
      return {
        key: source.key,
        envVar: resolved.envVar,
        label: resolved.label,
        path: resolved.path,
        legacy: resolved.legacy,
      };
    });

  return {
    format: 1,
    generator: "scripts/build-catalog-manifest.ts",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    gitSha: options.gitSha === undefined ? gitShortSha() : options.gitSha,
    roots,
    totals: {
      songs: songs.length,
      bytes,
      bySource,
      byLicence,
      redistributable,
      restricted: songs.length - redistributable,
      unreadable,
    },
    duplicateSongIds: [...seen.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([songId, files]) => ({ songId, files })),
    songs,
  };
}

/** Map a source key to the `RootKey` that `catalogPaths` knows about. */
export function rootKeyFor(sourceKey: string): RootKey {
  switch (sourceKey) {
    case "beatles":
      return "beatlesChords";
    case "mcgill":
      return "mcgill";
    case "rock":
      return "rockCorpus";
    case "lalo-chezia":
      return "laloChezia";
    default:
      return "beatlesChords";
  }
}

/** A compact human table for the terminal (and for pasting into a PR). */
export function formatManifestSummary(manifest: CatalogManifest): string {
  const lines: string[] = [];
  const t = manifest.totals;
  lines.push(
    `catalog manifest — ${t.songs} songs · ${(t.bytes / 1048576).toFixed(2)} MB · ` +
      `${t.redistributable} redistributable · ${t.restricted} restricted` +
      (t.unreadable ? ` · ${t.unreadable} unreadable` : ""),
  );
  lines.push(`git ${manifest.gitSha ?? "(unknown)"} · ${manifest.generatedAt}`);
  lines.push("");
  const sources = Object.keys(t.bySource).sort();
  const width = Math.max(9, ...sources.map((key) => sourceForSong(`${key}-`).label.length));
  lines.push(`${"source".padEnd(width)}  songs  licence         ships`);
  for (const key of sources) {
    const source = sourceForSong(`${key}-`);
    lines.push(
      `${source.label.padEnd(width)}  ${String(t.bySource[key]).padStart(5)}  ` +
        `${source.licence.padEnd(14)}  ${isRedistributable(source) ? "yes" : "no"}`,
    );
  }
  if (manifest.duplicateSongIds.length > 0) {
    lines.push("", `duplicate song ids: ${manifest.duplicateSongIds.map((d) => d.songId).join(", ")}`);
  }
  return lines.join("\n");
}
