/**
 * Scan a folder of full-band MIDI arrangements (Frank Zappa set) for
 * usable drum material — and report what else each file carries.
 *
 *   npx tsx scripts/zappa-scan.ts [dir] [--out data/zappa-scan.json]
 *
 * Unlike the E-GMD pipeline (one performance per file, drum-only), these
 * are complete arrangements: drums live on channel 9 when the file follows
 * GM, sometimes on a named track instead (Zappa's "Black Page" — the drum
 * feature — has no ch9 at all). They also *shift meter* constantly
 * (Echidna's Arf runs 4/4 → 21/16 → 11/16 → 13/16 → 9/16; Watermelon in
 * Easter Hay is a single 9/4). The scan:
 *
 *  - reads the SMF timeSignature events and slices drum material into bars
 *    of the then-current meter (16th grid scaled per bar),
 *  - locates the drum track (ch9 preferred, else a track named like drums),
 *  - ranks the recurring bar patterns per meter (the "order" in each tune),
 *  - detects fill candidates: snare/tom-heavy bars outside the groove plus
 *    novel dense bars, flagging fills that land on a crash,
 *  - measures feel via the library's own `measureFeel` (4/4-dominant tunes),
 *  - inventories every other track (name, channel, notes, bars) so we can
 *    see what else is extractable: bass lines, chord stabs, keys.
 *
 * Writes `data/zappa-scan.json` for the next step (curating grooves/fills
 * into the variant pool / audition exports).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseMidi } from "midi-file";
import { measureFeel } from "../src/features.js";
import type { DrumNote } from "../src/types.js";

const DEFAULT_DIR = path.join(import.meta.dirname, "..", "..", "..", "data", "ZAPPA");
/** Bars are sliced on a 16th grid: a bar of length L quarter-beats gets
 *  round(L × 4) steps (4/4 → 16, 7/8 → 14, 21/16 → 21, 9/4 → 36). */
const STEPS_PER_QUARTER = 4;

type LaneId = "kick" | "snare" | "hat" | "openhat" | "ride" | "crash" | "toms" | "perc";
const LANE_OF: Record<number, LaneId> = {
  35: "kick", 36: "kick",
  37: "snare", 38: "snare", 39: "snare", 40: "snare",
  42: "hat", 44: "hat",
  46: "openhat",
  51: "ride", 53: "ride", 59: "ride",
  49: "crash", 57: "crash",
  41: "toms", 43: "toms", 45: "toms", 47: "toms", 48: "toms", 50: "toms",
  54: "perc", 56: "perc", 60: "perc", 61: "perc", 62: "perc", 64: "perc", 65: "perc", 66: "perc", 67: "perc", 68: "perc", 69: "perc", 70: "perc", 71: "perc", 72: "perc", 73: "perc", 74: "perc", 75: "perc", 76: "perc", 77: "perc", 78: "perc", 79: "perc", 80: "perc", 81: "perc",
};

interface TrackInfo {
  index: number;
  name: string;
  channels: number[];
  notes: number;
  /** Drum-lane note counts when this is the drum track. */
  laneCounts?: Partial<Record<LaneId, number>>;
}

/** One meter span from SMF timeSignature events (midi-file reports real
 *  denominators: 4 = quarter, 8 = eighth, 16 = sixteenth). */
interface MeterSpan {
  startBeat: number;
  beatsPerBar: number;
  meter: string;
}

/** A single bar of the arrangement under its then-current meter. */
interface BarSpan {
  index: number;
  startBeat: number;
  lenBeats: number;
  steps: number;
  meter: string;
}

interface PatternInfo {
  meter: string;
  beats: number;
  steps: number;
  key: string;
  bars: number;
  notes: Array<[number, number, number]>;
}

interface FillInfo {
  meter: string;
  beats: number;
  steps: number;
  key: string;
  count: number;
  snareTomShare: number;
  /** True when at least one occurrence is followed by a bar opening on a crash. */
  landsOnCrash: boolean;
  notes: Array<[number, number, number]>;
}

interface PatternGroup {
  meter: string;
  beats: number;
  steps: number;
  key: string;
  count: number;
  firstBar: number;
}

