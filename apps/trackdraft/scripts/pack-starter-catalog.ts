#!/usr/bin/env tsx
/**
 * Build the SHIPPED catalogue — the only place licence policy is enforced.
 *
 * Two profiles:
 *
 *   --profile release   (default) songs the manifest calls `cleared`, plus
 *                       anything the allowlist names with "attested": true.
 *                       The only profile that may be distributed.
 *
 *   --profile internal  EVERYTHING, for early test builds. Requires
 *                       --acknowledge-restricted, writes to a differently
 *                       named directory, and stamps every artifact it emits
 *                       as not-for-distribution.
 *
 * Usage:
 *   npm run catalog:pack:starter
 *   npm run catalog:pack:starter -- --dry
 *   npm run catalog:pack:starter -- --profile internal --acknowledge-restricted
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_CATALOG_DIRS,
  MANIFEST_PATH,
  OUTPUT_DIR,
  STARTER_ALLOWLIST_PATH,
} from "./lib/catalogPaths";
import { sha256Of, type CatalogManifest, type ManifestSong } from "./catalog/manifest";
import {
  selectForPack,
  tallyByLicence,
  type AllowlistEntry,
  type PackProfile,
} from "./catalog/policy";

interface Args {
  manifestPath: string;
  allowlistPath: string;
  out: string | null;
  profile: PackProfile;
  acknowledgedRestricted: boolean;
  dry: boolean;
  force: boolean;
  dirs: string[];
  /** Restrict the pack to these corpus keys (repeatable). Empty = no filter. */
  sources: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    manifestPath: MANIFEST_PATH,
    allowlistPath: STARTER_ALLOWLIST_PATH,
    out: null,
    profile: "release",
    acknowledgedRestricted: false,
    dry: false,
    force: false,
    dirs: [...DEFAULT_CATALOG_DIRS],
    sources: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--manifest":
        args.manifestPath = path.resolve(argv[++i]);
        break;
      case "--allowlist":
        args.allowlistPath = path.resolve(argv[++i]);
        break;
      case "--out":
        args.out = path.resolve(argv[++i]);
        break;
      case "--dir":
        args.dirs.push(path.resolve(argv[++i]));
        break;
      case "--profile": {
        const value = argv[++i];
        if (value !== "release" && value !== "internal") {
          throw new Error(`--profile must be "release" or "internal", got "${value}"`);
        }
        args.profile = value;
        break;
      }
      case "--acknowledge-restricted":
        args.acknowledgedRestricted = true;
        break;
      case "--source":
        args.sources.push(String(argv[++i]));
        break;
      case "--dry":
        args.dry = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "usage: pack-starter-catalog [options]",
            "",
            "  --profile release|internal   release (default) ships cleared songs only;",
            "                               internal ships everything and is never distributable",
            "  --acknowledge-restricted     required for --profile internal",
            "  --manifest <path>            default scripts/output/catalog.manifest.json",
            "  --allowlist <path>           default scripts/catalog/starter-allowlist.json",
            "  --dir <catalogDir>...        where the songs live (default: all output dirs)",
            "  --source <corpusKey>...      only these corpora (beatles, mcgill, rock, lalo-chezia, local)",
            "  --out <dir>                  default scripts/output/catalog-starter",
            "  --dry                        report only",
            "  --force                      replace an existing output directory",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        if (argv[i]?.startsWith("--")) throw new Error(`Unknown flag: ${argv[i]}`);
    }
  }
  // Distinct default directories: an internal pack can never be mistaken for
  // (or overwrite) a release pack.
  if (!args.out) {
    args.out = path.join(OUTPUT_DIR, args.profile === "internal" ? "catalog-internal" : "catalog-starter");
  }
  return args;
}

/** Locate a song's file: the manifest records the directory NAME (machine
 *  independent), so it is matched against the directories we were given. */
function resolveSongPath(song: ManifestSong, dirs: string[]): string | null {
  const dir = dirs.find((candidate) => path.basename(candidate) === song.dir);
  if (!dir) return null;
  const candidate = path.join(dir, song.file);
  return fs.existsSync(candidate) ? candidate : null;
}

function readAllowlist(allowlistPath: string): AllowlistEntry[] {
  if (!fs.existsSync(allowlistPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(allowlistPath, "utf8")) as { songs?: AllowlistEntry[] };
    return Array.isArray(parsed.songs) ? parsed.songs : [];
  } catch (error) {
    throw new Error(`Unreadable allowlist ${allowlistPath}: ${(error as Error).message}`);
  }
}

