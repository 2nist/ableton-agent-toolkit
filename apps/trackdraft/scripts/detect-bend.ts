/**
 * detect-bend.ts — attach analysis-derived Bend ratings to a song JSON.
 *
 * Usage:
 *   npx tsx scripts/detect-bend.ts <song.trackdraft.json>
 *       [--drums <drums-profile.json>] [--bass <bass-profile.json>]
 *       [--out <output.json>]
 *
 * Runs `detectBendRatings` (chords always; drums/bass when profiles are
 * given), writes `detected` into the song file (in place unless --out)
 * and prints the rating table. Re-import the song in TrackDraft and the
 * Mix/Bend station shows the ratings as ghost markers with adopt.
 */

import * as fs from "node:fs";
import { detectBendRatings } from "../src/lib/style/detectBend";
import type { BlueprintSong } from "../src/types/blueprint";

const AXIS_ORDER: Array<keyof NonNullable<BlueprintSong["detected"]>> = [
  "energy", "density", "backbeat", "feel", "kit",
  "harmony", "tension", "articulation", "melodyContour",
  "bassRegister", "bassMotion", "bassRhythm", "bassVelocity",
];

function parseArgs() {
  const args = process.argv.slice(2);
  let songPath = "";
  let drums: string | undefined;
  let bass: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--drums" && i + 1 < args.length) { drums = args[++i]; }
    else if (args[i] === "--bass" && i + 1 < args.length) { bass = args[++i]; }
    else if (args[i] === "--out" && i + 1 < args.length) { out = args[++i]; }
    else if (!songPath) { songPath = args[i]; }
  }
  if (!songPath) {
    console.error("Usage: npx tsx scripts/detect-bend.ts <song.trackdraft.json> [--drums <drums-profile.json>] [--bass <bass-profile.json>] [--out <file>]");
    process.exit(1);
  }
  return { songPath, drums, bass, out };
}

function loadJson(p?: string): unknown {
  if (!p) return undefined;
  if (!fs.existsSync(p)) {
    console.warn(`Warning: profile not found: ${p}`);
    return undefined;
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const { songPath, drums, bass, out } = parseArgs();
  if (!fs.existsSync(songPath)) {
    console.error(`Song not found: ${songPath}`);
    process.exit(1);
  }

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as BlueprintSong;
  const detected = detectBendRatings(song, {
    drums: loadJson(drums) as never,
    bass: loadJson(bass) as never,
  });

  const keys = Object.keys(detected);
  if (keys.length === 0) {
    console.log("No ratings derivable — the song has no chords and no profiles were given.");
    process.exit(0);
  }

  song.detected = detected;
  const outPath = out ?? songPath;
  fs.writeFileSync(outPath, JSON.stringify(song, null, 2));

  console.log(`\n=== DETECTED BEND RATINGS: ${song.title} ===`);
  console.log(`sources: chords${drums ? " + drums profile" : ""}${bass ? " + bass profile" : ""}`);
  for (const axis of AXIS_ORDER) {
    const v = detected[axis];
    if (v != null) {
      const bar = "█".repeat(Math.round(v * 20)).padEnd(20, "·");
      console.log(`  ${String(axis).padEnd(14)} ${v.toFixed(2)}  ${bar}`);
    }
  }
  const missing = AXIS_ORDER.filter((a) => detected[a] == null);
  if (missing.length > 0) {
    console.log(`  (not detected: ${missing.join(", ")} — see detectBend.ts docstring)`);
  }
  console.log(`\n✅ Written: ${outPath}`);
  console.log("Re-import the song in TrackDraft to see ◆ markers in Mix/Bend.");
}

main();