interface ScanEntry {
  file: string;
  title: string;
  bars: number;
  tempoBpm: number | null;
  drumSource: string | null; // "ch9" | "track:NAME" | null (none found)
  drumHits: number;
  /** Notes on the drum track whose pitches fall outside the GM lane map
   *  (some transcriptions use non-standard drum numbering). */
  drumUnmapped: number;
  lanes: Partial<Record<LaneId, number>>;
  feel: { density: number; swing: number; syncopation: number } | null;
  /** The time signatures this arrangement passes through, in order of appearance. */
  meters: string[];
  /** Bar counts per meter. */
  meterBars: Record<string, number>;
  /** Recurring one-bar drum patterns, top 3 per meter, most bars first.
   *  `notes` is one representative bar of that shape (positions relative to
   *  the bar), ready to become a PackedVariant. */
  topPatterns: PatternInfo[];
  /** Fill candidates: snare/tom-heavy bars outside the groove, plus novel
   *  dense bars (one-off fills). Capped at 12, most recurring first. */
  fills: FillInfo[];
  tracks: TrackInfo[];
}

function tickToBeatStarts(midi: ReturnType<typeof parseMidi>): {
  perTrack: Array<{ name: string; channels: Set<number>; notes: DrumNote[] }>;
  ticksPerBeat: number;
  tempoBpm: number | null;
} {
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;
  let tempoBpm: number | null = null;
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === "setTempo") {
        tempoBpm = 60000000 / event.microsecondsPerBeat;
        break;
      }
    }
    if (tempoBpm) break;
  }
  const perTrack = midi.tracks.map((track) => {
    let ticks = 0;
    let name = "";
    const notes: DrumNote[] = [];
    const channels = new Set<number>();
    for (const event of track) {
      ticks += event.deltaTime;
      if (event.type === "trackName") name = event.text;
      if (event.type === "noteOn" && event.velocity > 0) {
        channels.add(event.channel);
        notes.push({ beat: ticks / ticksPerBeat, pitch: event.noteNumber, velocity: event.velocity });
      }
    }
    return { name, channels, notes };
  });
  return { perTrack, ticksPerBeat, tempoBpm };
}

/** Collect meter events (conductor track preferred; falls back to the first
 *  track that has any; default 4/4 when the file carries none). Consecutive
 *  re-statements of the same signature collapse into one span. */
function meterSpansOf(midi: ReturnType<typeof parseMidi>): MeterSpan[] {
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;
  const read = (track: (typeof midi.tracks)[number]): MeterSpan[] => {
    let ticks = 0;
    const spans: MeterSpan[] = [];
    for (const event of track) {
      ticks += event.deltaTime;
      if (event.type === "timeSignature") {
        spans.push({
          startBeat: ticks / ticksPerBeat,
          beatsPerBar: event.numerator * (4 / event.denominator),
          meter: `${event.numerator}/${event.denominator}`,
        });
      }
    }
    return spans;
  };
  let raw: MeterSpan[] = midi.tracks.length > 0 ? read(midi.tracks[0]) : [];
  if (raw.length === 0) {
    for (const track of midi.tracks) {
      raw = read(track);
      if (raw.length > 0) break;
    }
  }
  const spans: MeterSpan[] = [];
  for (const s of raw) {
    const prev = spans[spans.length - 1];
    if (prev && prev.meter === s.meter) continue; // no-op re-statement
    spans.push(s);
  }
  if (spans.length === 0 || spans[0].startBeat > 0.01) {
    spans.unshift({ startBeat: 0, beatsPerBar: 4, meter: "4/4" });
  }
  return spans;
}

/** Slice [0, maxBeat] into bars following the meter spans. A meter change
 *  mid-bar truncates that bar (misaligned transcriptions exist); slivers
 *  under half a beat are dropped. */
function barSpans(meterSpans: MeterSpan[], maxBeat: number): BarSpan[] {
  const bars: BarSpan[] = [];
  for (let i = 0; i < meterSpans.length; i++) {
    const span = meterSpans[i];
    const spanEnd = Math.min(
      i + 1 < meterSpans.length ? meterSpans[i + 1].startBeat : Infinity,
      maxBeat + 0.01,
    );
    let cursor = span.startBeat;
    while (cursor < spanEnd - 0.01) {
      const lenBeats = Math.min(span.beatsPerBar, spanEnd - cursor);
      if (lenBeats < 0.5) break;
      const steps = Math.max(1, Math.round(lenBeats * STEPS_PER_QUARTER));
      bars.push({ index: bars.length, startBeat: cursor, lenBeats, steps, meter: span.meter });
      cursor += span.beatsPerBar;
    }
  }
  return bars;
}

