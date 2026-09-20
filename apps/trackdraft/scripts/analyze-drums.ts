/**
 * Audio → DrumGrid transcriber — the ANALYSIS half of the drum importer
 * (the app-side runner lives in src/lib/drumImport/). Reads a song
 * blueprint for the grid it should trust (bpm, meter, section bars) and an
 * audio file, decodes with ffmpeg, transcribes kick/snare/hat per 16th
 * step, and writes the analysis JSON the importer runner consumes.
 *
 * Run:
 *   npx tsx scripts/analyze-drums.ts <song.trackdraft.json> <audio.mp3> [options]
 *
 * Options:
 *   --out <file>      output path (default: <song>.drum-analysis.json)
 *   --steps 16|12     step resolution; 16 straight, 12 triplet feel (default 16)
 *   --k <n>           onset-peak sensitivity — lower = more hits (default 6)
 *   --offset <sec>    fix the grid offset instead of fitting it
 *   --scale <x>       fix the tempo multiplier instead of fitting it
 *   --debug           print the fitted grid + first bars
 *
 * Then merge with the importer runner:
 *   npx tsx scripts/import-drum-analysis.ts <song.trackdraft.json> <analysis.json> --dry
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseAnalysisFile } from "../src/lib/drumImport/analysisFile";
import { asciiBars, LANE_NAMES, transcribe } from "./drumAnalysis/transcribe";

const SAMPLE_RATE = 22050;

interface SongLike {
  id?: string;
  title?: string;
  bpm?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenPower?: number;
  sections?: { id: string; name: string; bars: number }[];
  arrangement?: { sectionId: string; repeats?: number }[];
}

function usage(): never {
  console.error("Usage: npx tsx scripts/analyze-drums.ts <song.trackdraft.json> <audio> [--out <file>] [--steps 16|12] [--k <n>] [--offset <sec>] [--scale <x>] [--debug]");
  process.exit(1);
}

/** ffmpeg-decoded mono f32 PCM at SAMPLE_RATE — no audio npm dependencies. */
function decodeAudio(audioPath: string): Float32Array {
  const res = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
    { maxBuffer: 1 << 30 },
  );
  if (res.error) {
    console.error(`✗ could not run ffmpeg (${res.error.message}) — it must be on PATH to decode audio.`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`✗ ffmpeg exited ${res.status}: ${res.stderr?.toString().trim() ?? ""}`);
    process.exit(1);
  }
  const buf = res.stdout;
  const usable = buf.length - (buf.length % 4);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
}

interface Span { sectionId: string; startBar: number; bars: number; name: string }

/** Flat arrangement timeline: one span per section occurrence. */
function arrangementSpans(song: SongLike): { spans: Span[]; totalBars: number } {
  const byId = new Map((song.sections ?? []).map((s) => [s.id, s]));
  const spans: Span[] = [];
  let bar = 0;
  const entries = song.arrangement && song.arrangement.length > 0
    ? song.arrangement
    : (song.sections ?? []).map((s) => ({ sectionId: s.id, repeats: 1 }));
  for (const entry of entries) {
    const sec = byId.get(entry.sectionId);
    if (!sec) continue;
    const repeats = Math.max(0, Math.round(entry.repeats ?? 1));
    for (let r = 0; r < repeats; r++) {
      spans.push({ sectionId: sec.id, startBar: bar, bars: sec.bars, name: sec.name });
      bar += sec.bars;
    }
  }
  return { spans, totalBars: bar };
}

