#!/usr/bin/env tsx
/**
 * Copy a catalogue pack into `dist/` so a build can open with songs in it.
 *
 * The Electron main process seeds the on-disk library from `dist/catalog` on
 * first run (see `electron/main.cjs` → `seedLibraryIfEmpty`). This script is
 * the only thing that puts files there, so "does this build ship songs?" is a
 * one-line answer in the build script rather than a mystery.
 *
 * It refuses to bundle a pack whose MANIFEST says it is an internal test pack
 * unless `--allow-internal` is passed — the pack itself is stamped, but an
 * accidental `bundle-catalog` in a release build should fail loudly instead of
 * quietly shipping 182 copyrighted charts.
 *
 * Usage:
 *   tsx scripts/bundle-catalog.ts --from scripts/output/catalog-internal --allow-internal
 *   tsx scripts/bundle-catalog.ts --from scripts/output/catalog-starter
 *   tsx scripts/bundle-catalog.ts --clear
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { APP_ROOT } from "./lib/catalogPaths";

const DIST = path.join(APP_ROOT, "dist");
const TARGET = path.join(DIST, "catalog");

interface Args {
  from: string | null;
  allowInternal: boolean;
  clear: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: null, allowInternal: false, clear: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--from":
        args.from = path.resolve(argv[++i]);
        break;
      case "--allow-internal":
        args.allowInternal = true;
        break;
      case "--clear":
        args.clear = true;
        break;
      case "--help":
      case "-h":
        console.log("usage: bundle-catalog --from <packDir> [--allow-internal] | --clear");
        process.exit(0);
        break;
      default:
        if (argv[i]?.startsWith("--")) throw new Error(`Unknown flag: ${argv[i]}`);
    }
  }
  return args;
}

function clearTarget(): void {
  if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
}

const args = parseArgs(process.argv.slice(2));

if (args.clear) {
  clearTarget();
  console.log(`cleared ${path.relative(APP_ROOT, TARGET)}`);
  process.exit(0);
}

if (!args.from) {
  console.error("bundle-catalog needs --from <packDir> (or --clear).");
  process.exit(1);
}
if (!fs.existsSync(args.from)) {
  console.error(`No pack at ${args.from}. Build one first:\n  npm run catalog:pack:starter -- --profile internal --acknowledge-restricted`);
  process.exit(1);
}
if (!fs.existsSync(DIST)) {
  console.error(`No dist/ at ${DIST}. Run "npm run build" first — this script copies INTO the built app.`);
  process.exit(1);
}

const manifestPath = path.join(args.from, "MANIFEST.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`${args.from} has no MANIFEST.json — refusing to bundle an unattributed pack.`);
  process.exit(1);
}

const pack = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  distribution?: string;
  notForDistribution?: boolean;
  songs?: { songId: string }[];
};
const distribution = pack.distribution ?? "unknown";

if (pack.notForDistribution === true && !args.allowInternal) {
  console.error(
    [
      `Refusing to bundle an internal test pack (${distribution}) into dist/.`,
      "",
      "This pack contains copyrighted chart transcriptions and lyrics. It is for",
      "local test builds only — pass --allow-internal if that is what you are",
      "deliberately doing, and do not distribute the result.",
    ].join("\n"),
  );
  process.exit(1);
}

clearTarget();
fs.mkdirSync(TARGET, { recursive: true });

/**
 * The audio-transcribed drum blocks are DROPPED here.
 *
 * `scripts/batch-fix-drums.ts` transcribed a demucs drum stem per song and
 * wrote the result into every section as `drumBlocks`. Those blocks REPLACE the
 * lane's content across their range (`applyDrumBlocks`), so a transcription
 * that found two kicks in four bars deleted the groove underneath and left the
 * plate nearly empty — and it did so for every catalogue song at once. The
 * curated pattern pool is what a section should fall back to; a transcription
 * that sparse is not a performance worth keeping.
 *
 * Stripping happens at the last gate before shipping so the source catalogue
 * stays a faithful record of what the analysis produced.
 */
let copied = 0;
let strippedBlocks = 0;
let strippedSections = 0;
for (const file of fs.readdirSync(args.from)) {
  if (!file.endsWith(".trackdraft.json")) continue;
  const from = path.join(args.from, file);
  const to = path.join(TARGET, file);
  const raw = fs.readFileSync(from, "utf8");
  type SongShape = { sections?: { drumBlocks?: unknown[] }[] } & Record<string, unknown>;
  let parsed: ({ song?: SongShape } & SongShape) | null = null;
  try {
    parsed = JSON.parse(raw) as { song?: SongShape } & SongShape;
  } catch {
    fs.copyFileSync(from, to);
    copied += 1;
    continue;
  }
  const song = (parsed.song ?? parsed) as SongShape;
  for (const section of song.sections ?? []) {
    const blocks = section.drumBlocks;
    if (Array.isArray(blocks) && blocks.length > 0) {
      strippedBlocks += blocks.length;
      strippedSections += 1;
      delete section.drumBlocks;
    }
  }
  // Keep the file's own shape ({song:{…}} or flat) — only the blocks change.
  fs.writeFileSync(to, `${JSON.stringify(parsed, null, 2)}\n`);
  copied += 1;
}
for (const meta of ["MANIFEST.json", "DO-NOT-DISTRIBUTE.txt", "README.txt"]) {
  const from = path.join(args.from, meta);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(TARGET, meta));
}

console.log(
  `bundled ${copied} song(s) from ${path.relative(APP_ROOT, args.from)} → ${path.relative(APP_ROOT, TARGET)}`,
);
if (strippedBlocks > 0) {
  console.log(
    `dropped ${strippedBlocks} audio-transcribed drum block(s) across ${strippedSections} section(s) — sections fall back to the curated pattern pool`,
  );
}
console.log(`distribution: ${distribution}${pack.notForDistribution ? "  ← NOT FOR DISTRIBUTION" : ""}`);
if (pack.notForDistribution) {
  console.log("First run will seed these into the library. Do not distribute this build.");
}
