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
import type { PackedNote, PackedPreset, PackedVariant, PresetLibraryFile } from "../src/presetData.js";
import type { Segment, Take } from "../src/types.js";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");
const EGMD_ROOT = process.env.EGMD_ROOT ?? "/Users/Matthew/Datasets/e-gmd-v1.0.0";
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
  const presets: Partial<Record<DrumPattern, PackedPreset>> = {};

  for (const pattern of Object.keys(PRESETS) as DrumPattern[]) {
    const preset = PRESETS[pattern];
    if (!preset) continue; // no corpus target — 'none', '78' and the synth-only machine idioms
    const started = Date.now();

    const variants: PackedVariant[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < VARIANTS_PER_PRESET; i++) {
      const spec = selectGroove(index, pattern, { seed: `${pattern}:${i}`, poolSize: POOL_SIZE });
      if (!spec) continue;

      const resolved = resolveGrooveNotes(index, spec);
      const folded = foldForAbleton(resolved);
      // A pitch-filtered preset (e.g. kick_only, whose "feet" limb
      // legitimately includes pedal hi-hat) can select a take that turns out
      // to have none of its kept pitches at all — that's a bad take for this
      // preset specifically, so skip it rather than baking a silent variant.
      const keptNotes = preset.pitchFilter
        ? folded.notes.filter((n) => preset.pitchFilter!.includes(n.pitch))
        : folded.notes;
      if (keptNotes.length === 0) continue;

      const packed: PackedNote[] = keptNotes.map((n) => [round4(n.beat), n.pitch, n.velocity]);
      const key = JSON.stringify(packed);
      if (seen.has(key)) continue; // small pools can repeat; keep variants distinct
      seen.add(key);

      const lengthBeats = grooveLengthBeats(index, spec);
      // Any present limb's take is representative for meter — selectGroove
      // pins every limb of one spec to a single time signature.
      const anyRef = spec.feet ?? spec.snare ?? spec.cymbals ?? spec.toms;
      const beatsPerBar = anyRef ? (index.takes.get(anyRef.takeId)?.beatsPerBar ?? 4) : 4;

      variants.push({
        lengthBeats,
        beatsPerBar,
        notes: packed,
        // The whole point of format 2: every baked variant records exactly
        // which corpus performances each limb came from.
        source: {
          origin: "egmd",
          refs: {
            ...(spec.feet && { feet: spec.feet }),
            ...(spec.snare && { snare: spec.snare }),
            ...(spec.cymbals && { cymbals: spec.cymbals }),
            ...(spec.toms && { toms: spec.toms }),
          },
        },
      });
    }

    if (variants.length > 0) presets[pattern] = { variants };
    console.log(`  ${pattern}: ${variants.length} variants (${Date.now() - started}ms)`);
  }

  console.log("extracting corpus fills...");
  const fills = extractFills();
  for (const [bar, list] of Object.entries(fills)) {
    console.log(`  fills[${bar} beats/bar]: ${list.length}`);
  }

  const output: PresetLibraryFile = {
    format: 2,
    meta: {
      corpus: "e-gmd-v1.0.0",
      generatedAt: new Date().toISOString(),
      takesIndexed: takes.length,
    },
    presets,
    fills,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output));
  report(presets);
  console.log(`\nwrote ${OUT_PATH}`);
}

/** How many corpus fills to bake, per bar length. */
const FILLS_PER_METER = 12;

/**
 * Bake one-bar fills from E-GMD's own `beatType: "fill"` takes — short
 * one-shot transition figures recorded separately from the grooves. The
 * last full bar of each take is the part that lands on the downbeat, so
 * that's the bar that gets kept. Selection is deterministic (sorted ids,
 * spread across drummers) and quality-gated the simple way: a usable fill
 * bar has a sane number of hits.
 */
function extractFills(): Record<string, PackedVariant[]> {
  const catalog = parseCatalog(fs.readFileSync(path.join(EGMD_ROOT, "e-gmd-v1.0.0.csv"), "utf8"));
  const fillEntries = catalog
    .filter((entry) => entry.beatType === "fill")
    .sort((a, b) => a.midiFilename.localeCompare(b.midiFilename));

  const byBar: Record<string, PackedVariant[]> = {};
  const perDrummer = new Map<string, number>();

  for (const entry of fillEntries) {
    const midiPath = path.join(EGMD_ROOT, entry.midiFilename);
    if (!fs.existsSync(midiPath)) continue;

    let take: Take;
    try {
      take = loadTake(new Uint8Array(fs.readFileSync(midiPath)), entry);
    } catch {
      continue;
    }

    const barBeats = take.beatsPerBar;
    const key = String(barBeats);
    if ((byBar[key]?.length ?? 0) >= FILLS_PER_METER) continue;
    // No single drummer's vocabulary should dominate the baked set.
    if ((perDrummer.get(take.drummer) ?? 0) >= 3) continue;

    const lastBeat = Math.max(...take.notes.map((n) => n.beat), 0);
    const barStart = Math.floor(lastBeat / barBeats) * barBeats;
    const barNotes = take.notes
      .filter((n) => n.beat >= barStart && n.beat < barStart + barBeats)
      .map((n) => ({ ...n, beat: n.beat - barStart }));

    const folded = foldForAbleton(barNotes);
    // A fill bar with almost nothing in it is a truncation artifact; one
    // with dozens of hits per beat is a roll that folded badly.
    if (folded.notes.length < 4 || folded.notes.length > barBeats * 8) continue;

    (byBar[key] ??= []).push({
      lengthBeats: barBeats,
      beatsPerBar: barBeats,
      notes: folded.notes.map((n) => [round4(n.beat), n.pitch, n.velocity]),
      source: {
        origin: "egmd",
        refs: { snare: { takeId: take.id, startBar: barStart / barBeats, lengthBars: 1 } },
      },
    });
    perDrummer.set(take.drummer, (perDrummer.get(take.drummer) ?? 0) + 1);
  }

  return byBar;
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
      packed.variants.reduce((sum, v) => sum + v.notes.length, 0) / packed.variants.length,
    );
    const beats = [...new Set(packed.variants.map((v) => v.lengthBeats))].join(",");
    console.log(`  ${pattern.padEnd(15)} ${String(packed.variants.length).padStart(3)}       ${String(avgNotes).padStart(6)}         ${beats}`);
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
