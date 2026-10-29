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
 *   NODE_OPTIONS=--max-old-space-size=10240 npx tsx scripts/build-presets.ts
 *
 * The heap flag is not optional on the full corpus: 8.5M segments parsed as
 * objects overrun the default ~4 GB and V8 dies in JsonParse.
 *
 * Then — always — re-run the Zappa mint, which appends the odd-meter
 * material this four-four corpus cannot provide:
 *   npx tsx scripts/mint-zappa.ts
 * This file rewrites presets-data.json from scratch, so skipping that step
 * silently deletes `78` and thins `54`/`68`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { createGunzip } from "node:zlib";
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

/** Variants per preset. Several rather than one, so sections sharing a preset don't play the identical groove — the same reason `selectGroove` takes a seed at all.
 *
 * Raised 16→24 for the 2026-09 re-bake: a selection audit measured the old
 * 16-variant pool flattening whole songs (46/194 dominated by one
 * pattern·variant). More variants = more per-song variety AND a finer-grained
 * `rankPatternMatches` (the Match… panel scores every variant).
 */
const VARIANTS_PER_PRESET = 160;

/**
 * Cap per corpus style family inside one pattern.
 *
 * 48 slots filled purely by seed would all land in rock and pop — they are
 * 20k of the 45k takes — and the other fifteen families would be invisible
 * even though selection can now ask for them (see `style-family.ts`). The
 * quota is what turns "48 variants of standard" into "up to 10 each of rock,
 * funk, jazz, soul, latin, country, punk…".
 *
 * 10, not 6: a song draws from its own family AND its neighbours, and at 6
 * the rock neighbourhood came back with 13 variants for `standard` — thinner
 * than the undifferentiated pool it replaced. At 10 it is ~34.
 */
const VARIANTS_PER_STYLE = 16;

/**
 * Candidate pool size passed to `selectGroove`, kept independent of
 * `VARIANTS_PER_PRESET`. A first run tied these together (`poolSize:
 * VARIANTS_PER_PRESET`) and several presets came back with far fewer
 * variants than requested — `driving` collapsed to a single variant out of
 * 10 attempts — because 10 seeds picking from a pool of only 10 candidates
 * (per limb, further narrowed by the offset-by-limb-index spread in
 * `selectGroove`) collide often. A larger, decoupled pool gives each seed
 * more room to land somewhere genuinely different.
 *
 * Raised 64 → 256 when VARIANTS_PER_PRESET went to 48: at 64 the pool
 * saturated, and 48 seeds produced fewer variants than every pattern had
 * before (standard 37, driving 27) because seeds kept landing on takes
 * already baked.
 */
const POOL_SIZE = 640;

/**
 * Musical validity filter on a baked variant.
 *
 * A drum track is a dialogue between kick and backbeat. When accent snare
 * hits outnumber kicks by more than this, the take is a fill, a rudimental
 * exercise, or a ghost-heavy passage whose accents got promoted — none of
 * which is a groove you want looping under a verse. The corpus has plenty of
 * each, so filtering at bake time is cheaper than teaching every runtime
 * consumer to distrust the data.
 *
 * Measured post-fold: `intense` previously baked 18 variants averaging 2.55×
 * snare:kick (1.77× ignoring ghosts), which reads as a snare solo.
 */
const MAX_ACCENT_SNARE_PER_KICK = 1.8;
/** Below this many kicks per bar a "groove" has no pulse to follow. */
const MIN_KICKS_PER_BAR = 0.5;

const KICK_PITCH = 36;
/** 38 centre + 39 rimshot both read as backbeat. */
const SNARE_PITCHES = new Set([38, 39]);
/** E-GMD ghost notes live below this; they are not accents. */
const GHOST = 45;

function musicality(
  packed: readonly PackedNote[],
  lengthBeats: number,
  beatsPerBar: number,
): { ok: boolean; reason?: string } {
  const bars = Math.max(0.25, lengthBeats / (beatsPerBar || 4));
  let kick = 0;
  let accentSnare = 0;
  for (const [, pitch, velocity] of packed) {
    if (pitch === KICK_PITCH) kick++;
    else if (SNARE_PITCHES.has(pitch) && velocity >= GHOST) accentSnare++;
  }
  if (kick / bars < MIN_KICKS_PER_BAR) return { ok: false, reason: "no pulse" };
  if (kick > 0 && accentSnare / kick > MAX_ACCENT_SNARE_PER_KICK) return { ok: false, reason: "snare-led" };
  return { ok: true };
}

