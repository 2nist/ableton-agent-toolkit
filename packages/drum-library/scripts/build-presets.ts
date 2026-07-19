/**
 * Curate a small, self-contained groove asset for `trackdraft-bridge` from
 * a full extraction (`npm run extract -- --all`).
 *
 * The extension can't carry the corpus around — even the trimmed index is
 * tens of thousands of segments — and it has no business resolving segments
 * or scoring feel at runtime. So this does that work once, offline, and
 * bakes the result down to what the extension actually needs: for each
 * `DrumPattern` preset, a handful of ready-to-play, Ableton-safe note lists.
 * `drumClips.ts` picks one deterministically per section and tiles it.
 *
 * Run after `npm run extract -- --all`:
 *   npx tsx scripts/build-presets.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { buildIndex } from "../src/library-index.js";
import { PRESETS, type DrumPattern } from "../src/presets.js";
import { selectGroove } from "../src/select.js";
import { grooveLengthBeats, resolveGrooveNotes } from "../src/resolve.js";
import { foldForAbleton } from "../src/ableton.js";
import { parseCatalog } from "../src/catalog.js";
import { loadTake } from "../src/take.js";
import type { PackedNote, PackedPreset } from "../src/presetData.js";
import type { Segment, Take } from "../src/types.js";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");
// Under src/, not data/: data/ is gitignored (it's regenerable from E-GMD,
// which isn't checked in either), but this curated output is small — tens
// of KB — and needs to survive a fresh clone so trackdraft-bridge can import
// it without anyone re-running the extraction pipeline first.
const OUT_PATH = path.join(import.meta.dirname, "..", "src", "presets-data.json");

/** Variants per preset. Several rather than one, so sections sharing a preset don't play the identical groove — the same reason `selectGroove` takes a seed at all. */
const VARIANTS_PER_PRESET = 16;

/**
 * Candidate pool size passed to `selectGroove`, kept independent of
 * `VARIANTS_PER_PRESET`. A first run tied these together (`poolSize:
 * VARIANTS_PER_PRESET`) and several presets came back with far fewer
 * variants than requested — `driving` collapsed to a single variant out of
 * 10 attempts — because 10 seeds picking from a pool of only 10 candidates
 * (per limb, further narrowed by the offset-by-limb-index spread in
 * `selectGroove`) collide often. A larger, decoupled pool gives each seed
 * more room to land somewhere genuinely different.
 */
const POOL_SIZE = 40;

async function main(): Promise<void> {
  const takesPath = path.join(DATA_DIR, "takes.json");
  const segmentsPath = path.join(DATA_DIR, "segments.ndjson");
  if (!fs.existsSync(takesPath) || !fs.existsSync(segmentsPath)) {
    console.error(`Missing ${takesPath} or ${segmentsPath}. Run 'npm run extract -- --all' first.`);
    process.exit(1);
  }

  const takeSummaries = JSON.parse(fs.readFileSync(takesPath, "utf8"));
  const segments = await readNdjson<Segment>(segmentsPath);

  // build-library.ts writes takes as a summary map (no notes), not a `Take[]`
  // — reload the actual notes from the raw MIDI is unnecessary here because
  // `resolveSegment` only needs positions, and the summaries don't carry
  // them. So this script re-derives full `Take` objects the same way
  // build-library.ts does, by re-reading the source MIDI for every take that
  // has at least one surviving segment.
  console.log(`read ${segments.length} segments, resolving takes...`);
  const neededTakeIds = new Set(segments.map((s) => s.takeId));
  const takes = loadFullTakes(neededTakeIds, takeSummaries);
  console.log(`loaded ${takes.length} takes, selecting variants per preset...`);

  const index = buildIndex(takes, segments);
  const output: Partial<Record<DrumPattern, PackedPreset>> = {};

  for (const pattern of Object.keys(PRESETS) as DrumPattern[]) {
    if (!PRESETS[pattern]) continue; // 'none' and '78' — see presets.ts
    const started = Date.now();

    const variants: PackedNote[][] = [];
    const seen = new Set<string>();
    let lengthBeats = 0;

    for (let i = 0; i < VARIANTS_PER_PRESET; i++) {
      const spec = selectGroove(index, pattern, { seed: `${pattern}:${i}`, poolSize: POOL_SIZE });
      if (!spec) continue;

      const resolved = resolveGrooveNotes(index, spec);
      const folded = foldForAbleton(resolved);
      if (folded.notes.length === 0) continue;

      const packed: PackedNote[] = folded.notes.map((n) => [round4(n.beat), n.pitch, n.velocity]);
      const key = JSON.stringify(packed);
      if (seen.has(key)) continue; // small pools can repeat; keep variants distinct
      seen.add(key);

      lengthBeats = grooveLengthBeats(index, spec);
      variants.push(packed);
    }

    if (variants.length > 0) output[pattern] = { lengthBeats, variants };
    console.log(`  ${pattern}: ${variants.length} variants (${Date.now() - started}ms)`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(output));
  report(output);
  console.log(`\nwrote ${OUT_PATH}`);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Read newline-delimited JSON line by line rather than one
 * `readFileSync(...).split("\n")` call. A full corpus's `segments.ndjson`
 * can approach the size where reading it as a single string risks the same
 * V8 string-length ceiling that broke the write side; streaming avoids ever
 * materialising the whole file as one string, at the cost of holding only
 * the parsed objects (much smaller than their JSON text) in memory.
 */
async function readNdjson<T>(filePath: string): Promise<T[]> {
  const records: T[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > 0) records.push(JSON.parse(line));
  }
  return records;
}

function loadFullTakes(ids: Set<string>, _summaries: unknown): Take[] {
  // Re-parses just the takes that survived segmentation and are actually
  // referenced, rather than the full 45k — this script only needs to run
  // once per extraction, so simplicity wins over speed here.
  const EGMD_ROOT =
    process.env.EGMD_ROOT ??
    "/Users/Matthew/Datasets/e-gmd-v1.0.0";

  const catalog = parseCatalog(fs.readFileSync(path.join(EGMD_ROOT, "e-gmd-v1.0.0.csv"), "utf8"));
  const byFilename = new Map(catalog.map((entry) => [entry.midiFilename, entry]));

  const takes: Take[] = [];
  for (const id of ids) {
    const entry = byFilename.get(id);
    if (!entry) continue;
    const midiPath = path.join(EGMD_ROOT, entry.midiFilename);
    if (!fs.existsSync(midiPath)) continue;
    takes.push(loadTake(new Uint8Array(fs.readFileSync(midiPath)), entry));
  }
  return takes;
}

function report(output: Partial<Record<DrumPattern, PackedPreset>>): void {
  console.log("preset            variants  notes/variant  beats");
  for (const [pattern, packed] of Object.entries(output)) {
    const avgNotes = Math.round(
      packed.variants.reduce((sum, v) => sum + v.length, 0) / packed.variants.length,
    );
    console.log(`  ${pattern.padEnd(15)} ${String(packed.variants.length).padStart(3)}       ${String(avgNotes).padStart(6)}         ${packed.lengthBeats}`);
  }
  for (const pattern of Object.keys(PRESETS) as DrumPattern[]) {
    if (PRESETS[pattern] && !output[pattern]) {
      console.log(`  ! ${pattern}: no variants produced — corpus has no matching material`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
