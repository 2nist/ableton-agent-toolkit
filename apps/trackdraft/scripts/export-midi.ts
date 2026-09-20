/**
 * Blueprint → Standard MIDI File, from the command line — the audition
 * path for reviewing a fix. Renders any `.trackdraft.json` with the same
 * six stems the app's "Export MIDI" produces (conductor, chords, bass,
 * drums, color, melody), so a repaired drum track can be heard IN CONTEXT
 * against the chord/bass tracks: drop the .mid into Ableton and listen.
 *
 * Run:
 *   npx tsx scripts/export-midi.ts <song.trackdraft.json> [--out <file.mid>]
 */
import * as fs from "node:fs";
import { songToMidi } from "../src/lib/midiExport";
import type { BlueprintSong } from "../src/types/blueprint";

function usage(): never {
  console.error("Usage: npx tsx scripts/export-midi.ts <song.trackdraft.json> [--out <file.mid>]");
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") out = args[++i];
    else if (a.startsWith("--")) usage();
    else positional.push(a);
  }
  if (positional.length !== 1 || (out !== undefined && !out)) usage();
  const [songPath] = positional;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as BlueprintSong;
  const bytes = songToMidi(song);
  const outPath = out ?? songPath.replace(/\.(trackdraft|blueprint)\.json$/i, "") + ".mid";
  fs.writeFileSync(outPath, bytes);
  console.log(`✓ wrote ${outPath} — ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)} KB)`);
  console.log(`  stems: conductor · chords · bass · drums · color · melody — drop it into Ableton to audition.`);
}

main();
