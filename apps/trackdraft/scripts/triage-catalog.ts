/**
 * Catalog triage — curates ingested corpus songs (default: mcgill-*) for
 * the front-page catalog directory. Songs that meet the "fully
 * instrumented" bar stay in scripts/output/catalog/; everything else is
 * MOVED to scripts/output/catalog-triage/<same filename> with a report
 * explaining every call. Nothing is deleted — promotion back into the
 * catalog is one command:
 *
 *   npx tsx scripts/triage-catalog.ts                 # dry run + report
 *   npx tsx scripts/triage-catalog.ts --apply         # move triaged files out
 *   npx tsx scripts/triage-catalog.ts --promote mcgill-fever-peggy-lee
 *   npx tsx scripts/triage-catalog.ts --min-cpb 0.25 --reclaim --apply
 *
 * --reclaim is the mirror of --apply: it scans the TRIAGE directory and
 * moves songs that PASS the current criteria back into the catalog (dry
 * unless --apply) — the bulk form of --promote, for deliberate criteria
 * relaxations (e.g. --min-cpb for slow-harmonic-rhythm corpora).
 *
 * --exempt id[,id...] skips songs by id/filename — for entries deliberately
 * kept in the catalog outside the standard criteria (e.g. instrumentals,
 * which are complete per the 3-of-4 fields policy but have no lyrics).
 *
 * WHY these criteria (all measured from the blueprint itself, so any
 * future ingest is triaged identically):
 *  - lyrics present. "none" songs are half-empty in the app — and even a
 *    song whose file claims synced lyrics but carries zero timeline
 *    entries counts as none.
 *  - chords in EVERY section. A section without chords renders an empty
 *    harmony track — the "half done" look. (A song with one chord-less
 *    intro can be promoted after padding it or after the criteria are
 *    relaxed with --max-chordless 1.)
 *  - harmonic density: >= MIN_CHORDS chord events overall and
 *    >= MIN_CPB chords per bar on average. Catches dance/rap entries the
 *    annotators marked as single notes (Brass Monkey: 0 chords).
 *  - flags, not gates (reported, still kept): plain (non-timed) lyrics and
 *    LOW-confidence key estimates — both are honest, fixable states, and
 *    --require-synced / --require-clean-key turn them into exclusion
 *    criteria for a stricter first cut.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const CATALOG_DIR = path.join(import.meta.dirname, "output", "catalog");
const TRIAGE_DIR = path.join(import.meta.dirname, "output", "catalog-triage");

/** Fully-instrumented bar (kept songs must pass all). */
const MIN_CHORDS = 24;
const MIN_CPB = 0.5;
const MAX_CHORDLESS = 0;

