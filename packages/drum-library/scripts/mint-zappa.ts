/**
 * Mint curated drum material from the Frank Zappa arrangement set into the
 * committed preset bake — the odd-meter grooves and fills the E-GMD corpus
 * (four-four rock/pop/funk by construction) cannot provide.
 *
 *   npx tsx scripts/mint-zappa.ts [--scan data/zappa-scan.json] [--dry]
 *
 * Input:  data/zappa-scan.json (scripts/zappa-scan.ts — the meter-aware scan)
 * Output: src/presets-data.json, appended to the existing bake:
 *
 *  - GROOVES: recurring bar patterns become variants of the family the
 *    automatic path will actually reach for their meter — the dedicated
 *    odd-meter families (`78` for 7/8, `68` for 6/8 and 3/4, `54` for 5/4,
 *    which is what `inferDrumPattern` routes those meters to) or, for every
 *    other meter, the acoustic family their texture suggests (kick_only /
 *    bridge_sparse / standard / driving / intense). Each is tagged with the
 *    scanned bar length in quarter beats (7/8 → 3.5, 21/16 → 5.25, 9/4 → 9 …)
 *    and `source.origin: "zappa"`, so `pickVariantIndexFor` routes them to
 *    sections in the same meter.
 *    4/4 material is only mined when it's exceptional (a bar shape played
 *    25+ times — e.g. Hungry Freaks Daddy's 74× riff groove), because the
 *    corpus already covers 4/4 richly.
 *
 *    Coverage pass: every mined meter is guaranteed at least one
 *    standard (verse), driving (chorus) and half_time (outro) variant,
 *    copying the closest groove when the density routing left a gap.
 *    An odd-meter section that resolves to a real groove in its own meter
 *    always beats the fallback (a 4/4 groove drifting against the barline).
 *
 *  - FILLS: recurring or crash-landing bars enter the top-level `fills`
 *    map keyed by the meter string; `fillPool` already looks fills up by
 *    `String(variant.beatsPerBar)`, so they reach exactly these grooves
 *    (and never contaminate the 4/4 corpus fills).
 *
 * Idempotent: every `origin: "zappa"` entry is stripped before appending.
 * MUST be re-run after any full E-GMD re-bake: build-presets.ts rewrites
 * presets-data.json from scratch and drops the mined material.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DrumPattern } from "../src/presets.js";
import type { PackedNote, PackedVariant, PresetLibraryFile } from "../src/presetData.js";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");
const OUT_PATH = path.join(import.meta.dirname, "..", "src", "presets-data.json");
const BACKUP_PATH = path.join(DATA_DIR, "presets-data.pre-zappa.bak.json");

/** How many grooves per meter survive curation, and how many total. */
const PER_METER_GROOVES = 5;
const PER_FAMILY_GROOVES = 12;
const MAX_GROOVES = 60;
/** 4/4 candidates must be this recurring to earn a slot (corpus is rich). */
const FOUR_FOUR_MIN_BARS = 25;

const KICK_PITCHES = new Set([35, 36]);
const RIDE_PITCHES = new Set([51, 53, 59]);

interface ScanPattern {
  meter: string;
  beats: number;
  steps: number;
  key: string;
  bars: number;
  notes: Array<[number, number, number]>;
}

interface ScanFill {
  meter: string;
  beats: number;
  steps: number;
  key: string;
  count: number;
  snareTomShare: number;
  landsOnCrash: boolean;
  notes: Array<[number, number, number]>;
}

interface ScanEntry {
  title: string;
  file: string;
  meterBars?: Record<string, number>;
  topPatterns: ScanPattern[];
  fills: ScanFill[];
}

interface ScanFile {
  generatedAt: string;
  dir: string;
  entries: ScanEntry[];
}