async function main(): Promise<void> {
  const takesPath = path.join(DATA_DIR, "takes.json");
  // Prefer the gzipped segments (the full corpus writes ~4.3 GB raw);
  // the uncompressed name remains readable for older extractions.
  const gzPath = path.join(DATA_DIR, "segments.ndjson.gz");
  const rawPath = path.join(DATA_DIR, "segments.ndjson");
  const segmentsPath = fs.existsSync(gzPath) ? gzPath : rawPath;
  if (!fs.existsSync(takesPath) || !fs.existsSync(segmentsPath)) {
    console.error(`Missing ${takesPath} or ${rawPath}(.gz). Run 'npm run extract -- --all' first.`);
    process.exit(1);
  }

  const takeSummaries = JSON.parse(fs.readFileSync(takesPath, "utf8"));
  const allSegments = await readNdjson<Segment>(segmentsPath);

  /**
   * Groove presets are mined from `beat_type: beat` takes ONLY.
   *
   * E-GMD labels every performance as a beat or a fill, and that label is
   * authoritative — it is the drummer's own statement of what they were asked
   * to play, which beats any heuristic we can run over the notes. Mining
   * grooves from fill takes is what made `intense` 81% tom runs and forced the
   * runtime to carry a tom-share rule; with the label available, the filter
   * belongs here, once, instead of in every consumer. Fills are baked
   * separately below from the `beat_type: fill` rows, where they belong.
   */
  const segments = allSegments.filter((segment) => {
    const summary = (takeSummaries as Record<string, { beatType?: string }>)[segment.takeId];
    return summary?.beatType !== "fill";
  });
  console.log(
    `kept ${segments.length} of ${allSegments.length} beat-type segments (fills excluded)`,
  );

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
    const rejections = new Map<string, number>();
    const styleCounts = new Map<string, number>();

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

      // ONE OR TWO WHOLE BARS. The segment index holds windows up to eight bars,
      // and a bigger pool started selecting them: `standard` came back with
      // 32-beat loops. A loop longer than two bars does not repeat inside a
      // four-bar phrase, which is the same "the groove never comes back"
      // failure the pattern pool was rebuilt to fix — so the length is a bake
      // gate, not a runtime hope. `drumMusicality.test.ts` asserts it again.
      const bars = lengthBeats / (beatsPerBar || 4);
      if (bars > 2 + 1e-6 || Math.abs(bars - Math.round(bars)) > 1e-6) {
        rejections.set("not 1-2 whole bars", (rejections.get("not 1-2 whole bars") ?? 0) + 1);
        continue;
      }

      // Reject takes that are not grooves (see `musicality`). Pitch-filtered
      // presets (kick_only) are exempt: they have no snare by definition.
      if (!preset.pitchFilter) {
        const check = musicality(packed, lengthBeats, beatsPerBar);
        if (!check.ok) {
          const reason = check.reason ?? "other";
          rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
          continue;
        }
      }

      // Style diversity: the first limb's take names the tradition. Limbs can
      // come from different takes, so this is the dominant one, which is what
      // a listener hears as "that's a funk groove".
      const styleTake = anyRef ? index.takes.get(anyRef.takeId) : undefined;
      const style = styleTake ? styleTake.style.split("/")[0] : undefined;
      if (style) {
        const used = styleCounts.get(style) ?? 0;
        if (used >= VARIANTS_PER_STYLE) {
          rejections.set("style full", (rejections.get("style full") ?? 0) + 1);
          continue;
        }
        styleCounts.set(style, used + 1);
      }

      variants.push({
        ...(style ? { style } : {}),
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
    const rejected = [...rejections.entries()].map(([r, n]) => `${r}×${n}`).join(" ");
    const styles = [...styleCounts.entries()].map(([st, n]) => `${st}×${n}`).join(" ");
    console.log(`  ${pattern}: ${variants.length} variants (${Date.now() - started}ms)${styles ? `  [${styles}]` : ""}${rejected ? `  rejected: ${rejected}` : ""}`);
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
 * `readFileSync(...).split("\n")` call. A full corpus's segments file can
 * approach the size where reading it as a single string risks the same
 * V8 string-length ceiling that broke the write side; streaming avoids ever
 * materialising the whole file as one string, at the cost of holding only
 * the parsed objects (much smaller than their JSON text) in memory.
 * Transparently gunzips when the extraction wrote `segments.ndjson.gz`.
 */
async function readNdjson<T>(filePath: string): Promise<T[]> {
  const records: T[] = [];
  const source = fs.createReadStream(filePath);
  const input = filePath.endsWith(".gz") ? source.pipe(createGunzip()) : source;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
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
