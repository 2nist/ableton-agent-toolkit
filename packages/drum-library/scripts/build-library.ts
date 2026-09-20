/**
 * Build the groove index from E-GMD.
 *
 * Defaults to a small subset: this corpus has already been silently
 * corrupted once by a pipeline that reported itself clean, so the intended
 * workflow is to extract a handful of takes, look at the actual grooves, and
 * only then commit to a full 45k-file pass.
 *
 * Run:
 *   npx tsx scripts/build-library.ts --limit 200
 *   npx tsx scripts/build-library.ts --all --out dist-data
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createGzip } from "node:zlib";
import { parseCatalog, type CatalogEntry } from "../src/catalog.js";
import { loadTake, validateTake, takeLengthBeats, type TakeProblem } from "../src/take.js";
import { segmentTake } from "../src/segment.js";
import type { Segment } from "../src/types.js";

const EGMD_ROOT =
  process.env.EGMD_ROOT ??
  "/Users/Matthew/Datasets/e-gmd-v1.0.0";

interface Args {
  limit: number | null;
  out: string;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 200, out: path.join(import.meta.dirname, "..", "data"), seed: 7 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") args.limit = null;
    else if (argv[i] === "--limit") args.limit = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--seed") args.seed = Number.parseInt(argv[++i], 10);
  }
  return args;
}

/** Deterministic PRNG so a subset run is reproducible and reviewable. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample across the corpus rather than taking the first N, which would be
 * one drummer in one session at one tempo — and would make any subset run
 * useless as a check on whether the extractor handles the corpus at large.
 */
