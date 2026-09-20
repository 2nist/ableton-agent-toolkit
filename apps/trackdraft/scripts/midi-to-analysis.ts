/**
 * Drums MIDI → DrumGrid analysis file — the SECOND input path of the drum
 * importer (the audio path is `analyze-drums.ts`). Reads any SMF with GM
 * drum notes — Songsterr/GuitarPro-style transcriptions, vendor drum-MIDI
 * packs, Ableton's "Convert Drums to MIDI" exports — quantizes straight
 * onto the step grid, and writes the same analysis JSON the importer
 * runner consumes. MIDI already IS the grid, so there are no detection
 * heuristics here: velocity and timing come from the file.
 *
 * Run:
 *   npx tsx scripts/midi-to-analysis.ts <song.trackdraft.json> <drums.mid> [options]
 *
 * Options:
 *   --out <file>      output path (default: <song>.midi-analysis.json)
 *   --steps 16|12     step resolution; 16 straight, 12 triplet feel (default 16)
 *   --bar-offset <n>  songBar = midiBar + n — vendor files number bars from
 *                     their own first notated bar; shift them onto the song
 *   --velocity <n>    override every hit's velocity (instead of the MIDI's)
 *   --channel <n|auto> only read this MIDI channel. Default "auto": use
 *                     channel 9 (GM drums) when it carries drum notes —
 *                     full transcriptions' bass/piano collide with the GM
 *                     drum note range otherwise
 *   --toms <lane|skip> map toms (41/43/45/47/48/50) onto a lane (default skip)
 *   --tamb <lane|skip> map tambourine (54) onto a lane (default skip)
 *   --lanemap <n:lane,...> arbitrary GM note → lane mappings, e.g.
 *                         "51:hat,53:hat,59:hat" for ride cymbals
 *   --debug           print the first bars of the resulting grid
 *
 * Then merge with the importer runner:
 *   npx tsx scripts/import-drum-analysis.ts <song.trackdraft.json> <analysis.json> --dry
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseAnalysisFile } from "../src/lib/drumImport/analysisFile";
import { asciiBars, LANE_NAMES, type LaneName } from "./drumAnalysis/transcribe";
import { GM_DRUM_LANES, parseSmf, quantizeToGrid } from "./drumAnalysis/midi";
import { arrangementSpans, type SongLike } from "./drumAnalysis/song";

function usage(): never {
  console.error("Usage: npx tsx scripts/midi-to-analysis.ts <song.trackdraft.json> <drums.mid> [--out <file>] [--steps 16|12] [--bar-offset <n>] [--velocity <n>] [--channel <n|auto>] [--toms <lane|skip>] [--tamb <lane|skip>] [--lanemap <n:lane,...>] [--debug]");
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
  if (positional.length !== 2) usage();
  const [songPath, midiPath] = positional;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as SongLike;
  if (!Array.isArray(song.sections) || song.sections.length === 0) {
    console.error(`✗ ${songPath}: not a song blueprint (needs sections).`);
    process.exit(1);
  }
  const stepsPerBar = flags.has("--steps") ? Number(flags.get("--steps")) : 16;
  if (stepsPerBar !== 16 && stepsPerBar !== 12) {
    console.error("✗ --steps must be 16 (straight) or 12 (triplet feel).");
    process.exit(1);
  }
  const barOffset = flags.has("--bar-offset") ? Number(flags.get("--bar-offset")) : 0;
  const velocity = flags.has("--velocity") ? Number(flags.get("--velocity")) : undefined;
  const channelFlag = flags.has("--channel") ? String(flags.get("--channel")) : "auto";
  const asLane = (raw: string, what: string): LaneName | null => {
    if (raw === "skip") return null;
    if ((LANE_NAMES as readonly string[]).includes(raw)) return raw as LaneName;
    console.error(`✗ --${what}: "${raw}" must be kick | snare | hat | skip`);
    process.exit(1);
  };
  const tomsLane = asLane(flags.has("--toms") ? String(flags.get("--toms")) : "skip", "toms");
  const tambLane = asLane(flags.has("--tamb") ? String(flags.get("--tamb")) : "skip", "tamb");
  const laneMap: Record<number, LaneName> = {};
  if (tomsLane) for (const n of [41, 43, 45, 47, 48, 50]) laneMap[n] = tomsLane;
  if (tambLane) laneMap[54] = tambLane;
  if (flags.has("--lanemap")) {
    for (const pair of String(flags.get("--lanemap")).split(",")) {
      const [noteStr, laneStr] = pair.split(":");
      const note = Number(noteStr);
      const lane = asLane(laneStr ?? "", `lanemap ${pair}`);
      if (!Number.isInteger(note) || !lane) {
        console.error(`✗ --lanemap expects <note:lane,...> — got ${pair}`);
        process.exit(1);
      }
      laneMap[note] = lane;
    }
  }
  const num = song.timeSignatureNumerator ?? 4;
  const denPower = song.timeSignatureDenPower ?? 2;
  const beatsPerBar = num * (4 / 2 ** denPower);

  const { spans, totalBars } = arrangementSpans(song);
  if (totalBars === 0) {
    console.error("✗ the arrangement/sections add up to zero bars.");
    process.exit(1);
  }

  console.log(`${song.title ?? path.basename(songPath)}  ·  ${totalBars} bars`);
  console.log(`reading ${path.basename(midiPath)} …`);
  const smf = parseSmf(fs.readFileSync(midiPath));
  let channel: number | undefined;
  if (channelFlag !== "auto") {
    channel = Number(channelFlag);
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
      console.error(`✗ --channel: "${channelFlag}" must be 0-15 or auto`);
      process.exit(1);
    }
  } else if (smf.notes.some((n) => n.channel === 9 && GM_DRUM_LANES[n.note])) {
    channel = 9; // GM drum channel carries the kit — melodic channels would collide with the map
  }
  console.log(`  SMF format ${smf.format} · division ${smf.division} ppq · ${smf.notes.length} note-ons${channel !== undefined ? ` · reading channel ${channel}` : " · reading all channels"}`);
  if (tomsLane || tambLane) {
    const extras = [tomsLane ? `toms→${tomsLane}` : null, tambLane ? `tambourine→${tambLane}` : null].filter(Boolean).join(" · ");
    console.log(`  extra mappings: ${extras}`);
  }

  const q = quantizeToGrid(smf.notes, smf.division, stepsPerBar, barOffset, { channel, laneMap });
  const droppedBars = Math.max(0, q.bars - totalBars);

  const lanes = {} as Record<(typeof LANE_NAMES)[number], number[][]>;
  const hits = { kick: 0, snare: 0, hat: 0 } as Record<(typeof LANE_NAMES)[number], number>;
  for (const lane of LANE_NAMES) {
    lanes[lane] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const row = q.lanes[lane][bar] ?? new Array<number>(stepsPerBar).fill(0);
      const out = velocity !== undefined ? row.map((v) => (v > 0 ? velocity : 0)) : row.slice();
      for (const v of out) if (v > 0) hits[lane]++;
      lanes[lane].push(out);
    }
  }

  const unmapped = Object.entries(q.unmapped).sort((a, b) => b[1] - a[1]);
  console.log(`hits ${LANE_NAMES.map((l) => `${l} ${hits[l]}`).join(" · ")}  (of ${q.mapped} mapped note-ons)`);
  if (q.beforeStart > 0) console.log(`  dropped ${q.beforeStart} notes before bar 0 (with --bar-offset ${barOffset})`);
  if (droppedBars > 0) console.log(`  dropped ${droppedBars} bar(s) beyond the arrangement (bar ${totalBars}+)`);
  if (unmapped.length > 0) {
    console.log(`  ignored non-drum notes: ${unmapped.map(([n, c]) => `${n}×${c}`).join(" ")}`);
  }

  const analysis = {
    format: "trackdraft-drum-analysis",
    songId: song.id,
    songTitle: song.title,
    beatsPerBar,
    stepsPerBar,
    bars: Array.from({ length: totalBars }, (_, bar) => ({
      lanes: {
        kick: lanes.kick[bar],
        snare: lanes.snare[bar],
        hat: lanes.hat[bar],
      },
    })),
    sections: spans.map((s) => ({ sectionId: s.sectionId, startBar: s.startBar, bars: s.bars })),
    lanes: ["kick", "snare", "hat"],
  };
  // validate through the same parser the importer uses before writing
  parseAnalysisFile(analysis);

  if (flags.has("--debug")) {
    console.log(`\n${asciiBars({ bars: totalBars, lanes }, 4)}`);
  }

  const out = typeof flags.get("--out") === "string"
    ? String(flags.get("--out"))
    : path.join(path.dirname(songPath), path.basename(songPath).replace(/\.(trackdraft|blueprint)\.json$/i, "") + ".midi-analysis.json");
  fs.writeFileSync(out, JSON.stringify(analysis, null, 1) + "\n");
  console.log(`\n✓ wrote ${out}`);
  console.log(`  merge with: npx tsx scripts/import-drum-analysis.ts "${songPath}" "${out}" --dry`);
}

main();
