/**
 * Tegridy times-chords-drums miner — scan the 45,778-song corpus for drum
 * grooves. This is the material the E-GMD bake cannot give us: broad
 * pop/rock/punk patterns from actual songs, anonymized (md5-keyed) and
 * Apache-2.0 clean.
 *
 * Corpus format (per the dataset's own README, verified against the data):
 *   each line = [md5, events]; each event = [deltas, chordTones, drumPitches]
 *   - deltas are in 16th-note STEPS (measured: mode 7 / 14 with 3s and 6s,
 *     chord events ~1-2 per bar, songs resolve to ~100-140 bars — the
 *     README's separate TMIDIX tick math is for its MIDI writer, not this
 *     scan)
 *   - chordTones = semitone offsets from C4 (60 + t)
 *   - drumPitches = GM drum notes (channel 9), velocity is implicit (110)
 *
 * What this script does: decode a song, quantize the drum hits to the 16th
 * grid, group them into bars, and extract the song's DOMINANT bar groove
 * (the bar mask that repeats most — a groove is repetition). Songs whose
 * dominant groove repeats at least `--min-repeat` times with at least two
 * hits qualify. Output: a scan report + a pool JSON of unique groove
 * signatures with their song counts — the curation input for a future
 * audition/bake step (same pipeline shape as zappa-scan → zappa-audition).
 *
 * Run from packages/drum-library:
 *   npx tsx scripts/tegridy-scan.ts [--limit N] [--out file] [--min-repeat N]
 *
 * Env: TEGRIDY_FILE overrides the corpus path.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { DRUM_LANE_VOICES, type DrumLaneId } from "../src/blocks.js";
import { voiceOf } from "../src/kit.js";

const DEFAULT_FILE =
  process.env.TEGRIDY_FILE ??
  "/Users/Matthew/Datasets/Tegridy-MIDI-Dataset-master/Chords-Progressions/times_chords_drums.jsonl";

let STEPS_PER_BAR = 16; // 4/4 bars on the 16th grid — --bar-steps calibrates the corpus's inner grid

/** GM voice → lane family — same inverse the timeline view uses. */
const VOICE_TO_LANE = new Map<string, DrumLaneId>();
for (const [lane, voices] of Object.entries(DRUM_LANE_VOICES)) {
  for (const v of voices) VOICE_TO_LANE.set(v, lane as DrumLaneId);
}

interface Args {
  limit: number;
  out: string;
  minRepeat: number;
  barSteps: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 2000,
    out: path.join(os.homedir(), "trackdraft-import-cache", "tegridy-scan.json"),
    minRepeat: 4,
    barSteps: 16,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") args.limit = Infinity;
    else if (argv[i] === "--limit") args.limit = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--min-repeat") args.minRepeat = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--bar-steps") args.barSteps = Number.parseInt(argv[++i], 10);
  }
  return args;
}

/** steps[i] = lane hits on 16th step i of one bar ("x..x...x.x......"). */
type BarMask = Record<DrumLaneId, string>;

const LANE_ORDER: DrumLaneId[] = ["kick", "snare", "rim", "hat", "cym", "tom"];

function emptyMask(): BarMask {
  return { kick: "", snare: "", rim: "", hat: "", cym: "", tom: "" };
}

function maskKey(m: BarMask): string {
  return LANE_ORDER.map((l) => m[l] || "................").join("|");
}

function maskHits(m: BarMask): number {
  let n = 0;
  for (const l of LANE_ORDER) for (const c of m[l] || "") if (c === "x") n++;
  return n;
}

