/**
 * Chord-track repair — tile the chord durations to the section frame the
 * drums and structure already lead.
 *
 * The catalog's chord tracks routinely stop short of their sections (jcrd
 * annotations omit final repeats / coarse beat rounding): 821 of 1459
 * chord-bearing sections end >3 beats early, which the documented
 * `snapProgressionToGrid` policy (≤3-beat tail) doesn't cover. Left as-is,
 * chord playback loops the progression to fill, restarting the cycle
 * under the section-end fills; the fix is to HOLD the last annotated
 * chord through the tail — bar-aligned, so at most the policy's ≤3-beat
 * rest remains where the annotation genuinely ends mid-bar.
 *
 * Surgical by construction: only the last chord's `beats` changes; roots,
 * qualities, roman numerals, structure, bars and arrangement are untouched.
 *
 * Run:
 *   npx tsx scripts/repair-chord-tracks.ts [--dir scripts/output/catalog] [--dry-run]
 */
import * as fs from "node:fs";
import * as path from "node:path";

interface Chord { id: string; root: string; quality: string; romanNumeral?: string; beats: number }
interface Section {
  id: string; name: string; bars: number;
  timeSignatureNumerator?: number; timeSignatureDenPower?: number;
  chords: Chord[];
}
interface Song { id?: string; title?: string; sections: Section[] }

function usage(): never {
  console.error("Usage: npx tsx scripts/repair-chord-tracks.ts [--dir scripts/output/catalog] [--dry-run]");
  process.exit(1);
}

function beatsPerBar(s: Section): number {
  return (s.timeSignatureNumerator ?? 4) * (4 / 2 ** (s.timeSignatureDenPower ?? 2));
}

function main(): void {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--dir");
  const dir = dirFlag >= 0 && args[dirFlag + 1] ? String(args[dirFlag + 1]) : "scripts/output/catalog";
  const dryRun = args.includes("--dry-run");
  for (const a of args) if (a.startsWith("--") && a !== "--dir" && a !== "--dry-run") usage();

  if (!fs.existsSync(dir)) usage();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".trackdraft.json")).sort();
  let songsTouched = 0;
  let sectionsPadded = 0;
  let beatsAdded = 0;
  const examples: string[] = [];

  for (const f of files) {
    const filePath = path.join(dir, f);
    const song = JSON.parse(fs.readFileSync(filePath, "utf8")) as Song;
    let touched = false;
    for (const s of song.sections ?? []) {
      if (!s.chords || s.chords.length === 0) continue;
      const total = s.chords.reduce((sum, c) => sum + Math.max(0, Math.round(c.beats)), 0);
      const gap = s.bars * beatsPerBar(s) - total;
      if (gap <= 3) continue; // policy tail (or exact) — leave it
      const pad = gap - (gap % 4); // bar-aligned: hold the last chord
      if (pad <= 0) continue;
      const last = s.chords[s.chords.length - 1];
      last.beats = Math.round(last.beats) + pad;
      sectionsPadded++;
      beatsAdded += pad;
      touched = true;
      if (examples.length < 10) {
        examples.push(`  ${f.replace(".trackdraft.json", "")} · "${s.name}": gap ${gap} → hold ${last.root}${last.quality} +${pad} beats`);
      }
    }
    if (touched) {
      songsTouched++;
      if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(song, null, 2));
    }
  }

  console.log(`${dryRun ? "[dry-run] " : ""}chord-track repair over ${files.length} songs`);
  console.log(`  songs touched ${songsTouched} · sections padded ${sectionsPadded} · beats held ${beatsAdded}`);
  if (examples.length > 0) {
    console.log("  examples:");
    for (const e of examples) console.log(e);
  }
  if (dryRun) console.log("  (nothing written — rerun without --dry-run)");
}

main();
