/**
 * Section re-anchor for drum analyses — restores the RECORD's internal
 * relationship between harmony and drums after both passed through the
 * catalog's lossy re-tiling.
 *
 * The problem this fixes (You Won't See Me, 2026-09-20):
 *   The record itself drifts, the jcrd section stamps are coarse (± half a
 *   bar), and the catalog re-tiles each section's chords from its (rounded)
 *   section start. The result: chord changes and the drum transcription can
 *   disagree by ±1 beat *per section* — clean sections end up coherent at
 *   phase −4 (kicks) / +4 (bridge) etc. while the record's own relationship
 *   (changes coincide with kicks, snare on the backbeat) is what the ear
 *   expects. Audition = "beat goes off in odd places... disjointed".
 *
 * The fix: for each analysis section, find the step shift k that best puts
 * the section's drum evidence (kick + snare hits) on the steps where that
 * section's chords CHANGE (the app's own frame), and apply it when the win
 * is decisive. DMC-style healthy songs already score best at k = 0 and are
 * left untouched; drift-smeared/mushy sections fail the margin gates and
 * are also left alone.
 *
 * This restores the record's *relative* feel (changes ≡ kicks) inside the
 * app. The absolute phase stays the catalog's own compromise — the same
 * compromise the chords and sections already carry.
 *
 * Run:
 *   npx tsx scripts/drum-section-reanchor.ts <song.blueprint.json> <analysis.json> [options]
 *
 * Options:
 *   --dry               print the per-section table, write nothing
 *   --out <file>        write elsewhere (default: in place, with a one-time
 *                       `.pre-reanchor.bak` backup)
 *   --min-ratio <x>     required score gain over k=0 (default 1.5)
 *   --max-steps <n>     largest |k| considered (default 6 — half-bar (±8)
 *                       rotations tie on symmetric patterns and are excluded;
 *                       observed annotation errors are ≤ ~1.2 beats)
 *   --min-per-change <n> required evidence-per-change at the best shift
 *                       (default 8) — sparse sections (Girl) never qualify
 *                       even when their base score is zero
 */
import * as fs from "node:fs";
import * as path from "node:path";

interface ChordLike { beats: number }
interface SongSection { chords?: ChordLike[]; bars: number }
interface SongLike { id?: string; sections: SongSection[] }
interface GridBar { lanes: Record<string, number[]> }
interface AnalysisSection { startBar: number; bars: number; sectionId?: string; sectionName?: string }
interface AnalysisLike { songId?: string; bars: GridBar[]; sections: AnalysisSection[] }

const STEPS = 16;
const LANES = ["kick", "snare", "hat"] as const;

function usage(): never {
  console.error("Usage: npx tsx scripts/drum-section-reanchor.ts <song.blueprint.json> <analysis.json> [--dry] [--out <file>] [--min-ratio <x>] [--max-steps <n>]");
  process.exit(1);
}