interface Args {
  source: string;
  apply: boolean;
  report: string | null;
  requireSynced: boolean;
  requireCleanKey: boolean;
  maxChordless: number;
  minCpb: number;
  promote: string | null;
  reclaim: boolean;
  exempt: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    source: "mcgill-",
    apply: false,
    report: null,
    requireSynced: false,
    requireCleanKey: false,
    maxChordless: MAX_CHORDLESS,
    minCpb: MIN_CPB,
    promote: null,
    reclaim: false,
    exempt: [],
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") args.source = argv[++i];
    else if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--report") args.report = argv[++i];
    else if (argv[i] === "--require-synced") args.requireSynced = true;
    else if (argv[i] === "--require-clean-key") args.requireCleanKey = true;
    else if (argv[i] === "--max-chordless") args.maxChordless = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--min-cpb") args.minCpb = Number.parseFloat(argv[++i]);
    else if (argv[i] === "--promote") args.promote = argv[++i];
    else if (argv[i] === "--reclaim") args.reclaim = true;
    else if (argv[i] === "--exempt") {
      args.exempt = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

interface CatalogSongFile {
  id: string;
  title?: string;
  artist?: string;
  sections?: Array<{
    chords?: unknown[];
    bars?: number;
    lyricsTimeline?: unknown[];
  }>;
  provenance?: { warnings?: string[] };
}

interface Metrics {
  sections: number;
  chordless: number;
  chords: number;
  bars: number;
  cpb: number;
  lyricStatus: "synced" | "plain" | "none";
  lyricLines: number;
  lowKey: boolean;
}

function metrics(song: CatalogSongFile): Metrics {
  const warnings = song.provenance?.warnings ?? [];
  const sections = song.sections ?? [];
  const chordless = sections.filter((s) => (s.chords ?? []).length === 0).length;
  const chords = sections.reduce((n, s) => n + (s.chords ?? []).length, 0);
  const bars = sections.reduce((n, s) => n + (s.bars ?? 0), 0);
  const lyricLines = sections.reduce((n, s) => n + (s.lyricsTimeline ?? []).length, 0);

  const noMatch = warnings.some((w) => w.includes("No LRCLIB match found"));
  const plainOnly = warnings.some((w) => w.includes("plain lyrics only"));
  // A "synced" claim with zero timeline entries is functionally lyric-less.
  const lyricStatus: Metrics["lyricStatus"] = noMatch || lyricLines === 0 ? "none" : plainOnly ? "plain" : "synced";

  return {
    sections: sections.length,
    chordless,
    chords,
    bars,
    cpb: bars > 0 ? chords / bars : 0,
    lyricStatus,
    lyricLines,
    lowKey: warnings.some((w) => w.includes(", LOW")),
  };
}

interface Verdict {
  keep: boolean;
  reasons: string[];
  flags: string[];
}

function classify(m: Metrics, args: Args): Verdict {
  const reasons: string[] = [];
  const flags: string[] = [];
  if (m.lyricStatus === "none") reasons.push("no lyric data");
  if (m.chordless > args.maxChordless) {
    reasons.push(`${m.chordless} section${m.chordless === 1 ? "" : "s"} without chords`);
  }
  if (m.chords < MIN_CHORDS) reasons.push(`only ${m.chords} chords total`);
  if (m.cpb < args.minCpb) reasons.push(`sparse harmony (${m.cpb.toFixed(2)} chords/bar)`);
  if (args.requireSynced && m.lyricStatus === "plain") reasons.push("lyrics not line-timed");
  if (args.requireCleanKey && m.lowKey) reasons.push("low-confidence key estimate");

  if (m.lyricStatus === "plain") flags.push("lyrics plain (no timestamps)");
  if (m.lowKey) flags.push("key LOW — verify");
  return { keep: reasons.length === 0, reasons, flags };
}

interface Row {
  file: string;
  id: string;
  title: string;
  artist?: string;
  verdict: "kept" | "triaged";
  reasons: string[];
  flags: string[];
  metrics: Metrics;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // ——— promote mode ———
  if (args.promote) {
    const fname = args.promote.endsWith(".trackdraft.json") ? args.promote : `${args.promote}.trackdraft.json`;
    const src = path.join(TRIAGE_DIR, fname);
    if (!fs.existsSync(src)) {
      console.error(`✗ not in triage: ${src}`);
      process.exit(1);
    }
    const dest = path.join(CATALOG_DIR, fname);
    if (fs.existsSync(dest)) {
      console.error(`✗ already in catalog: ${dest}`);
      process.exit(1);
    }
    fs.renameSync(src, dest);
    console.log(`✓ promoted ${fname} → catalog`);
    return;
  }

  // ——— reclaim mode: triage dir → catalog for songs that now pass ———
  if (args.reclaim) {
    if (!fs.existsSync(TRIAGE_DIR)) {
      console.error(`✗ triage dir not found: ${TRIAGE_DIR}`);
      process.exit(1);
    }
    const files = fs
      .readdirSync(TRIAGE_DIR)
      .filter((f) => f.startsWith(args.source) && f.endsWith(".trackdraft.json"))
      .sort();
    const rows: Row[] = [];
    for (const file of files) {
      const song = JSON.parse(fs.readFileSync(path.join(TRIAGE_DIR, file), "utf8")) as CatalogSongFile;
      const m = metrics(song);
      const verdict = classify(m, args);
      rows.push({
        file,
        id: song.id,
        title: song.title ?? "(untitled)",
        artist: song.artist,
        verdict: verdict.keep ? "kept" : "triaged",
        reasons: verdict.reasons,
        flags: verdict.flags,
        metrics: m,
      });
    }
    const reclaimed = rows.filter((r) => r.verdict === "kept");
    const remaining = rows.filter((r) => r.verdict === "triaged");
    const remainingReasons = new Map<string, number>();
    for (const r of remaining) {
      for (const reason of r.reasons) {
        const key = reason.replace(/\d+/g, "N");
        remainingReasons.set(key, (remainingReasons.get(key) ?? 0) + 1);
      }
    }

    console.log(`${rows.length} ${args.source}* songs in triage${args.apply ? "" : " (dry run)"}`);
    console.log(`  RECLAIMED    ${reclaimed.length}  pass the current criteria → back to catalog`);
    console.log(`  STILL TRIAGED ${remaining.length}`);
    console.log("\nremaining reasons:");
    for (const [reason, n] of [...remainingReasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${reason}`);
    }
    console.log("\nreclaim examples:");
    for (const r of reclaimed.slice(0, 10)) {
      console.log(`  ${r.title.slice(0, 40).padEnd(42)} ${(r.artist ?? "").slice(0, 18).padEnd(20)} cpb=${r.metrics.cpb.toFixed(2)}`);
    }

    const reportPath =
      args.report ?? path.join(import.meta.dirname, "output", `${args.source.replace(/[^a-z0-9]+/gi, "")}-reclaim-report.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: "reclaim",
          criteria: {
            minChords: MIN_CHORDS,
            minCpb: args.minCpb,
            maxChordless: args.maxChordless,
            requireSynced: args.requireSynced,
            requireCleanKey: args.requireCleanKey,
          },
          totals: { scanned: rows.length, reclaimed: reclaimed.length, stillTriaged: remaining.length },
          rows,
        },
        null,
        2,
      ),
    );
    console.log(`\nreport → ${reportPath}`);

    if (args.apply) {
      let moved = 0;
      for (const r of reclaimed) {
        const src = path.join(TRIAGE_DIR, r.file);
        const dest = path.join(CATALOG_DIR, r.file);
        if (fs.existsSync(dest)) {
          console.warn(`  ! skipped (already in catalog): ${r.file}`);
          continue;
        }
        fs.renameSync(src, dest);
        moved++;
      }
      console.log(`moved ${moved} files → ${path.relative(import.meta.dirname, CATALOG_DIR)}/`);
    } else {
      console.log("(dry run — pass --apply to move the reclaimed files back)");
    }
    return;
  }

  if (!fs.existsSync(CATALOG_DIR)) {
    console.error(`✗ catalog dir not found: ${CATALOG_DIR}`);
    process.exit(1);
  }

  const exempt = new Set(args.exempt);
  const files = fs
    .readdirSync(CATALOG_DIR)
    .filter((f) => f.startsWith(args.source) && f.endsWith(".trackdraft.json"))
    .filter((f) => !exempt.has(f) && !exempt.has(f.replace(/\.trackdraft\.json$/, "")))
    .sort();
  if (exempt.size > 0) console.log(`exempt: ${exempt.size} song(s) skipped\n`);

  const rows: Row[] = [];
  for (const file of files) {
    const song = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), "utf8")) as CatalogSongFile;
    const m = metrics(song);
    const verdict = classify(m, args);
    rows.push({
      file,
      id: song.id,
      title: song.title ?? "(untitled)",
      artist: song.artist,
      verdict: verdict.keep ? "kept" : "triaged",
      reasons: verdict.reasons,
      flags: verdict.flags,
      metrics: m,
    });
  }

  const kept = rows.filter((r) => r.verdict === "kept");
  const triaged = rows.filter((r) => r.verdict === "triaged");

  const reasonHistogram = new Map<string, number>();
  for (const r of triaged) {
    for (const reason of r.reasons) {
      const key = reason.replace(/\d+/g, "N");
      reasonHistogram.set(key, (reasonHistogram.get(key) ?? 0) + 1);
    }
  }

  console.log(`${rows.length} ${args.source}* songs reviewed${args.apply ? "" : " (dry run)"}`);
  console.log(`  KEPT    ${kept.length}  fully instrumented — stays in the front page catalog`);
  console.log(`  TRIAGED ${triaged.length}  → ${path.relative(import.meta.dirname, TRIAGE_DIR)}/`);
  console.log();
  console.log("triage reasons:");
  for (const [reason, n] of [...reasonHistogram].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
  const flagHist = new Map<string, number>();
  for (const r of kept) for (const f of r.flags) flagHist.set(f, (flagHist.get(f) ?? 0) + 1);
  if (flagHist.size > 0) {
    console.log("\nkept with notes:");
    for (const [f, n] of [...flagHist].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
  console.log("\nexamples triaged:");
  for (const r of triaged.slice(0, 12)) {
    console.log(`  ${r.title.slice(0, 42).padEnd(44)} ${(r.artist ?? "").slice(0, 20).padEnd(22)} ${r.reasons.join(" · ")}`);
  }

  const reportPath =
    args.report ?? path.join(import.meta.dirname, "output", `${args.source.replace(/[^a-z0-9]+/gi, "")}-triage-report.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    criteria: {
      minChords: MIN_CHORDS,
      minCpb: args.minCpb,
      maxChordless: args.maxChordless,
      requireSynced: args.requireSynced,
      requireCleanKey: args.requireCleanKey,
    },
    totals: { reviewed: rows.length, kept: kept.length, triaged: triaged.length },
    rows,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${reportPath}`);

  if (args.apply) {
    fs.mkdirSync(TRIAGE_DIR, { recursive: true });
    let moved = 0;
    for (const r of triaged) {
      const src = path.join(CATALOG_DIR, r.file);
      const dest = path.join(TRIAGE_DIR, r.file);
      if (fs.existsSync(dest)) {
        console.warn(`  ! skipped (already triaged): ${r.file}`);
        continue;
      }
      fs.renameSync(src, dest);
      moved++;
    }
    console.log(`moved ${moved} files → ${path.relative(import.meta.dirname, TRIAGE_DIR)}/`);
    console.log(`promote later with: npx tsx scripts/triage-catalog.ts --promote <id>`);
  } else {
    console.log("(dry run — pass --apply to move the triaged files out of the catalog)");
  }
}

main();