/** One song's decode result. */
function extractGroove(line: string): { md5: string; mask: BarMask; repeat: number; bars: number; unmapped: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const rec = parsed as [string, Array<[number[], number[], number[]]>];
  if (!Array.isArray(rec) || rec.length !== 2 || !Array.isArray(rec[1])) return null;
  const md5 = rec[0];

  let stepAbs = 0;
  const barCounts = new Map<string, { mask: BarMask; count: number }>();
  let unmapped = 0;
  let barsWithHits = 0;

  // per-bar lane step sets (bar → lane → Set<step>)
  const bars = new Map<number, Record<DrumLaneId, Set<number>>>();

  for (const ev of rec[1]) {
    if (!Array.isArray(ev)) continue;
    const deltas = ev[0] ?? [];
    const drums = ev[2] ?? [];
    if (deltas.length > 0 && typeof deltas[0] === "number") stepAbs += deltas[0];
    if (drums.length === 0) continue;
    for (const pitch of drums) {
      const voice = voiceOf(pitch);
      if (!voice) {
        unmapped++;
        continue;
      }
      const lane = VOICE_TO_LANE.get(voice);
      if (!lane) {
        unmapped++;
        continue;
      }
      const step = Math.round(stepAbs);
      const bar = Math.floor(step / STEPS_PER_BAR);
      const stepInBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
      let rec2 = bars.get(bar);
      if (!rec2) {
        rec2 = { kick: new Set(), snare: new Set(), rim: new Set(), hat: new Set(), cym: new Set(), tom: new Set() };
        bars.set(bar, rec2);
      }
      rec2[lane].add(stepInBar);
    }
  }

  for (const laneSets of bars.values()) {
    let hits = 0;
    const mask = emptyMask();
    for (const l of LANE_ORDER) {
      const arr = Array.from({ length: STEPS_PER_BAR }, (_, i) => (laneSets[l].has(i) ? "x" : ".")).join("");
      mask[l] = arr;
      hits += laneSets[l].size;
    }
    if (hits > 0) {
      barsWithHits++;
      const key = maskKey(mask);
      const entry = barCounts.get(key);
      if (entry) entry.count++;
      else barCounts.set(key, { mask, count: 1 });
    }
  }

  let best: { mask: BarMask; count: number } | null = null;
  for (const entry of barCounts.values()) {
    if (!best || entry.count > best.count || (entry.count === best.count && maskHits(entry.mask) > maskHits(best.mask))) {
      best = entry;
    }
  }
  if (!best) return null;
  return { md5, mask: best.mask, repeat: best.count, bars: barsWithHits, unmapped };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  STEPS_PER_BAR = args.barSteps;
  if (!fs.existsSync(DEFAULT_FILE)) {
    console.error(`✗ corpus not found: ${DEFAULT_FILE}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(DEFAULT_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let songs = 0;
  let withDrums = 0;
  let qualifying = 0;
  let unmappedTotal = 0;
  const pool = new Map<string, { mask: BarMask; songs: number; bars: number; examples: string[] }>();

  for await (const line of rl) {
    if (songs >= args.limit) break;
    if (!line.trim()) continue;
    songs++;
    const g = extractGroove(line);
    if (!g) continue;
    if (g.bars < 2) continue;
    withDrums++;
    unmappedTotal += g.unmapped;
    if (g.repeat < args.minRepeat || maskHits(g.mask) < 2) continue;
    qualifying++;
    const key = maskKey(g.mask);
    const entry = pool.get(key);
    if (entry) {
      entry.songs++;
      entry.bars += g.bars;
      if (entry.examples.length < 3) entry.examples.push(g.md5);
    } else {
      pool.set(key, { mask: g.mask, songs: 1, bars: g.bars, examples: [g.md5] });
    }
  }
  rl.close();

  const grooves = [...pool.values()].sort((a, b) => b.songs - a.songs || b.bars - a.bars);

  // report
  console.log(`scanned ${songs} songs · with drums ${withDrums} · qualifying ${qualifying} · unique grooves ${grooves.length} · unmapped hits ${unmappedTotal}`);
  const lanePresent = new Map<string, number>();
  for (const g of grooves) {
    const lanes = LANE_ORDER.filter((l) => g.mask[l]?.includes("x")).join("+");
    lanePresent.set(lanes, (lanePresent.get(lanes) ?? 0) + 1);
  }
  console.log("lane combos (grooves):", [...lanePresent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log("top grooves:");
  for (const g of grooves.slice(0, 10)) {
    const parts = LANE_ORDER.filter((l) => g.mask[l]?.includes("x")).map((l) => `${l[0].toUpperCase()}${l === "snare" ? "N" : l === "cym" ? "Y" : l === "hat" ? "" : ""}:${g.mask[l]}`);
    console.log(`  ×${String(g.songs).padStart(5)} songs  ${parts.join(" ")}`);
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(
    args.out,
    JSON.stringify(
      {
        meta: { file: DEFAULT_FILE, limit: args.limit, minRepeat: args.minRepeat, songs, withDrums, qualifying, unique: grooves.length, generatedAt: new Date().toISOString() },
        grooves: grooves.slice(0, 20000).map((g) => ({ lanes: g.mask, songs: g.songs, bars: g.bars, examples: g.examples })),
      },
      null,
      1,
    ),
  );
  console.log(`wrote ${args.out}`);
}

void main();