function sample<T>(items: T[], count: number, seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/**
 * Reservoir sample (Algorithm R) of segments for the summary report only.
 * A full corpus run produces millions of `Segment` objects — holding them
 * all in memory just to print percentiles is what caused an actual
 * out-of-memory crash on the first full run. Segments are streamed to disk
 * as they're produced (see `main`); this reservoir is a separate, capped,
 * unordered subset used only for the diagnostic numbers below, and the
 * report says so rather than implying they're exact.
 */
const RESERVOIR_CAP = 300_000;

class Reservoir<T> {
  private items: T[] = [];
  private seen = 0;

  add(item: T): void {
    this.seen++;
    if (this.items.length < RESERVOIR_CAP) {
      this.items.push(item);
      return;
    }
    const j = Math.floor(Math.random() * this.seen);
    if (j < RESERVOIR_CAP) this.items[j] = item;
  }

  get sampled(): T[] {
    return this.items;
  }

  get totalSeen(): number {
    return this.seen;
  }
}

/**
 * Batched, backpressure-aware NDJSON writer.
 *
 * The first version of this streaming rewrite called `stream.write()` once
 * per segment and never checked its return value. That still crashed a full
 * run — RSS climbed to 3.6GB in under 4 minutes — because `write()` returns
 * `false` when Node's internal buffer is full, and ignoring that just moves
 * the unbounded accumulation from "one big array" to "one big internal
 * buffer": disk throughput for millions of tiny writes can't keep up with
 * generation, so the buffer grows without limit either way. Batching lines
 * into fixed-size chunks bounds memory on the write side, and awaiting
 * `'drain'` when the OS-level buffer is full bounds it on the flush side.
 */
class NdjsonWriter {
  private readonly stream: NodeJS.WritableStream;
  private readonly fileStream: fs.WriteStream;
  private readonly flushEvery: number;
  private buffer: string[] = [];

  constructor(filePath: string, flushEvery = 5000) {
    this.fileStream = fs.createWriteStream(filePath);
    if (filePath.endsWith(".gz")) {
      // A full-corpus run writes ~4.3 GB raw — gzip keeps it under ~1 GB,
      // which matters on a machine whose disk is already 98% full. Writes
      // (and their backpressure) go through the gzip stream; `close`
      // additionally waits for the underlying file to finish flushing.
      const gzip = createGzip();
      gzip.pipe(this.fileStream);
      this.stream = gzip;
    } else {
      this.stream = this.fileStream;
    }
    this.flushEvery = flushEvery;
  }

  async write(record: unknown): Promise<void> {
    this.buffer.push(JSON.stringify(record));
    if (this.buffer.length >= this.flushEvery) await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join("\n") + "\n";
    this.buffer = [];
    if (!this.stream.write(chunk)) {
      await new Promise<void>((resolve) => this.stream.once("drain", resolve));
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await new Promise<void>((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(() => resolve());
    });
    if (this.stream !== this.fileStream) {
      await new Promise<void>((resolve, reject) => {
        this.fileStream.once("finish", () => resolve());
        this.fileStream.once("error", reject);
      });
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const csvPath = path.join(EGMD_ROOT, "e-gmd-v1.0.0.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`E-GMD catalog not found at ${csvPath}\nSet EGMD_ROOT to the dataset directory.`);
    process.exit(1);
  }

  const catalog = parseCatalog(fs.readFileSync(csvPath, "utf8"));
  const selected = args.limit === null ? catalog : sample(catalog, args.limit, args.seed);
  console.log(`catalog: ${catalog.length} takes | extracting: ${selected.length}`);

  fs.mkdirSync(args.out, { recursive: true });
  const segmentsWriter = new NdjsonWriter(path.join(args.out, "segments.ndjson.gz"));

  const problems: TakeProblem[] = [];
  const takeIndex: Record<string, TakeSummary> = {};
  const reservoir = new Reservoir<Segment>();
  const byLimb: Record<string, number> = {};
  let missing = 0;
  let unreadable = 0;

  for (const entry of selected) {
    const midiPath = path.join(EGMD_ROOT, entry.midiFilename);
    if (!fs.existsSync(midiPath)) {
      missing++;
      continue;
    }

    let take;
    try {
      take = loadTake(new Uint8Array(fs.readFileSync(midiPath)), entry);
    } catch (error) {
      unreadable++;
      problems.push({ takeId: entry.midiFilename, problem: `unreadable: ${(error as Error).message}` });
      continue;
    }

    const takeProblems = validateTake(take);
    if (takeProblems.length > 0) {
      problems.push(...takeProblems);
      // A take that fails timing validation is excluded rather than indexed
      // with a warning — bad timing is exactly what shipped last time.
      continue;
    }

    // Written and sampled per-take, immediately — never accumulated into one
    // array for the whole corpus. That array (millions of Segment objects,
    // each carrying a full FeelFeatures record) is exactly what exhausted
    // the heap on the first attempt at a full run.
    for (const segment of segmentTake(take)) {
      await segmentsWriter.write(segment);
      reservoir.add(segment);
      byLimb[segment.limb] = (byLimb[segment.limb] ?? 0) + 1;
    }

    takeIndex[take.id] = {
      drummer: take.drummer,
      style: take.style,
      bpm: take.bpm,
      beatType: take.beatType,
      timeSignature: `${take.timeSignature.numerator}-${take.timeSignature.denominator}`,
      kitName: take.kitName,
      beatsPerBar: take.beatsPerBar,
      lengthBeats: Number(takeLengthBeats(take).toFixed(3)),
      noteCount: take.notes.length,
    };
  }

  fs.writeFileSync(path.join(args.out, "takes.json"), JSON.stringify(takeIndex, null, 2));
  fs.writeFileSync(path.join(args.out, "problems.json"), JSON.stringify(problems, null, 2));
  await segmentsWriter.close();

  report(selected.length, Object.keys(takeIndex).length, reservoir, byLimb, problems, missing, unreadable, args.out);
}

interface TakeSummary {
  drummer: string;
  style: string;
  bpm: number;
  beatType: string;
  timeSignature: string;
  kitName: string;
  beatsPerBar: number;
  lengthBeats: number;
  noteCount: number;
}

function report(
  attempted: number,
  indexed: number,
  reservoir: Reservoir<Segment>,
  byLimb: Record<string, number>,
  problems: TakeProblem[],
  missing: number,
  unreadable: number,
  out: string,
): void {
  console.log(`\ntakes indexed:   ${indexed}/${attempted}`);
  if (missing) console.log(`  missing files: ${missing}`);
  if (unreadable) console.log(`  unreadable:    ${unreadable}`);
  console.log(`  rejected:      ${problems.length} (see problems.json)`);
  console.log(`segments:        ${reservoir.totalSeen}`);
  console.log(`  by limb:       ${JSON.stringify(byLimb)}`);

  const sample = reservoir.sampled;
  const sampledNote =
    reservoir.totalSeen > sample.length ? ` (sampled ${sample.length} of ${reservoir.totalSeen})` : "";

  // Report the dedup rate rather than assuming it. The figure quoted for the
  // previous library (96%) was an artefact of its broken timing collapsing
  // distinct patterns onto each other; measured on real performances it is
  // far lower, and it is the number that decides whether the index can ship
  // to a browser at all.
  const rhythmKeys = new Set(sample.map((segment) => segment.rhythmKey));
  if (sample.length > 0) {
    const dedup = 100 * (1 - rhythmKeys.size / sample.length);
    console.log(`  unique rhythms: ${rhythmKeys.size} (${dedup.toFixed(1)}% dedup at the 16th grid)${sampledNote}`);
  }

  for (const axis of ["push", "looseness", "density", "swing", "syncopation"] as const) {
    const values = sample.map((segment) => segment.features[axis]).sort((a, b) => a - b);
    if (values.length === 0) continue;
    const at = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
    console.log(
      `  ${axis.padEnd(12)} p10 ${at(0.1).toFixed(3)}  median ${at(0.5).toFixed(3)}  p90 ${at(0.9).toFixed(3)}${sampledNote}`,
    );
  }

  console.log(`\nwrote ${out}/takes.json, segments.ndjson.gz, problems.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
