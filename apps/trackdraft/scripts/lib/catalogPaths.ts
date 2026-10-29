/**
 * Every external corpus root and output directory the catalog pipeline reads
 * or writes — in ONE place, resolved from the environment.
 *
 * Why: the ingest scripts each hard-coded `/Users/Matthew/...`. That made the
 * catalog reproducible on exactly one machine, which is the wrong property for
 * an artifact that has to be rebuilt (and licence-audited) on demand. Every
 * root is now `ENV_VAR` first; the historical path survives only as a
 * fallback that is used when it actually exists, and says so out loud, so an
 * existing workflow keeps working while a fresh clone gets an actionable error
 * instead of an empty catalog.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** `apps/trackdraft` — scripts live in `scripts/`, outputs in `scripts/output`. */
export const APP_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SCRIPTS_DIR = path.join(APP_ROOT, "scripts");
export const OUTPUT_DIR = path.join(SCRIPTS_DIR, "output");

export type RootKey =
  | "beatlesChords"
  | "beatlesLyrics"
  | "beatlesAudio"
  | "mcgill"
  | "rockCorpus"
  | "laloChezia";

interface RootSpec {
  key: RootKey;
  envVar: string;
  /** What lives here, for the error message. */
  label: string;
  /** Where it has always been — a fallback, not a default. */
  legacy: string;
}

const ROOTS: RootSpec[] = [
  {
    key: "beatlesChords",
    envVar: "BEATLES_CHORDS_DIR",
    label: "Beatles chord charts (.jcrd.json)",
    legacy: "/Users/Matthew/beatles data/Beatles-Chords",
  },
  {
    key: "beatlesLyrics",
    envVar: "BEATLES_LYRICS_DIR",
    label: "Beatles lyrics cache (LRCLIB output)",
    legacy: "/Users/Matthew/beatles data/lyrics_from_lrclib",
  },
  {
    key: "beatlesAudio",
    envVar: "BEATLES_AUDIO_DIR",
    label: "Beatles audio archive (stem analysis input)",
    legacy: "/Users/Matthew/beatles data/audio",
  },
  {
    key: "mcgill",
    envVar: "MCGILL_ROOT",
    label: "McGill Billboard jcrd + SALAMI corpus",
    legacy: "/Users/Matthew/mcgill_jcrd_salami_Billboard",
  },
  {
    key: "rockCorpus",
    envVar: "ROCK_CORPUS_ROOT",
    label: "Rock Corpus TDC",
    legacy: "/Users/Matthew/Rock Corpus-TDC",
  },
  {
    key: "laloChezia",
    envVar: "LALO_CHEZIA_ROOT",
    label: "Lalo Chezia source material",
    legacy: "/Users/Matthew/lalo-chezia/lalo-chezia/docs/source_material/songs",
  },
];

export interface ResolvedRoot {
  key: RootKey;
  envVar: string;
  label: string;
  /** The path that will be used, or null when nothing could be resolved. */
  path: string | null;
  /** True when this came from the legacy fallback rather than the env var. */
  legacy: boolean;
}

const warned = new Set<RootKey>();

/**
 * Resolve one corpus root. Never throws — inspect `.path` (null = missing).
 * `warn` is on by default so a fallback use is visible in the run log; pass
 * `false` for one-off probing.
 */
export function resolveRoot(key: RootKey, warn = true): ResolvedRoot {
  const spec = ROOTS.find((entry) => entry.key === key);
  if (!spec) throw new Error(`Unknown catalogue root "${key}"`);

  const fromEnv = process.env[spec.envVar];
  if (fromEnv && fromEnv.trim() !== "") {
    return { key, envVar: spec.envVar, label: spec.label, path: path.resolve(fromEnv), legacy: false };
  }

  const legacyExists = fs.existsSync(spec.legacy);
  if (legacyExists && warn && !warned.has(key)) {
    warned.add(key);
    console.warn(
      `[catalog] ${spec.envVar} is not set — falling back to the historical path ${spec.legacy}. ` +
        `Set ${spec.envVar} to make this run reproducible on another machine.`,
    );
  }
  return {
    key,
    envVar: spec.envVar,
    label: spec.label,
    path: legacyExists ? spec.legacy : null,
    legacy: legacyExists,
  };
}

/** Resolve and throw with instructions when the corpus is not available. */
export function requireRoot(key: RootKey): string {
  const resolved = resolveRoot(key);
  if (resolved.path) return resolved.path;
  const spec = ROOTS.find((entry) => entry.key === key)!;
  throw new Error(
    [
      `Missing corpus: ${resolved.label}`,
      `  set ${resolved.envVar}=/path/to/corpus`,
      `  (no ${resolved.envVar} was set, and the historical path ${spec.legacy} does not exist)`,
    ].join("\n"),
  );
}

/** Where each ingest writes by default. The per-corpus dirs stay separate by
 *  design: a merged directory loses the ability to tell a Beatles chart from
 *  a McGill one, which is exactly the provenance the manifest must preserve. */
export const OUTPUT_DIRS = {
  beatles: process.env.BEATLES_OUTPUT_DIR ?? path.join(OUTPUT_DIR, "catalog"),
  mcgill: process.env.MCGILL_OUTPUT_DIR ?? path.join(OUTPUT_DIR, "mcgill-catalog"),
  rock: process.env.ROCK_CORPUS_OUTPUT_DIR ?? path.join(OUTPUT_DIR, "rock-catalog"),
  /** `ingest-lalo-chezia` writes loose files straight into `scripts/output/`. */
  lalo: process.env.LALO_OUTPUT_DIR ?? OUTPUT_DIR,
} as const;

/** Every directory the manifest and packaging steps look at, by default. */
export const DEFAULT_CATALOG_DIRS = [
  OUTPUT_DIRS.beatles,
  OUTPUT_DIRS.mcgill,
  OUTPUT_DIRS.rock,
  OUTPUT_DIRS.lalo,
];

export const AUDIT_PATH = path.join(OUTPUT_DIR, "catalog-audit.json");
export const MANIFEST_PATH = path.join(OUTPUT_DIR, "catalog.manifest.json");
export const STARTER_ALLOWLIST_PATH = path.join(SCRIPTS_DIR, "catalog", "starter-allowlist.json");