/** Bucket drum notes into bars (single pass; both sequences are in beat order). */
function notesByBar(bars: BarSpan[], notes: DrumNote[]): DrumNote[][] {
  const out: DrumNote[][] = bars.map(() => []);
  let bi = 0;
  for (const n of notes) {
    if (!LANE_OF[n.pitch]) continue;
    while (bi < bars.length && n.beat >= bars[bi].startBeat + bars[bi].lenBeats - 0.001) bi++;
    if (bi >= bars.length) break;
    if (n.beat >= bars[bi].startBeat - 0.05) out[bi].push(n);
  }
  return out;
}

/** Fold one bar's notes into a 16th-step lane token: `kick@0,snare@4,...`. */
function barToken(bar: BarSpan, notes: DrumNote[]): string {
  const set = new Set<string>();
  for (const n of notes) {
    const lane = LANE_OF[n.pitch];
    if (!lane) continue;
    const off = n.beat - bar.startBeat;
    if (off < -0.05 || off >= bar.lenBeats - 0.001) continue;
    const step = Math.max(0, Math.round((off / bar.lenBeats) * bar.steps)) % bar.steps;
    set.add(`${lane}@${step}`);
  }
  return [...set].sort().join(",");
}

/**
 * Fill candidates for one arrangement:
 *  - bars where snare+toms carry ≥55% of the hits (fill vocabulary) and the
 *    bar is not one of the meter's top-2 groove bars, OR
 *  - novel dense bars (unique token, ≥1.5× the median bar's hits, ≥30%
 *    snare/toms) — one-off fills that never repeat.
 * A fill that is followed by a bar opening on a crash is flagged: that's
 * the money shot for auditioning.
 */
