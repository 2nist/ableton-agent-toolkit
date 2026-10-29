#!/usr/bin/env tsx
/**
 * Build `scripts/output/catalog.manifest.json` — one record per catalogue song
 * with its corpus, licence class, content hash and rebuild instructions, plus
 * the resolved corpus roots this run actually read from.
 *
 * This is the reproducibility + compliance artifact: it is what lets the
 * shipped library be rebuilt on demand, and what proves which songs may not
 * leave this machine. `pack-starter-catalog.ts` reads it to decide what ships.
 *
 * Usage:
 *   npm run catalog:manifest
 *   tsx scripts/build-catalog-manifest.ts --dir scripts/output/mcgill-catalog
 *   tsx scripts/build-catalog-manifest.ts --audit <none> --out /tmp/m.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AUDIT_PATH, DEFAULT_CATALOG_DIRS, MANIFEST_PATH } from "./lib/catalogPaths";
import { buildManifest, formatManifestSummary } from "./catalog/manifest";

interface Args {
  dirs: string[];
  auditPath: string | null;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dirs: [], auditPath: AUDIT_PATH, out: MANIFEST_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--dir":
        args.dirs.push(path.resolve(argv[++i]));
        break;
      case "--audit": {
        const value = argv[++i];
        args.auditPath = !value || value === "none" ? null : path.resolve(value);
        break;
      }
      case "--out":
        args.out = path.resolve(argv[++i]);
        break;
      case "--help":
      case "-h":
        console.log("usage: build-catalog-manifest [--dir <path>]... [--audit <path|none>] [--out <path>]");
        process.exit(0);
        break;
      default:
        if (argv[i]?.startsWith("--")) throw new Error(`Unknown flag: ${argv[i]}`);
    }
  }
  if (args.dirs.length === 0) args.dirs = DEFAULT_CATALOG_DIRS;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const present = args.dirs.filter((dir) => fs.existsSync(dir));

if (present.length === 0) {
  console.error(
    [
      "No catalogue directories found. Expected at least one of:",
      ...args.dirs.map((dir) => `  ${dir}`),
      "",
      "Run an ingest first (see scripts/README.md), or pass --dir <path>.",
    ].join("\n"),
  );
  process.exit(1);
}

for (const dir of args.dirs.filter((dir) => !fs.existsSync(dir))) {
  console.warn(`[manifest] skipping missing directory: ${dir}`);
}

const manifest = buildManifest({ dirs: present, auditPath: args.auditPath });

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(formatManifestSummary(manifest));

/* Say which corpora were reached through the legacy path: a manifest built
 * from unset environment variables is reproducible on THIS machine only, and
 * that is worth one line per corpus rather than a buried field. */
const legacyRoots = manifest.roots.filter((root) => root.legacy);
if (legacyRoots.length > 0) {
  console.log("");
  for (const root of legacyRoots) {
    console.log(`note: ${root.envVar} unset — read from the historical path (${root.label})`);
  }
  console.log("      set these to rebuild this library on another machine.");
}

console.log("");
console.log(`wrote ${path.relative(process.cwd(), args.out)}`);
if (manifest.totals.unreadable > 0) {
  console.warn(
    `[manifest] ${manifest.totals.unreadable} file(s) could not be parsed — they are excluded from the manifest and cannot ship.`,
  );
}
/* The manifest lives next to the catalogues it describes; keep the audit close
 * by so a reader can see the quality gate that produced `quality` scores. */
if (args.auditPath && !fs.existsSync(args.auditPath)) {
  console.warn(`[manifest] no audit report at ${args.auditPath} — quality scores omitted (run npm run catalog:audit)`);
}
