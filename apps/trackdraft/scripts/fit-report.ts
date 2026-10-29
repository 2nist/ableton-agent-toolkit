/**
 * Fit report — do the drums SIT where the structure and chord track say?
 *
 * Reads a song blueprint (structure + per-section chord track) and a drum
 * analysis file and reports how the two line up, because the spot where a
 * part plays is chapter and verse: fills should lead into section changes,
 * chord changes want the downbeat kick, and each section role should read
 * its own pattern. Run it after `merge-drum-analysis.ts` to verify the
 * consensus against the song — the elements fitting together is the check.
 *
 * Run:
 *   npx tsx scripts/fit-report.ts <song.trackdraft.json> <analysis.json> [--verbose]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseAnalysisFile } from "../src/lib/drumImport/analysisFile";
import { arrangementSpans, type SongLike } from "./drumAnalysis/song";

type Lane = "kick" | "snare" | "hat";

function usage(): never {
  console.error("Usage: npx tsx scripts/fit-report.ts <song.trackdraft.json> <analysis.json> [--verbose]");
  process.exit(1);
}

interface Chord { root: string; quality: string; beats: number }

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const verbose = args.includes("--verbose");
  if (positional.length !== 2) usage();
  const [songPath, analysisPath] = positional;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as SongLike & {
    sections?: (NonNullable<SongLike["sections"]>[number] & { role?: string; chords?: Chord[] })[];
  };
  const analysis = parseAnalysisFile(JSON.parse(fs.readFileSync(analysisPath, "utf8")));
  const { spans, totalBars } = arrangementSpans(song);
  const byId = new Map((song.sections ?? []).map((s) => [s.id, s]));

  // beat-lane chord track per section (ragged sums pad with the last chord)
  const chordAt = (sectionId: string, beat: number): Chord | null => {
    const sec = byId.get(sectionId);
    const chords = sec?.chords ?? [];
    if (chords.length === 0) return null;
    let t = 0;
    for (const c of chords) {
      if (beat < t + Math.max(1, c.beats)) return c;
      t += Math.max(1, c.beats);
    }
    return chords[chords.length - 1];
  };

  const steps = (lane: Lane, bar: number): number[] =>
    (analysis.bars[bar]?.lanes?.[lane] ?? []).map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const isFill = (bar: number): boolean => {
    const s = steps("snare", bar);
    if (s.length >= 4) return true;
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] <= 2) return true;
    return false;
  };
  const pattern = (lane: Lane, bars: number[]): number[] => {
    const count = new Map<string, number>();
    for (const b of bars) count.set(steps(lane, b).join(","), (count.get(steps(lane, b).join(",")) ?? 0) + 1);
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0].split(",").filter(Boolean).map(Number) : [];
  };

  console.log(`${song.title ?? path.basename(songPath)} — drum/structure fit (${totalBars} bars)`);
  console.log("");

  const flags: string[] = [];
  let changeBars = 0;
  let changeKick1 = 0;
  let startsKick1 = 0;
  let preStartFills = 0;

  for (const span of spans) {
    const sec = byId.get(span.sectionId);
    const bars = Array.from({ length: span.bars }, (_, i) => span.startBar + i);
    const grooveBars = bars.filter((b) => !isFill(b) && steps("kick", b).length + steps("snare", b).length > 0);
    const fillBars = bars.filter(isFill);
    const chords = (sec?.chords ?? [])
      .map((c) => `${c.root}${c.quality}/${c.beats}`)
      .join(" ");
    const k = pattern("kick", grooveBars);
    const s = pattern("snare", grooveBars);
    const h = pattern("hat", grooveBars);
    const role = (sec as { role?: string } | undefined)?.role ?? span.name;

    const startKick = steps("kick", span.startBar).includes(0);
    if (startKick) startsKick1++;
    else flags.push(`bar ${span.startBar}: section "${span.name}" starts without a kick on beat 1`);
    const prevFill = span.startBar > 0 ? isFill(span.startBar - 1) : null;
    if (prevFill === true) preStartFills++;

    console.log(
      `  ${span.name.padEnd(16)} bars ${String(span.startBar).padStart(2)}-${String(span.startBar + span.bars - 1).padStart(2)}` +
      `  kick {${k.join(",")}} snare {${s.join(",")}} hat ${h.length ? "8ths" : "—"}` +
      `  fills @ ${fillBars.length ? fillBars.join(",") : "—"}${prevFill === true ? " ↓leads-in" : ""}`,
    );
    if (verbose && chords) console.log(`      ${role} · chords: ${chords}`);
    void role;
  }

  console.log("");
  for (const b of Array.from({ length: totalBars }, (_, i) => i)) {
    const sec = spans.find((s) => b >= s.startBar && b < s.startBar + s.bars);
    if (!sec || b === sec.startBar) continue;
    const local = (b - sec.startBar) * 4;
    const cur = chordAt(sec.sectionId, local);
    const prev = chordAt(sec.sectionId, local - 4);
    const change = cur && prev && (cur.root !== prev.root || cur.quality !== prev.quality);
    if (!change) continue;
    changeBars++;
    if (steps("kick", b).includes(0)) changeKick1++;
    else flags.push(`bar ${b}: chord changes to ${cur!.root}${cur!.quality} but no kick on beat 1`);
  }
  console.log(
    `chord-change bars: ${changeBars} · kick on beat 1: ${changeKick1} (${changeBars ? Math.round((100 * changeKick1) / changeBars) : 0}%)`,
  );
  console.log(`section starts with kick on beat 1: ${startsKick1}/${spans.length}`);
  console.log(`section starts preceded by a fill: ${preStartFills}/${Math.max(1, spans.length - 1)}`);
  if (flags.length) {
    console.log("\nflags:");
    for (const f of flags) console.log(`  ⚠ ${f}`);
  } else {
    console.log("\n✓ drums, structure and chord track line up.");
  }
}

main();