function computeFills(bars: BarSpan[], buckets: DrumNote[][], tokens: string[]): FillInfo[] {
  interface Acc {
    meter: string;
    beats: number;
    steps: number;
    token: string;
    count: number;
    snareTom: number;
    hits: number;
    firstBar: number;
    crashBar: number;
  }
  const tokenCount = new Map<string, number>();
  for (const t of tokens) if (t) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
  // Groove tokens: top-2 most common per meter.
  const meterTokens = new Map<string, Map<string, number>>();
  bars.forEach((bar, i) => {
    const t = tokens[i];
    if (!t) return;
    let m = meterTokens.get(bar.meter);
    if (!m) meterTokens.set(bar.meter, (m = new Map()));
    m.set(t, (m.get(t) ?? 0) + 1);
  });
  const groove = new Map<string, Set<string>>();
  for (const [meter, m] of meterTokens) {
    groove.set(
      meter,
      new Set(
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([t]) => t),
      ),
    );
  }
  const hitCounts = buckets.map((n) => n.length).filter((n) => n > 0).sort((a, b) => a - b);
  const medianHits = hitCounts.length ? hitCounts[Math.floor(hitCounts.length / 2)] : 0;

  const acc = new Map<string, Acc>();
  bars.forEach((bar, i) => {
    const notes = buckets[i];
    const token = tokens[i];
    if (!token || notes.length < 4) return;
    const snareTom = notes.filter((n) => {
      const lane = LANE_OF[n.pitch];
      return lane === "snare" || lane === "toms";
    }).length;
    const share = snareTom / notes.length;
    const inGroove = groove.get(bar.meter)?.has(token) ?? false;
    const novel = (tokenCount.get(token) ?? 0) === 1;
    const dense = notes.length >= Math.max(5, medianHits * 1.5);
    const isFill = (share >= 0.55 && !inGroove) || (novel && dense && share >= 0.3);
    if (!isFill) return;
    const key = `${bar.meter}|${token}`;
    let a = acc.get(key);
    if (!a) {
      acc.set(key, (a = { meter: bar.meter, beats: bar.lenBeats, steps: bar.steps, token, count: 0, snareTom: 0, hits: 0, firstBar: i, crashBar: -1 }));
    }
    a.count++;
    a.snareTom += snareTom;
    a.hits += notes.length;
    const next = i + 1 < bars.length ? tokens[i + 1] : "";
    const opensCrash = next.split(",").some((t) => t.startsWith("crash@") && Number(t.slice(6)) <= 1);
    if (opensCrash && a.crashBar < 0) a.crashBar = i;
  });

  return [...acc.values()]
    .map((a) => {
      const barIdx = a.crashBar >= 0 ? a.crashBar : a.firstBar;
      const bar = bars[barIdx];
      const notes: Array<[number, number, number]> = buckets[barIdx].map((n) => [
        round4(n.beat - bar.startBeat),
        n.pitch,
        n.velocity,
      ]);
      return {
        meter: a.meter,
        beats: round4(a.beats),
        steps: a.steps,
        key: a.token,
        count: a.count,
        snareTomShare: Math.round((a.snareTom / a.hits) * 100) / 100,
        landsOnCrash: a.crashBar >= 0,
        notes,
      };
    })
    .sort((a, b) =>
      Number(b.landsOnCrash) - Number(a.landsOnCrash) ||
      b.count - a.count ||
      b.snareTomShare - a.snareTomShare,
    )
    .slice(0, 12);
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DIR;
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : path.join(import.meta.dirname, "..", "data", "zappa-scan.json");

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mid")).sort();
  const entries: ScanEntry[] = [];

  console.log(`${files.length} files in ${dir}\n`);
  for (const file of files) {
    try {
      const midi = parseMidi(fs.readFileSync(path.join(dir, file)));
      const { perTrack, tempoBpm } = tickToBeatStarts(midi);
      const maxBeat = Math.max(0, ...perTrack.flatMap((t) => t.notes.map((n) => n.beat)));
      const bars = barSpans(meterSpansOf(midi), maxBeat);

      // Drum source: a ch9-carrying track first (GM convention), else a
      // track named like drums. NOTE: match the NAME as a substring —
      // /\bdrum\b/ misses "Drums", which several of these files use.
      const ch9 = perTrack.find((t) => t.channels.has(9) && t.notes.some((n) => LANE_OF[n.pitch] !== undefined));
      const drumTrack =
        ch9 ??
        perTrack.find((t) => /(drum|perc|kit)/i.test(t.name) && t.notes.length > 0) ??
        null;
      const drumSource = drumTrack ? (drumTrack === ch9 ? "ch9" : `track:${drumTrack.name || "?"}`) : null;

      const allDrumTrackNotes = drumTrack ? drumTrack.notes : [];
      const drumNotes = allDrumTrackNotes.filter((n) => LANE_OF[n.pitch] !== undefined);
      const drumUnmapped = allDrumTrackNotes.length - drumNotes.length;
      const lanes: Partial<Record<LaneId, number>> = {};
      for (const n of drumNotes) {
        const lane = LANE_OF[n.pitch]!;
        lanes[lane] = (lanes[lane] ?? 0) + 1;
      }
      const buckets = notesByBar(bars, drumNotes);
      const tokens = bars.map((bar, i) => barToken(bar, buckets[i]));
      const meters = [...new Set(bars.map((b) => b.meter))];
      const meterBars: Record<string, number> = {};
      for (const b of bars) meterBars[b.meter] = (meterBars[b.meter] ?? 0) + 1;

      // Top recurring patterns per meter (3 per meter, most bars first).
      const grouped = new Map<string, PatternGroup>();
      bars.forEach((bar, i) => {
        const key = tokens[i];
        if (!key) return;
        const gk = `${bar.meter}|${key}`;
        const g = grouped.get(gk);
        if (g) g.count++;
        else grouped.set(gk, { meter: bar.meter, beats: bar.lenBeats, steps: bar.steps, key, count: 1, firstBar: i });
      });
      const topPerMeter = new Map<string, PatternGroup[]>();
      for (const g of grouped.values()) {
        let list = topPerMeter.get(g.meter);
        if (!list) topPerMeter.set(g.meter, (list = []));
        list.push(g);
      }
      const topPatterns: PatternInfo[] = [...topPerMeter.values()]
        .flatMap((list) => list.sort((a, b) => b.count - a.count).slice(0, 3))
        .sort((a, b) => b.count - a.count)
        .map((g) => {
          const bar = bars[g.firstBar];
          const notes: Array<[number, number, number]> = buckets[g.firstBar].map((n) => [
            round4(n.beat - bar.startBeat),
            n.pitch,
            n.velocity,
          ]);
          return { meter: g.meter, beats: round4(g.beats), steps: g.steps, key: g.key, bars: g.count, notes };
        });
      const fills = computeFills(bars, buckets, tokens);

      let feel: ScanEntry["feel"] = null;
      const fourFourBars = meterBars["4/4"] ?? 0;
      if (drumNotes.length > 8 && fourFourBars >= bars.length / 2) {
        const f = measureFeel(drumNotes, bars.length, 4);
        feel = { density: round2(f.density), swing: round2(f.swing), syncopation: round2(f.syncopation) };
      }

      const tracks: TrackInfo[] = perTrack.map((t, index) => ({
        index,
        name: t.name,
        channels: [...t.channels],
        notes: t.notes.length,
        laneCounts: t === drumTrack ? lanes : undefined,
      }));

      entries.push({
        file,
        title: file.replace(/ - Frank Zappa\.mid$/i, "").replace(/\.mid$/i, ""),
        bars: bars.length,
        tempoBpm: tempoBpm ? round2(tempoBpm) : null,
        drumSource,
        drumHits: drumNotes.length,
        drumUnmapped,
        lanes,
        feel,
        meters,
        meterBars,
        topPatterns,
        fills,
        tracks,
      });
    } catch (error) {
      console.log(`✗ ${file}: ${(error as Error).message}`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), dir, entries }, null, 1));

  // Report: drum-rich files first.
  const withDrums = entries.filter((e) => e.drumHits > 0).sort((a, b) => b.drumHits - a.drumHits);
  console.log(`drum-bearing: ${withDrums.length}/${entries.length} · no drums found: ${entries.length - withDrums.length}\n`);
  console.log("file".padEnd(36) + "bars meter        hits   swing  top pattern");
  for (const e of withDrums) {
    const top = e.topPatterns[0];
    const meter0 = e.meters[0] ?? "4/4";
    const meterStr = e.meters.length > 1 ? `${meter0}+${e.meters.length - 1}` : meter0;
    console.log(
      e.title.slice(0, 34).padEnd(36) +
      String(e.bars).padStart(4) + " " +
      meterStr.padEnd(12) +
      String(e.drumHits).padStart(5) + (e.drumUnmapped ? `+${e.drumUnmapped}?` : "  ") + " " +
      String(e.feel?.swing ?? "—").padStart(5) + "  " +
      (top ? `[${top.meter}] ${top.bars}× ${top.key.slice(0, 44)}` : ""),
    );
  }

  const isOdd = (m: string) => !["4/4", "3/4", "2/4"].includes(m);
  const odd = withDrums.filter((e) => e.meters.some(isOdd));
  if (odd.length) {
    console.log(`\nodd / shifting-meter material (${odd.length} files):`);
    for (const e of odd) {
      const counts = Object.entries(e.meterBars)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}×${n}`)
        .join(" ");
      console.log(`  ${e.title.slice(0, 40).padEnd(42)} ${counts}`);
    }
  }

  const fillFiles = withDrums.filter((e) => e.fills.some((f) => f.count >= 2 || f.landsOnCrash));
  if (fillFiles.length) {
    console.log(`\nrecurring fills (2+ occurrences, or landing on a crash):`);
    for (const e of fillFiles) {
      const topFills = e.fills.filter((f) => f.count >= 2 || f.landsOnCrash).slice(0, 2);
      for (const f of topFills) {
        console.log(
          `  ${e.title.slice(0, 28).padEnd(30)} [${f.meter}] ${String(f.count).padStart(3)}× ${f.landsOnCrash ? "→crash" : "      "} ${f.key.slice(0, 60)}`,
        );
      }
    }
  }

  const noDrums = entries.filter((e) => e.drumHits === 0);
  if (noDrums.length) {
    console.log(`\nno drum material located (${noDrums.length}):`);
    for (const e of noDrums) {
      const named = e.tracks.filter((t) => t.notes > 0 && t.name).map((t) => t.name).slice(0, 6).join(", ");
      console.log(`  ${e.title}  [${named || e.tracks.filter((t) => t.notes > 0).length + " unnamed tracks"}]`);
    }
  }
  console.log(`\nwrote ${outPath}`);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

main();