interface Groove {
  family: DrumPattern;
  bar: number;
  meter: string;
  key: string;
  count: number;
  title: string;
  notes: PackedNote[];
  /** Set on coverage copies — documents which slot this copy fills. */
  copyOf?: string;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Quarter beats a whole bar of `meter` ("7/8" → 3.5, "21/16" → 5.25). */
function expectedBarOf(meter: string): number {
  const [numerator, denominator] = meter.split("/").map(Number);
  return numerator * (4 / denominator);
}

/** A bar whose length disagrees with its own meter string is a partial bar
 *  created by a mid-bar meter change — real material, but not a loop, so
 *  it can't be minted as a groove. (This is how 4/4-clipped 3.51-beat
 *  stragglers from the scan get excluded.) */
function isWholeMeterBar(bar: number, meter: string): boolean {
  return Math.abs(bar - expectedBarOf(meter)) < 0.01;
}

/** Rough family routing by texture — density first, with kick-only and
 *  ride-led special cases. The odd-meter pool is thin, so this favors
 *  broad coverage over fine-grained family sculpting. */
function familyFor(notes: PackedNote[]): DrumPattern {
  const pitches = new Set(notes.map(([, pitch]) => pitch));
  if ([...pitches].every((pitch) => KICK_PITCHES.has(pitch))) return "kick_only";
  const hits = notes.length;
  const rideShare = notes.filter(([, pitch]) => RIDE_PITCHES.has(pitch)).length / hits;
  if (rideShare >= 0.6 && hits <= 10) return "bridge_sparse";
  if (hits >= 16) return "intense";
  if (hits >= 9) return "driving";
  if (hits >= 5) return "standard";
  return "half_time";
}

/**
 * The family the automatic path actually reaches for a meter:
 *  - 7/8 → `78`,
 *  - 6/8 and 3/4 → `68` (they share the 3-quarter-beat bar),
 *  - 5/4 → `54`.
 * `inferDrumPattern` routes these meters to the dedicated families before
 * role logic, so densified role-family grooves would never be picked
 * automatically. (The coverage pass still copies the best of them into the
 * role families, for manual preset picks.) Every other meter falls through
 * to the density family — those sections reach the role families, and the
 * meter-aware pick finds the mined grooves there.
 */
function targetFamily(bar: number, densityFamily: DrumPattern): DrumPattern {
  if (Math.abs(bar - 3.5) < 0.01) return "78";
  if (Math.abs(bar - 3) < 0.01) return "68";
  if (Math.abs(bar - 5) < 0.01) return "54";
  return densityFamily;
}

function zappaTag(title: string, count: number, meter: string): string {
  return `zappa: ${title} (${count}× ${meter})`;
}

function main(): void {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const scanIdx = args.indexOf("--scan");
  const scanPath = scanIdx >= 0 ? args[scanIdx + 1] : path.join(DATA_DIR, "zappa-scan.json");

  const scan: ScanFile = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const original = fs.readFileSync(OUT_PATH, "utf8");
  const file: PresetLibraryFile = JSON.parse(original);

  // ---------------------------------------------------------------- strip
  for (const preset of Object.values(file.presets)) {
    if (!preset) continue;
    preset.variants = preset.variants.filter((v) => v.source.origin !== "zappa");
  }
  file.fills ??= {};
  for (const key of Object.keys(file.fills)) {
    file.fills[key] = file.fills[key].filter((v) => v.source.origin !== "zappa");
  }

  // -------------------------------------------------------------- grooves
  const candidates = new Map<string, Groove>();
  for (const entry of scan.entries) {
    for (const pattern of entry.topPatterns) {
      const bar = round4(pattern.beats);
      if (!isWholeMeterBar(bar, pattern.meter)) continue;
      const fourFour = Math.abs(bar - 4) < 0.01;
      if (fourFour && pattern.bars < FOUR_FOUR_MIN_BARS) continue;
      if (pattern.key.split(",").length < 2) continue; // a single hit is not a groove
      const notes = pattern.notes.map(([beat, pitch, velocity]) => [round4(beat), pitch, velocity] as PackedNote);
      if (notes.length < 3) continue;
      const id = `${bar}|${pattern.key}`;
      const prev = candidates.get(id);
      if (!prev || pattern.bars > prev.count) {
        candidates.set(id, {
          family: targetFamily(bar, familyFor(notes)),
          bar,
          meter: pattern.meter,
          key: pattern.key,
          count: pattern.bars,
          title: entry.title,
          notes,
        });
      }
    }
  }

  // Per meter: keep the most played; then assign family slots.
  const byMeter = new Map<number, Groove[]>();
  for (const groove of candidates.values()) {
    const list = byMeter.get(groove.bar) ?? [];
    list.push(groove);
    byMeter.set(groove.bar, list);
  }
  const shortlist: Groove[] = [];
  for (const list of byMeter.values()) {
    list.sort((a, b) => b.count - a.count);
    shortlist.push(...list.slice(0, PER_METER_GROOVES));
  }

  shortlist.sort((a, b) => b.count - a.count);
  const familyCount = new Map<string, number>();
  const familyMeterCount = new Map<string, number>();
  const grooves: Groove[] = [];
  for (const groove of shortlist) {
    if (grooves.length >= MAX_GROOVES) break;
    const familyKey = `${groove.family}`;
    const slotKey = `${groove.family}|${groove.bar}`;
    if ((familyCount.get(familyKey) ?? 0) >= PER_FAMILY_GROOVES) continue;
    if ((familyMeterCount.get(slotKey) ?? 0) >= 3) continue;
    familyCount.set(familyKey, (familyCount.get(familyKey) ?? 0) + 1);
    familyMeterCount.set(slotKey, (familyMeterCount.get(slotKey) ?? 0) + 1);
    grooves.push(groove);
  }

  // Coverage: every *odd* mined meter must be able to serve the three most
  // common roles, copying the closest groove where density routing left a
  // gap. (4/4 needs no help — the corpus is its coverage. kick_only /
  // intense gaps keep the legacy fallback.) Meters are visited in order of
  // how much material the scan actually found for them, so 7/8 and 3/4 get
  // their copies before a single-bar 12/4 curiosity does; each copy is
  // tagged in its generator string.
  const meterWeight = new Map<number, number>();
  for (const entry of scan.entries) {
    for (const [meter, bars] of Object.entries(entry.meterBars ?? {})) {
      const bar = round4(expectedBarOf(meter));
      meterWeight.set(bar, (meterWeight.get(bar) ?? 0) + bars);
    }
  }
  const copies: Groove[] = [];
  const coverageOrder = [...byMeter.keys()].filter((bar) => Math.abs(bar - 4) >= 0.01).sort(
    (a, b) => (meterWeight.get(b) ?? 0) - (meterWeight.get(a) ?? 0),
  );
  for (const bar of coverageOrder) {
    if (copies.length >= 40) break;
    const mine = grooves.filter((g) => g.bar === bar);
    if (mine.length === 0) continue;
    const sparse = [...mine].sort((a, b) => a.notes.length - b.notes.length)[0];
    const dense = [...mine].sort((a, b) => b.notes.length - a.notes.length)[0];
    for (const [family, source] of [
      ["standard", dense],
      ["driving", dense],
      ["half_time", sparse],
    ] as const) {
      if (copies.length >= 40) break;
      if (mine.some((g) => g.family === family)) continue;
      copies.push({ ...source, family: family as DrumPattern, copyOf: family });
    }
  }
  grooves.push(...copies);

  for (const groove of grooves) {
    const preset = file.presets[groove.family] ?? (file.presets[groove.family] = { variants: [] });
    preset.variants.push({
      lengthBeats: groove.bar,
      beatsPerBar: groove.bar,
      notes: groove.notes,
      source: {
        origin: "zappa",
        generator: groove.copyOf
          ? `${zappaTag(groove.title, groove.count, groove.meter)} · ${groove.copyOf} coverage copy`
          : zappaTag(groove.title, groove.count, groove.meter),
      },
    });
  }

  // ---------------------------------------------------------------- fills
  const fillSeen = new Map<string, ScanFill & { title: string; bar: number }>();
  for (const entry of scan.entries) {
    for (const fill of entry.fills) {
      if (!fill.landsOnCrash && fill.count < 2) continue;
      if (fill.notes.length < 4) continue;
      if (fill.key.split(",").length < 2) continue;
      const bar = round4(fill.beats);
      if (!isWholeMeterBar(bar, fill.meter)) continue;
      const id = `${bar}|${fill.key}`;
      const prev = fillSeen.get(id);
      if (
        !prev ||
        (fill.landsOnCrash && !prev.landsOnCrash) ||
        (fill.landsOnCrash === prev.landsOnCrash && fill.count > prev.count)
      ) {
        fillSeen.set(id, { ...fill, bar, title: entry.title });
      }
    }
  }
  const fillList = [...fillSeen.values()].sort(
    (a, b) => Number(b.landsOnCrash) - Number(a.landsOnCrash) || b.count - a.count || b.notes.length - a.notes.length,
  );
  const perMeterFills = new Map<number, number>();
  let fillTotal = 0;
  const fillCounts = new Map<number, number>();
  for (const fill of fillList) {
    const bar = fill.beats;
    const cap = Math.abs(bar - 4) < 0.01 ? 6 : 3;
    const used = perMeterFills.get(bar) ?? 0;
    if (used >= cap) continue;
    perMeterFills.set(bar, used + 1);
    const variant: PackedVariant = {
      lengthBeats: bar,
      beatsPerBar: bar,
      notes: fill.notes.map(([beat, pitch, velocity]) => [round4(beat), pitch, velocity] as PackedNote),
      source: {
        origin: "zappa",
        generator: `${zappaTag(fill.title, fill.count, fill.meter)}${fill.landsOnCrash ? " →crash" : ""}`,
      },
    };
    const key = String(bar);
    (file.fills[key] ??= []).push(variant);
    fillTotal++;
    fillCounts.set(bar, (fillCounts.get(bar) ?? 0) + 1);
  }

  // ------------------------------------------------------------- metadata
  file.meta.mined = {
    zappa: {
      grooves: grooves.length,
      fills: fillTotal,
      mintedAt: new Date().toISOString(),
      scan: scan.generatedAt,
      source: path.basename(scan.dir),
    },
  };

  // --------------------------------------------------------------- report
  console.log(`mint-zappa: ${grooves.length} grooves · ${fillTotal} fills${dry ? " (dry run)" : ""}\n`);
  console.log("grooves per family × meter:");
  const byFamily = new Map<string, Groove[]>();
  for (const groove of grooves) {
    const list = byFamily.get(groove.family) ?? [];
    list.push(groove);
    byFamily.set(groove.family, list);
  }
  for (const [family, list] of [...byFamily.entries()].sort()) {
    const meters = [...list]
      .sort((a, b) => a.bar - b.bar)
      .map((g) => `${g.meter}${g.copyOf ? "*" : ""}×${g.count}@${g.bar}`)
      .join(" ");
    console.log(`  ${family.padEnd(13)} ${String(list.length).padStart(2)}  ${meters}`);
  }
  console.log("  * = coverage copy of the meter's nearest groove");
  console.log("\nzappa fills per meter:");
  for (const [bar, count] of [...fillCounts.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(bar).padStart(5)} beats/bar: ${count}`);
  }
  console.log("\nfamily variant totals after mint:");
  for (const [family, preset] of Object.entries(file.presets).sort()) {
    if (preset) console.log(`  ${family.padEnd(13)} ${preset.variants.length}`);
  }

  if (dry) return;
  fs.writeFileSync(BACKUP_PATH, original);
  fs.writeFileSync(OUT_PATH, JSON.stringify(file));
  console.log(`\nwrote ${OUT_PATH} (backup: ${BACKUP_PATH})`);
}

main();