const args = parseArgs(process.argv.slice(2));

if (!fs.existsSync(args.manifestPath)) {
  console.error(
    `No manifest at ${args.manifestPath}.\nRun "npm run catalog:manifest" first — packaging decides from the manifest, never by guessing.`,
  );
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(args.manifestPath, "utf8")) as CatalogManifest;
const allowlist = readAllowlist(args.allowlistPath);
const selection = selectForPack(manifest, allowlist, {
  profile: args.profile,
  acknowledgedRestricted: args.acknowledgedRestricted,
});

if (selection.violations.length > 0) {
  console.error(`Refusing to pack (profile: ${selection.profile}) — ${selection.violations.length} problem(s):\n`);
  for (const message of selection.violations) console.error(`  ✗ ${message}`);
  if (selection.profile === "release") {
    console.error(
      `\n${manifest.totals.restricted} of ${manifest.totals.songs} catalogue songs are restricted ` +
        `(${Object.entries(manifest.totals.byLicence)
          .map(([licence, count]) => `${licence}: ${count}`)
          .join(", ")}). This is expected: the library is for local use, the release pack is not.`,
    );
  }
  process.exit(1);
}

/* A corpus filter narrows the pack; it can never widen it. Applying it after
 * the policy decision keeps "release ships only cleared songs" intact. */
const filtered = args.sources.length
  ? selection.selected.filter((song) => args.sources.includes(song.source))
  : selection.selected;
const selectedSongs = filtered;

const located = selectedSongs
  .map((song) => ({ song, filePath: resolveSongPath(song, args.dirs) }))
  .filter((entry): entry is { song: ManifestSong; filePath: string } => entry.filePath !== null);

if (located.length !== selectedSongs.length) {
  console.error("Refusing to pack — selected files are not on disk (regenerate the manifest):");
  for (const song of selectedSongs) {
    if (resolveSongPath(song, args.dirs) === null) console.error(`  ✗ ${song.dir}/${song.file}`);
  }
  process.exit(1);
}

/* Integrity: the copy must be the file the manifest described. A stale
 * manifest would let an unchecked edit ride into a build. */
const stale = located.filter((entry) => sha256Of(entry.filePath) !== entry.song.sha256);
if (stale.length > 0) {
  console.error("Refusing to pack — files changed since the manifest was written:");
  for (const entry of stale) console.error(`  ✗ ${entry.song.dir}/${entry.song.file}`);
  console.error('Run "npm run catalog:manifest" and review the diff before packing.');
  process.exit(1);
}

if (args.sources.length > 0 && selectedSongs.length === 0 && selection.selected.length > 0) {
  const available = [...new Set(selection.selected.map((song) => song.source))].sort();
  console.error(
    `--source matched nothing. Known corpora in this manifest: ${available.join(", ")}`,
  );
  process.exit(1);
}

const counts = tallyByLicence(selectedSongs);
const out = args.out!;
const summary = [
  `profile:    ${selection.profile}${selection.distributable ? "" : "   ← NOT FOR DISTRIBUTION"}`,
  `manifest:   ${path.relative(process.cwd(), args.manifestPath)}`,
  `allowlist:  ${path.relative(process.cwd(), args.allowlistPath)} (${selection.attested.length} attested)`,
  `selected:   ${selectedSongs.length} of ${manifest.totals.songs} songs` +
    (args.sources.length ? ` (corpora: ${args.sources.join(", ")})` : ""),
  `licences:   ${Object.entries(counts).map(([licence, n]) => `${licence}: ${n}`).join(", ") || "(none)"}`,
  `excluded:   ${selection.excluded.length}`,
  `output:     ${path.relative(process.cwd(), out)}`,
];

if (selectedSongs.length === 0) {
  console.log(summary.join("\n"));
  console.log(
    "\nNothing to pack: no catalogue song is cleared for redistribution.\n" +
      "That is the expected result for a research library — ship the app empty and let users import their own songs, " +
      "or add cleared songs to scripts/catalog/starter-allowlist.json.",
  );
  console.log(
    "\nFor an early test build only:  npm run catalog:pack:starter -- --profile internal --acknowledge-restricted",
  );
  process.exit(0);
}

