/**
 * Render an extracted groove as a text grid, so a human can confirm it's
 * actually music before anything downstream trusts it.
 *
 * This exists because the previous library's numbers looked fine in
 * aggregate while every pattern in it was unplayable. Summary statistics
 * cannot tell you that; looking at the notes can.
 *
 * Run:
 *   npx tsx scripts/inspect.ts                      # first indexed take
 *   npx tsx scripts/inspect.ts --style funk --bars 2
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCatalog } from "../src/catalog.js";
import { loadTake } from "../src/take.js";
import { notesForLimb } from "../src/segment.js";
import { measureFeel } from "../src/features.js";
import { limbOf } from "../src/limbs.js";
import type { DrumNote, Limb, Take } from "../src/types.js";

const EGMD_ROOT =
  process.env.EGMD_ROOT ??
  "/Users/Matthew/Datasets/e-gmd-v1.0.0";

/** Voices worth showing on their own row, in the order a kit is usually written. */
const ROWS: { label: string; limb: Limb; match: (pitch: number) => boolean }[] = [
  { label: "crash ", limb: "cymbals", match: (p) => p === 49 || p === 52 || p === 55 || p === 57 },
  { label: "ride  ", limb: "cymbals", match: (p) => p === 51 || p === 53 || p === 59 },
  { label: "hat   ", limb: "cymbals", match: (p) => p === 22 || p === 26 || p === 42 || p === 46 },
  { label: "snare ", limb: "snare", match: () => true },
  { label: "tom   ", limb: "toms", match: () => true },
  { label: "kick  ", limb: "feet", match: (p) => p === 35 || p === 36 },
  { label: "hatped", limb: "feet", match: (p) => p === 44 },
];

function main(): void {
  const argv = process.argv.slice(2);
  const styleFilter = argv.includes("--style") ? argv[argv.indexOf("--style") + 1] : null;
  const bars = argv.includes("--bars") ? Number.parseInt(argv[argv.indexOf("--bars") + 1], 10) : 2;
  const startBar = argv.includes("--start") ? Number.parseInt(argv[argv.indexOf("--start") + 1], 10) : 0;

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

  console.log(`${take.id}`);
  console.log(
    `${take.style} · ${take.bpm}bpm · ${take.timeSignature.numerator}/${take.timeSignature.denominator} · ${take.drummer} · ${take.kitName}`,
  );
  console.log(`${take.notes.length} notes\n`);

  render(take, startBar, bars);
}

/**
 * One column per 16th note. `#` is an accent, `+` a normal hit, `.` a ghost
 * note — velocity has to be visible, because ghost notes are most of what
 * separates a human take from a programmed one.
 */
function render(take: Take, startBar: number, bars: number): void {
  const beatsPerBar = take.beatsPerBar;
  const from = startBar * beatsPerBar;
  const to = from + bars * beatsPerBar;
  const columns = Math.round(bars * beatsPerBar * 4);

  const header = Array.from({ length: columns }, (_, i) => (i % 4 === 0 ? "|" : " ")).join("");
  console.log(`      ${header}`);

  for (const row of ROWS) {
    const cells = new Array<string>(columns).fill("·");
    let used = false;
    for (const note of take.notes) {
      if (note.beat < from || note.beat >= to) continue;
      if (limbOf(note.pitch) !== row.limb || !row.match(note.pitch)) continue;
      const column = Math.round((note.beat - from) * 4);
      if (column < 0 || column >= columns) continue;
      cells[column] = note.velocity >= 100 ? "#" : note.velocity >= 55 ? "+" : ".";
      used = true;
    }
    if (used) console.log(`${row.label}${cells.join("")}`);
  }

  console.log("\n      # accent   + hit   . ghost   | bar/beat line\n");

  for (const limb of ["feet", "snare", "cymbals", "toms"] as Limb[]) {
    const notes = windowed(notesForLimb(take, limb), from, to);
    if (notes.length === 0) continue;
    const f = measureFeel(notes, bars, beatsPerBar);
    console.log(
      `${limb.padEnd(8)} push ${f.push >= 0 ? "+" : ""}${f.push.toFixed(3)}  loose ${f.looseness.toFixed(3)}  ` +
        `dyn ${f.dynamics.toFixed(2)}  dens ${f.density.toFixed(1)}  swing ${f.swing.toFixed(3)}  ` +
        `sync ${f.syncopation.toFixed(2)}  motion ${f.motion.toFixed(2)}`,
    );
  }
}

function windowed(notes: DrumNote[], from: number, to: number): DrumNote[] {
  return notes.filter((n) => n.beat >= from && n.beat < to).map((n) => ({ ...n, beat: n.beat - from }));
}

main();
