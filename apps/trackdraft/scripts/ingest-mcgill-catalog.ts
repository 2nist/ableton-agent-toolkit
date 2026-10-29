/**
 * McGill Billboard / SALAMI catalog ingest — joins the chord/section
 * annotations (mcgill_jcrd_salami_Billboard/*.json) with the LRCLIB
 * lyric snapshot fetched for this corpus (lyrics_from_lrclib/*.json,
 * 719 files) into draft .trackdraft.json blueprints for the TrackDraft
 * catalog (the front-page directory the Dashboard lists). Same
 * "draft for review in the UI" philosophy as ingest-beatles-catalog.ts.
 *
 * The parser lives at scripts/catalog/mcgillJcrd.ts — see its header for
 * the corpus's format facts (ms section timing, untimed uniformly
 * distributed chord slots, 1/1 single-note and 5 power-chord special
 * forms, absent key/tempo).
 *
 * Run (pilot — curated subset):
 *   npx tsx scripts/ingest-mcgill-catalog.ts --only "help_the_beatles,come_together_the_beatles"
 * Run (entire corpus):
 *   npx tsx scripts/ingest-mcgill-catalog.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseMcgillJcrd } from "./catalog/mcgillJcrd.js";
import { parseLrc } from "./catalog/lrc.js";
import type { LrcLine } from "./catalog/lrc.js";
import { normalizeTitle } from "./catalog/normalizeTitle.js";
import { catalogSongToBlueprintSong } from "./catalog/toBlueprintSong.js";

const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const LYRICS_DIR = path.join(MCGILL_ROOT, "lyrics_from_lrclib");
const OUTPUT_DIR =
  process.env.CATALOG_OUTPUT_DIR ?? path.join(import.meta.dirname, "output", "mcgill-catalog");

/** Non-song files that also live in the corpus root. */
const SIDECARS = new Set([
  "harmonic_phonology_refined.json",
  "harmonic_phonology_v2.json",
  "original_output.json",
]);

interface Args {
  only: string[] | null;
  limit: number;
  out: string;
  report: string;
  dry: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    only: null,
    limit: Infinity,
    out: OUTPUT_DIR,
    report: path.join(import.meta.dirname, "output", "mcgill-ingest-report.json"),
    dry: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") {
      args.only = argv[++i]
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (argv[i] === "--limit") args.limit = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--report") args.report = argv[++i];
    else if (argv[i] === "--dry") args.dry = true;
    else if (argv[i] === "--list") args.list = true;
  }
  return args;
}

interface LrclibMatch {
  trackName: string;
  artistName?: string;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/**
 * Multi-key index. LRCLIB's trackName is usually clean ("Help!"), but 5
 * files in this snapshot carry release-styled names ("Help - Help!",
 * "Dream Police - 01 - Dream Police", "A Hard Days Night - A Hard Days
 * Night") that no plain title match can hit — so every part of the
 * trackName AND the file name ("Artist - Title.json") is indexed as a
 * candidate title, alongside artist+title pairs. normalizeTitle handles
 * case/punctuation/apostrophe variance ("Day's" == "Days").
 */
function loadLyricIndex(dir: string): {
  byArtistTitle: Map<string, LrclibMatch>;
  byTitle: Map<string, LrclibMatch>;
} {
  const byArtistTitle = new Map<string, LrclibMatch>();
  const byTitle = new Map<string, LrclibMatch>();
  if (!fs.existsSync(dir)) return { byArtistTitle, byTitle };
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    let data: LrclibMatch;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as LrclibMatch;
    } catch {
      continue;
    }
    if (!data.trackName) continue;

    const candidates = new Set<string>();
    const addCandidate = (s: string) => {
      const t = normalizeTitle(s);
      if (t) candidates.add(t);
    };
    addCandidate(data.trackName);
    for (const part of data.trackName.split(" - ")) addCandidate(part);
    const stem = file.replace(/\.json$/, "");
    for (const part of stem.split(" - ")) addCandidate(part);

    const artists = new Set<string>();
    if (data.artistName) artists.add(normalizeTitle(data.artistName));
    const stemParts = stem.split(" - ");
    if (stemParts.length > 1) artists.add(normalizeTitle(stemParts[0]));

    for (const t of candidates) {
      byTitle.set(t, data);
      for (const a of artists) {
        if (a) byArtistTitle.set(`${a}|${t}`, data);
      }
    }
  }
  return { byArtistTitle, byTitle };
}

function lookupLyrics(
  index: ReturnType<typeof loadLyricIndex>,
  title: string,
  artist: string | undefined,
): { match: LrclibMatch | null; viaFallback: boolean } {
  const t = normalizeTitle(title);
  if (artist) {
    const primary = index.byArtistTitle.get(`${normalizeTitle(artist)}|${t}`);
    if (primary) return { match: primary, viaFallback: false };
  }
  const fallback = index.byTitle.get(t);
  return { match: fallback ?? null, viaFallback: Boolean(fallback) };
}

/** Plain lyrics have no line timing — spread lines across the song's
 *  total duration so the merge's tail-zone binning distributes each line
 *  into its best-fit section instead of one blob in section 0. (Same
 *  approach as ingest-beatles-catalog.ts.) */