if (args.dry) {
  console.log(summary.join("\n"));
  console.log(
    selection.distributable
      ? "\n(dry run — nothing written)"
      : "\n!! INTERNAL BUILD — contains restricted material. DO NOT DISTRIBUTE. (dry run, nothing written)",
  );
  process.exit(0);
}

if (fs.existsSync(out) && !args.force) {
  console.error(`${out} already exists — pass --force to replace it.`);
  process.exit(1);
}
if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const entry of located) {
  fs.copyFileSync(entry.filePath, path.join(out, entry.song.file));
}

const internal = !selection.distributable;

const packed = {
  format: 1,
  distribution: internal ? "internal-test-only" : "release",
  notForDistribution: internal,
  profile: selection.profile,
  generatedAt: new Date().toISOString(),
  sourceManifest: {
    generatedAt: manifest.generatedAt,
    gitSha: manifest.gitSha,
    songs: manifest.totals.songs,
  },
  policy: {
    rule:
      selection.profile === "internal"
        ? "internal test build — ALL catalogue material, not cleared for redistribution"
        : 'ships only when licence class is "cleared", or the song is listed in the allowlist with "attested": true',
    attested: selection.attested,
    excluded: selection.excluded.length,
    licences: counts,
  },
  songs: selectedSongs.map((song) => ({
    songId: song.songId,
    file: song.file,
    title: song.title,
    artist: song.artist,
    sha256: song.sha256,
    source: song.source,
    licence: song.licence,
    licenceNote: song.licenceNote,
    redistributable: song.redistributable,
    attested: selection.attested.includes(song.songId),
  })),
};
fs.writeFileSync(path.join(out, "MANIFEST.json"), `${JSON.stringify(packed, null, 2)}\n`);

const noticeLines = internal
  ? [
      "!! INTERNAL TEST BUILD — NOT FOR DISTRIBUTION !!",
      "================================================",
      "",
      "This pack contains copyrighted chart transcriptions and lyrics drawn from",
      "third-party corpora. It exists so early builds can be exercised against real",
      "material. Do not publish it, hand it to anyone outside the project, or attach",
      "it to a release.",
      "",
      `Profile: ${selection.profile}`,
      `Built:   ${packed.generatedAt}`,
      `From manifest of ${manifest.generatedAt} (git ${manifest.gitSha ?? "unknown"})`,
      "",
      `Licences in this pack: ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(", ")}`,
      "",
      `A release pack built from the same library would contain ${
        manifest.songs.filter((song) => song.redistributable).length
      } song(s).`,
      "",
      "See MANIFEST.json for per-file hashes.",
      "",
    ]
  : [
      "TrackDraft — starter song pack",
      "=============================",
      "",
      `Built ${packed.generatedAt} from catalogue manifest of ${manifest.generatedAt} (git ${manifest.gitSha ?? "unknown"}).`,
      "",
      "Included songs and their terms:",
      ...selectedSongs.map(
        (song) =>
          `  • ${song.title}${song.artist ? ` — ${song.artist}` : ""}\n    ${song.licence}: ${song.licenceNote}`,
      ),
      "",
      `${selection.excluded.length} songs from the working library were NOT included.`,
      "See MANIFEST.json for per-file hashes.",
      "",
    ];
fs.writeFileSync(path.join(out, "README.txt"), noticeLines.join("\n"));

if (internal) {
  fs.writeFileSync(
    path.join(out, "DO-NOT-DISTRIBUTE.txt"),
    [
      "INTERNAL TEST BUILD — NOT FOR DISTRIBUTION",
      "",
      `Profile : ${selection.profile}`,
      `Songs   : ${selectedSongs.length}`,
      `Built   : ${packed.generatedAt}`,
      "",
      "Contains copyrighted chart transcriptions and lyrics from third-party",
      "corpora (see MANIFEST.json → songs[].licence / licenceNote).",
      "Keep this inside the project. Never ship it, publish it, or attach it to a",
      "release. The release path is:",
      "",
      "  npm run catalog:manifest && npm run catalog:pack:starter",
      "",
    ].join("\n"),
  );
}

console.log(summary.join("\n"));
console.log(`wrote ${selectedSongs.length} song(s) + MANIFEST.json + README.txt`);
if (internal) {
  console.log("");
  console.log("!! INTERNAL BUILD — contains restricted material. DO NOT DISTRIBUTE. !!");
  console.log(`!! ${path.relative(process.cwd(), out)} is stamped DO-NOT-DISTRIBUTE.txt`);
}