function main(): void {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--debug" || a === "--dump-onsets") {
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
  const [songPath, audioPath] = positional;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as SongLike;
  if (!Array.isArray(song.sections) || song.sections.length === 0) {
    console.error(`✗ ${songPath}: not a song blueprint (needs sections).`);
    process.exit(1);
  }
  const bpm = typeof song.bpm === "number" && song.bpm > 0 ? song.bpm : 120;
  const num = song.timeSignatureNumerator ?? 4;
  const denPower = song.timeSignatureDenPower ?? 2;
  const beatsPerBar = num * (4 / 2 ** denPower);
  const stepsPerBar = flags.has("--steps") ? Number(flags.get("--steps")) : 16;
  if (stepsPerBar !== 16 && stepsPerBar !== 12) {
    console.error("✗ --steps must be 16 (straight) or 12 (triplet feel).");
    process.exit(1);
  }

  const { spans, totalBars } = arrangementSpans(song);
  if (totalBars === 0) {
    console.error("✗ the arrangement/sections add up to zero bars.");
    process.exit(1);
  }
  const totalBeats = totalBars * beatsPerBar;

  console.log(`${song.title ?? path.basename(songPath)}  ·  ${bpm} bpm  ·  ${totalBars} bars (${totalBeats} beats)`);
  console.log(`decoding ${path.basename(audioPath)} …`);
  const samples = decodeAudio(audioPath);
  const durSec = samples.length / SAMPLE_RATE;
  console.log(`  ${durSec.toFixed(1)}s of mono ${SAMPLE_RATE} Hz audio`);

  const t0 = Date.now();
  const fixed = flags.has("--offset") || flags.has("--scale")
    ? {
        offset: flags.has("--offset") ? Number(flags.get("--offset")) : 0,
        scale: flags.has("--scale") ? Number(flags.get("--scale")) : 1,
      }
    : undefined;
  const result = transcribe(samples, {
    sampleRate: SAMPLE_RATE,
    bpm,
    beatsPerBar,
    stepsPerBar,
    totalBeats,
    peakK: flags.has("--k") ? Number(flags.get("--k")) : undefined,
    fixed,
  });
  console.log(`transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const endSec = result.offset + totalBeats * (60 / bpm) * result.scale;
  console.log(`grid: offset ${result.offset.toFixed(3)}s · tempo ×${result.scale.toFixed(4)} · spans ${result.offset.toFixed(2)}s → ${endSec.toFixed(2)}s of ${durSec.toFixed(2)}s`);
  console.log(`onsets ${result.onsets} → hits ${LANE_NAMES.map((l) => `${l} ${result.hits[l]}`).join(" · ")}`);
  if (flags.has("--dump-onsets")) {
    for (const o of result.onsetLog) {
      console.log(
        `${o.time.toFixed(3)} k=${o.body.kick.toExponential(2)} s=${o.body.snare.toExponential(2)} h=${o.body.hat.toExponential(2)}` +
        ` tk=${(o.tail.kick / (o.body.kick || 1)).toFixed(3)} ts=${(o.tail.snare / (o.body.snare || 1)).toFixed(3)}` +
        ` hilo=${(o.body.hatHi / (o.body.hatLo || 1)).toFixed(2)} lanes=${o.lanes.join("+") || "-"}`,
      );
    }
  }
  if (flags.has("--debug")) {
    console.log(`\n${asciiBars(result, 4)}`);
  }

  const analysis = {
    format: "trackdraft-drum-analysis",
    songId: song.id,
    songTitle: song.title,
    beatsPerBar,
    stepsPerBar,
    bars: Array.from({ length: result.bars }, (_, bar) => ({
      lanes: {
        kick: result.lanes.kick[bar],
        snare: result.lanes.snare[bar],
        hat: result.lanes.hat[bar],
      },
    })),
    sections: spans.map((s) => ({ sectionId: s.sectionId, startBar: s.startBar, bars: s.bars })),
    lanes: ["kick", "snare", "hat"],
  };
  // validate through the same parser the importer uses before writing
  parseAnalysisFile(analysis);

  const out = typeof flags.get("--out") === "string"
    ? String(flags.get("--out"))
    : path.join(path.dirname(songPath), path.basename(songPath).replace(/\.(trackdraft|blueprint)\.json$/i, "") + ".drum-analysis.json");
  fs.writeFileSync(out, JSON.stringify(analysis, null, 1) + "\n");
  console.log(`\n✓ wrote ${out}`);
  console.log(`  merge with: npx tsx scripts/import-drum-analysis.ts "${songPath}" "${out}" --dry`);
}

main();