/** Chord change steps (mod 16) for one song section, from its tiled chords. */
function changeSteps(section: SongSection): number[] {
  const out: number[] = [];
  let beats = 0;
  for (const c of section.chords ?? []) {
    out.push(Math.round(beats * 4) % STEPS);
    beats += c.beats;
  }
  if (out.length === 0) out.push(0); // chord-less section: treat its start as the only change
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry") flags.set(a, true);
    else if (a.startsWith("--")) {
      const v = args[++i];
      if (v === undefined) usage();
      flags.set(a, v);
    } else positional.push(a);
  }
  if (positional.length !== 2) usage();
  const [songPath, analysisPath] = positional;
  const minRatio = flags.has("--min-ratio") ? Number(flags.get("--min-ratio")) : 1.5;
  const maxSteps = flags.has("--max-steps") ? Number(flags.get("--max-steps")) : 6;
  const minPerChange = flags.has("--min-per-change") ? Number(flags.get("--min-per-change")) : 8;

  const song = JSON.parse(fs.readFileSync(songPath, "utf8")) as SongLike;
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as AnalysisLike;
  if (!Array.isArray(song.sections) || !Array.isArray(analysis.bars)) {
    console.error("✗ song must have sections; analysis must have bars");
    process.exit(1);
  }
  if (analysis.sections.length !== song.sections.length) {
    console.error(`✗ section count differs: song ${song.sections.length} vs analysis ${analysis.sections.length} — aborting.`);
    process.exit(1);
  }

  console.log(`\n${path.basename(songPath)}  ⋈  ${path.basename(analysisPath)}`);
  console.log(`  gates: ratio ≥ ${minRatio} · |k| ≤ ${maxSteps} · changes ≥ 3 · evidence ≥ ${minPerChange}/change\n`);

  const applied: { label: string; k: number }[] = [];
  const shiftedBars = new Set<number>();

  for (let si = 0; si < analysis.sections.length; si++) {
    const sec = analysis.sections[si];
    const songSec = song.sections[si];
    const lo = sec.startBar;
    const hi = sec.startBar + sec.bars;
    const label = sec.sectionName ?? sec.sectionId ?? `#${si}`;

    // Evidence per step: how many of the section's bars carry kick / snare hits.
    const kickEv = new Array(STEPS).fill(0);
    const snareEv = new Array(STEPS).fill(0);
    for (let b = lo; b < hi; b++) {
      const bar = analysis.bars[b];
      if (!bar?.lanes) continue;
      const k = bar.lanes.kick ?? [];
      const s = bar.lanes.snare ?? [];
      for (let st = 0; st < STEPS; st++) {
        if ((k[st] ?? 0) > 0) kickEv[st]++;
        if ((s[st] ?? 0) > 0) snareEv[st]++;
      }
    }
    const evidence = (st: number): number => kickEv[st] + snareEv[st] + 0.5 * kickEv[st];

    const changes = changeSteps(songSec);
    const score = (k: number): number =>
      changes.reduce((acc, c) => acc + evidence(((c + k) % STEPS + STEPS) % STEPS), 0);

    const base = score(0);
    let bestK = 0;
    let bestScore = -Infinity;
    for (let k = -maxSteps; k <= maxSteps; k++) {
      const sc = score(k);
      if (sc > bestScore + 1e-9) {
        bestScore = sc;
        bestK = k;
      } else if (Math.abs(sc - bestScore) <= 1e-9 && Math.abs(k) < Math.abs(bestK)) {
        bestK = k;
      }
    }

    const ratio = bestScore / Math.max(base, 1e-9);
    const perChange = bestScore / changes.length;
    const eligible = changes.length >= 3 && perChange >= minPerChange && ratio >= minRatio && bestK !== 0;
    console.log(
      `  ${label.padEnd(20)} bars ${String(lo).padStart(3)}-${String(hi - 1).padEnd(3)} · changes ${String(changes.length).padStart(2)} · score0 ${base.toFixed(1).padStart(6)} · best ${bestK >= 0 ? "+" : ""}${bestK} ${bestScore.toFixed(1).padStart(6)} (×${ratio.toFixed(2)}, ${perChange.toFixed(1)}/ch)${eligible ? "  → SHIFT" : ""}`,
    );
    if (!eligible) continue;

    applied.push({ label, k: bestK });
    // new[q] = old[(q + k) mod 16] places each hit at (hit − k), i.e. onto the change step.
    for (let b = lo; b < hi; b++) {
      const bar = analysis.bars[b];
      if (!bar?.lanes) continue;
      for (const lane of LANES) {
        const row = bar.lanes[lane];
        if (!row) continue;
        const next = new Array(STEPS).fill(0);
        for (let q = 0; q < STEPS; q++) next[q] = row[((q + bestK) % STEPS + STEPS) % STEPS] ?? 0;
        bar.lanes[lane] = next;
      }
      shiftedBars.add(b);
    }
  }

  console.log(`\n  ${applied.length} section(s) shifted · ${shiftedBars.size} bar(s) rewritten`);
  for (const a of applied) console.log(`    ${a.label}  k=${a.k >= 0 ? "+" : ""}${a.k}`);

  if (flags.has("--dry")) {
    console.log("\n(dry run — nothing written)");
    return;
  }
  if (applied.length === 0) {
    console.log("\n(no shifts — file untouched)");
    return;
  }
  const out = typeof flags.get("--out") === "string" ? String(flags.get("--out")) : analysisPath;
  if (out === analysisPath) {
    const backup = analysisPath.replace(/\.json$/, "") + ".pre-reanchor.bak";
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(analysisPath, backup);
      console.log(`\n  backup → ${path.basename(backup)}`);
    }
  }
  fs.writeFileSync(out, JSON.stringify(analysis, null, 2) + "\n");
  console.log(`  written → ${out}`);
}

main();
