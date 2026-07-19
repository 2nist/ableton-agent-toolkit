/**
 * Render an extracted groove to a WAV using one of the drum-machine kits, so
 * the library can be checked by ear instead of by statistics.
 *
 * Run:
 *   npx tsx scripts/audition.ts --style funk --kit "Roland TR-909" --bars 2
 *   npx tsx scripts/audition.ts --list-kits
 *   npx tsx scripts/audition.ts --style jazz --kit "Roland TR-808" --limbs feet,snare
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCatalog } from "../src/catalog.js";
import { loadTake } from "../src/take.js";
import { notesForLimb } from "../src/segment.js";
import { measureFeel } from "../src/features.js";
import { mapKit, type KitVoice } from "../src/kit.js";
import { decodeWav, encodeWav, type AudioBuffer } from "../src/wav.js";
import { normalise, renderGroove } from "../src/render.js";
import type { DrumNote, Limb } from "../src/types.js";

const EGMD_ROOT =
  process.env.EGMD_ROOT ??
  "/Users/Matthew/Datasets/e-gmd-v1.0.0";
const KITS_ROOT = process.env.DRUM_KITS ?? "/Users/Matthew/drums";

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function main(): void {
  if (process.argv.includes("--list-kits")) {
    const kits = fs
      .readdirSync(KITS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    console.log(`${kits.length} kits in ${KITS_ROOT}:\n`);
    for (const kit of kits) console.log(`  ${kit}`);
    return;
  }

  if (process.argv.includes("--list-styles")) {
    // Styles are hierarchical (`jazz/swing`, `jazz/funk`) and a bare `--style
    // jazz` matches whichever comes first — which is how a swing request ended
    // up rendering jazz-funk. Listing them makes the distinction visible.
    const catalog = parseCatalog(fs.readFileSync(path.join(EGMD_ROOT, "e-gmd-v1.0.0.csv"), "utf8"));
    const counts = new Map<string, number>();
    for (const entry of catalog) counts.set(entry.style, (counts.get(entry.style) ?? 0) + 1);
    const filter = arg("list-styles");
    for (const [style, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      if (filter && filter.startsWith("--")) {
        console.log(`  ${style.padEnd(30)} ${count}`);
      } else if (!filter || style.includes(filter)) {
        console.log(`  ${style.padEnd(30)} ${count}`);
      }
    }
    return;
  }

  const styleFilter = arg("style");
  const kitName = arg("kit", "Roland TR-909")!;
  const bars = Number.parseInt(arg("bars", "2")!, 10);
  const startBar = Number.parseInt(arg("start", "0")!, 10);
  const outPath = arg("out", path.join(import.meta.dirname, "..", "data", "audition.wav"))!;
  const limbFilter = arg("limbs");

  // --- kit -------------------------------------------------------------
  const kitDir = path.join(KITS_ROOT, kitName);
  if (!fs.existsSync(kitDir)) {
    console.error(`No kit '${kitName}' in ${KITS_ROOT}. Try --list-kits.`);
    process.exit(1);
  }
  const mapping = mapKit(fs.readdirSync(kitDir));
  if (mapping.size === 0) {
    console.error(`No usable samples found in '${kitName}'.`);
    process.exit(1);
  }

  /**
   * Per-voice overrides, e.g. `--voice ride="Roland JV 1080/MaxV - Ride1.wav"`.
   * These kits are all drum machines spanning 1978–1995, so no single one has
   * a convincing sound for every style — a 1982 LinnDrum ride under a swing
   * pattern is the problem, not the pattern. Sourcing one voice from another
   * kit is the same recombination logic the groove library itself uses.
   */
  const overrides = new Map<string, string>();
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--voice" || !process.argv[i + 1]) continue;
    const spec = process.argv[++i];
    const split = spec.indexOf("=");
    if (split > 0) overrides.set(spec.slice(0, split).trim(), spec.slice(split + 1).trim());
  }

  const sources = new Map<KitVoice, string>();
  for (const [voice, filename] of mapping) sources.set(voice, path.join(kitDir, filename));
  for (const [voice, relative] of overrides) {
    const full = path.isAbsolute(relative) ? relative : path.join(KITS_ROOT, relative);
    if (!fs.existsSync(full)) {
      console.error(`override for '${voice}': no such sample ${full}`);
      process.exit(1);
    }
    sources.set(voice as KitVoice, full);
  }

  const samples = new Map<KitVoice, AudioBuffer>();
  for (const [voice, fullPath] of sources) {
    try {
      samples.set(voice, decodeWav(new Uint8Array(fs.readFileSync(fullPath))));
    } catch (error) {
      console.warn(`  ! ${voice}: could not decode ${fullPath} — ${(error as Error).message}`);
    }
  }

  console.log(`kit: ${kitName}`);
  for (const [voice, fullPath] of [...sources].sort()) {
    const overridden = overrides.has(voice);
    const shown = overridden ? path.relative(KITS_ROOT, fullPath) : path.basename(fullPath);
    console.log(`  ${voice.padEnd(10)} ${shown}${overridden ? "   (override)" : ""}`);
  }

  // --- groove ----------------------------------------------------------
  const catalog = parseCatalog(fs.readFileSync(path.join(EGMD_ROOT, "e-gmd-v1.0.0.csv"), "utf8"));
  const candidates = catalog.filter(
    (entry) =>
      entry.beatType === "beat" &&
      (!styleFilter || entry.style.includes(styleFilter)) &&
      fs.existsSync(path.join(EGMD_ROOT, entry.midiFilename)),
  );
  if (candidates.length === 0) {
    console.error(styleFilter ? `No takes matched style '${styleFilter}'` : "No takes found");
    process.exit(1);
  }

  const entry = candidates[0];
  const take = loadTake(new Uint8Array(fs.readFileSync(path.join(EGMD_ROOT, entry.midiFilename))), entry);

  const limbs: Limb[] = limbFilter
    ? (limbFilter.split(",").map((name) => name.trim()) as Limb[])
    : ["feet", "snare", "cymbals", "toms"];

  const from = startBar * take.beatsPerBar;
  const to = from + bars * take.beatsPerBar;
  const notes: DrumNote[] = [];
  for (const limb of limbs) {
    for (const note of notesForLimb(take, limb)) {
      if (note.beat >= from && note.beat < to) notes.push({ ...note, beat: note.beat - from });
    }
  }
  notes.sort((a, b) => a.beat - b.beat);

  console.log(`\ngroove: ${take.id}`);
  console.log(`  ${take.style} · ${take.bpm}bpm · ${take.timeSignature.numerator}/${take.timeSignature.denominator} · ${take.drummer}`);
  console.log(`  bars ${startBar}–${startBar + bars} · limbs ${limbs.join(",")} · ${notes.length} hits`);

  const feel = measureFeel(notes, bars, take.beatsPerBar);
  console.log(
    `  push ${feel.push >= 0 ? "+" : ""}${feel.push.toFixed(3)}  loose ${feel.looseness.toFixed(3)}  ` +
      `dyn ${feel.dynamics.toFixed(2)}  swing ${feel.swing.toFixed(3)}  sync ${feel.syncopation.toFixed(2)}`,
  );

  // --- render ----------------------------------------------------------
  const rendered = renderGroove(notes, samples, { bpm: take.bpm });
  normalise(rendered);

  // Surfaced rather than swallowed: a kit with no ride will render a groove
  // that is genuinely missing hits, and that should be obvious rather than
  // mistaken for a sparse performance.
  for (const [voice, count] of rendered.unmapped) {
    console.log(`  ! ${count} ${voice} hits had no sample in this kit`);
  }
  for (const [pitch, count] of rendered.unmappedPitches) {
    console.log(`  ! ${count} hits on MIDI note ${pitch} are outside the kit map and were dropped`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, encodeWav(rendered));
  const seconds = rendered.samples.length / rendered.sampleRate;
  console.log(`\nwrote ${outPath} (${seconds.toFixed(1)}s, peak ${rendered.peak.toFixed(2)})`);
}

main();
