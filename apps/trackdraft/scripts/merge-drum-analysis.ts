/**
 * Merge N drum-analysis files into one consensus grid — the AVERAGING pass
 * of the drum importer. Feed it every transcription you have of the same
 * song (demucs stem, full mix, another take, a drum MIDI, Ableton's
 * converter…) and it keeps the cells that enough sources agree on, at the
 * mean velocity. Single-source noise falls out; the consensus IS the
 * canonical pattern the euclid translation wants.
 *
 * Run:
 *   npx tsx scripts/merge-drum-analysis.ts <song.trackdraft.json> <out.json> <a.json> <b.json> [...] [options]
 *
 * Options:
 *   --min-votes <n>  sources that must agree on a cell (default 2;
 *                    1 = union with averaged velocities, keeps detail)
 *   --debug          print the first bars of the merged grid
 *
 * Then merge with the importer runner:
 *   npx tsx scripts/import-drum-analysis.ts <song.trackdraft.json> <out.json> --dry
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseAnalysisFile } from "../src/lib/drumImport/analysisFile";
import { mergeAnalyses } from "../src/lib/drumImport/mergeAnalyses";
import { asciiBars } from "./drumAnalysis/transcribe";

function usage(): never {
  console.error("Usage: npx tsx scripts/merge-drum-analysis.ts <song.trackdraft.json> <out.json> <a.json> <b.json> [...] [--min-votes <n>] [--debug]");
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--debug") {
      flags.set(a, true);
    } else if (a.startsWith("--")) {
      const v = args[++i];
      if (v === undefined) usage();
      flags.set(a, v);
    } else {
      positional.push(a);
    }
  }
  if (positional.length < 4) usage();
  const [songPath, outPath, ...sourcePaths] = positional;
  const minVotes = flags.has("--min-votes") ? Number(flags.get("--min-votes")) : 2;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as { id?: string; title?: string };
  const sources = sourcePaths.map((p) => {
    const parsed = parseAnalysisFile(JSON.parse(fs.readFileSync(p, "utf8")));
    return { path: p, parsed };
  });
  const ids = new Set(sources.map((s) => s.parsed.songId).filter((v): v is string => typeof v === "string"));
  if (song.id && ids.size > 0 && !ids.has(song.id)) {
    console.error(`⚠ sources were made for ${[...ids].join(", ")} — this song is ${song.id}`);
  }

  console.log(`${song.title ?? path.basename(songPath)}  ←  ${sources.length} sources, min-votes ${minVotes}`);
  sources.forEach((s, i) => console.log(`  [${i + 1}] ${path.basename(s.path)}`));

  const { analysis, stats } = mergeAnalyses(sources.map((s) => s.parsed), { minVotes });
  parseAnalysisFile(analysis); // validate the output shape before writing

  const laneSummary = Object.entries(stats.perLane)
    .map(([lane, s]) => `${lane} ${s.kept}/${s.kept + s.dropped}`)
    .join(" · ");
  console.log(`cells kept ${stats.kept} · dropped (under ${minVotes} vote${minVotes === 1 ? "" : "s"}) ${stats.dropped}`);
  console.log(`  ${laneSummary}   (kept/candidates per lane)`);
  console.log(`  source hits: ${stats.sourceHits.join(" · ")}`);

  if (flags.has("--debug")) {
    const gridLanes = {
      kick: analysis.bars.map((b) => b.lanes.kick ?? []),
      snare: analysis.bars.map((b) => b.lanes.snare ?? []),
      hat: analysis.bars.map((b) => b.lanes.hat ?? []),
    };
    console.log(`\n${asciiBars({ bars: analysis.bars.length, lanes: gridLanes }, 4)}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(analysis, null, 1) + "\n");
  console.log(`\n✓ wrote ${outPath}`);
  console.log(`  merge with: npx tsx scripts/import-drum-analysis.ts "${songPath}" "${outPath}" --dry`);
}

main();
