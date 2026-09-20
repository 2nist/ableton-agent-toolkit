/**
 * Merges a drum analysis into a .blueprint.json — the whole-catalog path of
 * the importer. The UI imports one section at a time (the selected one, into
 * the drums draft store); this does the whole song in one pass: read the
 * song blueprint + an analysis file (see src/lib/drumImport/analysisFile.ts
 * for the format), run the SAME converter the app runs (gridToBlocks →
 * toSectionPatch, with the real euclidOnsetSteps), and write a new blueprint
 * with the imported `drumBlocks` merged onto the matched sections.
 *
 * The written file round-trips through the app's "Import .json" unchanged —
 * everything the analysis doesn't touch (chords, lyrics, harmony, melody,
 * arrangement) is left byte-identical, and each imported section keeps its
 * non-drum fields while the drum authoring is replaced by the analysis.
 *
 * Run:
 *   npx tsx scripts/import-drum-analysis.ts <song.blueprint.json> <analysis.json> [options]
 *
 * Options:
 *   --out <file>         output path (default: <song>.drums.blueprint.json)
 *   --dry                print the per-section report, write nothing
 *   --force              merge even when the analysis names a different song
 *   --lanes a,b,c        lanes to import (default: the file's, else kick,snare,hat)
 *   --fill euclid|motion fill encoding (default: the file's, else euclid)
 *   --base <pattern>     opt into a legacy base pattern (default: the file's, else none)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_LANES, type DrumLaneId } from "@drum/library";
import { DRUM_PATTERN_NAMES, parseAnalysisFile } from "../src/lib/drumImport/analysisFile";
import { mergeAnalysisIntoSong } from "../src/lib/drumImport/runner";
import type { BlueprintSong, DrumPattern } from "../src/types/blueprint";

function usage(): never {
  console.error("Usage: npx tsx scripts/import-drum-analysis.ts <song.blueprint.json> <analysis.json> [--out <file>] [--dry] [--force] [--lanes a,b] [--fill euclid|motion] [--base <pattern>]");
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry" || a === "--force") {
      flags.set(a, true);
    } else if (a.startsWith("--")) {
      const v = args[++i];
      if (v === undefined) usage();
      flags.set(a, v);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) usage();
  const [songPath, analysisPath] = positional;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as BlueprintSong;
  if (typeof song !== "object" || song === null || !Array.isArray(song.sections)) {
    console.error(`✗ ${songPath}: not a song blueprint (needs a "sections" array).`);
    process.exit(1);
  }
  const file = parseAnalysisFile(JSON.parse(fs.readFileSync(analysisPath, "utf8")));

  // CLI overrides mirror the analysis file's own optional fields.
  if (flags.has("--lanes")) {
    const lanes = String(flags.get("--lanes")).split(",").map((s) => s.trim()).filter(Boolean);
    for (const l of lanes) {
      if (!(ALL_LANES as readonly string[]).includes(l)) {
        console.error(`✗ --lanes: "${l}" is not a lane (valid: ${ALL_LANES.join(", ")})`);
        process.exit(1);
      }
    }
    file.lanes = lanes as DrumLaneId[];
  }
  if (flags.has("--fill")) {
    const v = String(flags.get("--fill"));
    if (v !== "euclid" && v !== "motion") {
      console.error(`✗ --fill must be "euclid" or "motion"`);
      process.exit(1);
    }
    file.fillEncoding = v;
  }
  if (flags.has("--base")) {
    const v = String(flags.get("--base"));
    if (!(DRUM_PATTERN_NAMES as readonly string[]).includes(v)) {
      console.error(`✗ --base: "${v}" is not a pattern (valid: ${DRUM_PATTERN_NAMES.join(", ")})`);
      process.exit(1);
    }
    file.basePattern = v as DrumPattern;
  }

  if (file.songId !== undefined && song.id !== file.songId && !flags.has("--force")) {
    console.error(`✗ analysis is for "${file.songId}" but the blueprint is "${song.id}" — pass --force to merge anyway.`);
    process.exit(1);
  }

  const { song: merged, results, warnings } = mergeAnalysisIntoSong(song, file);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);

  console.log(`\n${path.basename(songPath)}  ←  ${path.basename(analysisPath)}`);
  console.log(`  ${results.length}/${song.sections.length} sections matched\n`);
  for (const r of results) {
    const st = r.report.stats;
    const transitions = r.report.transitions.map((t) => `${t.gesture}@${t.startBeat}`).join(" · ");
    console.log(
      `  ${r.sectionName.padEnd(18)} ${String(r.patch.drumBlocks.length).padStart(3)} blocks · ${st.euclidBlocks} euclid · ${st.stepsBlocks} steps · ${st.clearBlocks} clear` +
      `${st.motionBlocks > 0 ? ` · ${st.motionBlocks} motion` : ""} · vel ${r.patch.velocity}${transitions ? ` · ${transitions}` : ""}`,
    );
  }

  if (flags.has("--dry")) {
    console.log("\n(dry run — nothing written)");
    return;
  }
  if (results.length === 0) {
    console.error("\n✗ no sections matched — nothing written.");
    process.exit(1);
  }

  const out = typeof flags.get("--out") === "string"
    ? String(flags.get("--out"))
    : songPath.replace(/\.blueprint\.json$/i, "") + ".drums.blueprint.json";
  const next = { ...merged, updatedAt: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(next, null, 2) + "\n");
  console.log(`\n✓ wrote ${out}`);
}

main();