function plainLinesWithSyntheticTiming(
  plainText: string,
  totalSec: number,
): { text: string; startSec: number }[] {
  const lines = plainText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1 || totalSec <= 0) return lines.map((text) => ({ text, startSec: 0 }));
  const step = totalSec / (lines.length - 1);
  return lines.map((text, i) => ({ text, startSec: i * step }));
}

function slugBase(base: string): string {
  return base.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

interface ReportRow {
  file: string;
  id: string;
  title: string;
  artist?: string;
  sections: number;
  chords: number;
  bars: number;
  key?: string;
  scale?: string;
  lyrics: "synced" | "plain" | "none";
  warnings: string[];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const allFiles = fs
    .readdirSync(MCGILL_ROOT)
    .filter((f) => f.endsWith(".json") && !SIDECARS.has(f))
    .sort();

  let selected = allFiles;
  if (args.only) {
    selected = selected.filter((f) => {
      const lower = f.toLowerCase();
      return args.only!.some((needle) => lower.includes(needle));
    });
  }
  selected = selected.slice(0, args.limit);

  if (args.list) {
    for (const f of selected) console.log(f);
    console.log(`${selected.length} files selected of ${allFiles.length}`);
    return;
  }

  const lyricIndex = loadLyricIndex(LYRICS_DIR);
  console.log(
    `${allFiles.length} corpus files · ${lyricIndex.byTitle.size} lyric entries · processing ${selected.length}\n`,
  );

  if (!args.dry) fs.mkdirSync(args.out, { recursive: true });

  const rows: ReportRow[] = [];
  let failures = 0;
  let synced = 0;
  let plain = 0;
  let none = 0;
  let keyLowConfidence = 0;

  for (const file of selected) {
    const src = path.join(MCGILL_ROOT, file);
    const base = file.replace(/\.json$/, "");

    try {
      const rawJson = JSON.parse(fs.readFileSync(src, "utf8"));
      const parsed = parseMcgillJcrd(rawJson);

      const { match, viaFallback } = lookupLyrics(lyricIndex, parsed.title, parsed.artist);
      const hasSyncedLyrics = Boolean(match?.syncedLyrics);
      const lastSectionEndSec = parsed.sections[parsed.sections.length - 1]?.endSec ?? 0;
      const lyricLines: LrcLine[] | undefined = match
        ? hasSyncedLyrics
          ? parseLrc(match.syncedLyrics!)
          : match.plainLyrics
            ? plainLinesWithSyntheticTiming(match.plainLyrics, lastSectionEndSec)
            : []
        : undefined;

      const id = `mcgill-${slugBase(base)}`;
      const song = catalogSongToBlueprintSong({
        id,
        raw: parsed,
        lyricLines,
        hasSyncedLyrics,
        // McGill's corpus is the Billboard Hot 100 — chart pop/rock, so the
        // pop family is the right performance pool.
        genre: "pop",
      });

      if (!args.dry) {
        fs.writeFileSync(path.join(args.out, `${id}.trackdraft.json`), JSON.stringify(song, null, 2));
      }

      const chordCount = parsed.sections.reduce((s, sec) => s + sec.chords.length, 0);
      const bars = song.sections.reduce((s, sec) => s + sec.bars, 0);
      const lyricStatus: ReportRow["lyrics"] = hasSyncedLyrics ? "synced" : match?.plainLyrics ? "plain" : "none";
      if (lyricStatus === "synced") synced++;
      else if (lyricStatus === "plain") plain++;
      else none++;

      const keyWarning = parsed.warnings.find((w) => w.includes("estimated"));
      if (keyWarning?.includes("LOW")) keyLowConfidence++;

      rows.push({
        file,
        id,
        title: parsed.title,
        artist: parsed.artist,
        sections: parsed.sections.length,
        chords: chordCount,
        bars,
        key: song.key,
        scale: song.scale,
        lyrics: lyricStatus,
        warnings: parsed.warnings,
      });

      console.log(
        `  ✓ ${base} → ${id} · ${parsed.sections.length}sec · ${chordCount}ch · ${bars}b · ${song.key} ${song.scale}${viaFallback ? " (lyrics via title fallback)" : ""} · ${lyricStatus}`,
      );
    } catch (err) {
      failures++;
      console.error(`  ✗ ${file}: ${(err as Error).message}`);
    }
  }

  const totals = {
    processed: rows.length,
    failures,
    lyrics: { synced, plain, none },
    keyLowConfidence,
  };

  if (!args.dry) {
    fs.writeFileSync(
      args.report,
      JSON.stringify({ generatedAt: new Date().toISOString(), corpus: MCGILL_ROOT, totals, rows }, null, 2),
    );
  }

  console.log(
    `\n${rows.length} processed · ${failures} failed · lyrics: ${synced} synced / ${plain} plain / ${none} none · low-confidence keys: ${keyLowConfidence}`,
  );
  if (!args.dry) console.log(`report → ${args.report}`);
  console.log(`blueprints → ${args.out}`);
}

main();
