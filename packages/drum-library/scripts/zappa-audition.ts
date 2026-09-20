/**
 * Render every mined Zappa groove (and fill) into one audition MIDI so the
 * whole minted set can be heard back-to-back in any DAW — two loops of each
 * item at 100 bpm, with a marker naming its family and provenance.
 *
 *   npx tsx scripts/zappa-audition.ts [--out <file.mid>]
 *
 * Default output: ~/trackdraft-import-cache/zappa-audition.mid.
 * Coverage copies are skipped — they duplicate another item's notes.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeMidi } from "midi-file";
import { PRESET_DATA, FILL_DATA } from "../src/index.js";

const FAMILIES = [
  "78",
  "68",
  "54",
  "standard",
  "driving",
  "half_time",
  "bridge_sparse",
  "intense",
  "kick_only",
] as const;
const LOOPS = 2;
const GAP_BEATS = 2;
const PPQ = 480;

interface Item {
  label: string;
  lengthBeats: number;
  notes: Array<[number, number, number]>;
}

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0
      ? args[outIdx + 1]
      : path.join(os.homedir(), "trackdraft-import-cache", "zappa-audition.mid");

  const items: Item[] = [];
  for (const family of FAMILIES) {
    for (const variant of PRESET_DATA[family]?.variants ?? []) {
      if (variant.source.origin !== "zappa") continue;
      if (variant.source.generator?.includes("coverage copy")) continue;
      items.push({ label: `${family} · ${variant.source.generator}`, lengthBeats: variant.lengthBeats, notes: variant.notes });
    }
  }
  for (const [meter, fills] of Object.entries(FILL_DATA.acoustic)) {
    for (const fill of fills) {
      if (fill.source.origin !== "zappa") continue;
      items.push({ label: `fill ${meter} · ${fill.source.generator}`, lengthBeats: fill.lengthBeats, notes: fill.notes });
    }
  }

  const markers: Array<[number, { type: string; text: string }]> = [];
  const drumEvents: Array<[number, { type: string; channel: number; noteNumber: number; velocity: number }]> = [];
  let cursor = 0;
  for (const item of items) {
    markers.push([Math.round(cursor * PPQ), { type: "marker", text: item.label }]);
    for (let loop = 0; loop < LOOPS; loop++) {
      for (const [beat, pitch, velocity] of item.notes) {
        const tick = Math.round((cursor + loop * item.lengthBeats + beat) * PPQ);
        drumEvents.push([tick, { type: "noteOn", channel: 9, noteNumber: pitch, velocity }]);
        drumEvents.push([tick + 60, { type: "noteOff", channel: 9, noteNumber: pitch, velocity: 0 }]);
      }
    }
    cursor += item.lengthBeats * LOOPS + GAP_BEATS;
  }

  const encode = (events: Array<[number, { type: string } & Record<string, unknown>]>) => {
    events.sort((a, b) => a[0] - b[0]);
    let last = 0;
    const out: Array<Record<string, unknown>> = [];
    for (const [tick, ev] of events) {
      out.push({ ...ev, deltaTime: tick - last });
      last = tick;
    }
    out.push({ type: "endOfTrack", deltaTime: 0 });
    return out;
  };

  const conductor = encode([
    [0, { type: "setTempo", microsecondsPerBeat: 600_000 }],
    ...markers,
  ] as Array<[number, { type: string } & Record<string, unknown>]>);
  const drums = encode(drumEvents as Array<[number, { type: string } & Record<string, unknown>]>);

  const bytes = writeMidi({
    header: { format: 1, numTracks: 2, ticksPerBeat: PPQ },
    tracks: [conductor, drums] as never,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(bytes));

  console.log(`zappa-audition: ${items.length} items · ${cursor.toFixed(1)} beats ≈ ${(cursor * 0.6).toFixed(0)}s at 100 bpm`);
  for (const item of items) console.log(`  ${item.lengthBeats.toString().padStart(4)} beats · ${item.label}`);
  console.log(`\nwrote ${outPath}`);
}

main();
