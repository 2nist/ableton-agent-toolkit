/**
 * LRCLIB line-timed lyric refresh — re-queries the LRCLIB API for corpus
 * songs whose local lyric snapshot lacks line timestamps ("plain" or "no
 * lyric data" in the triage report), and upgrades the local files with
 * line-timed (syncedLyrics) versions where they exist.
 *
 * Reads the triage report to find targets, so it always chases exactly the
 * songs the triage found lacking:
 *   npx tsx scripts/refresh-lrclib-lyrics.ts --limit 6     # spot check
 *   npx tsx scripts/refresh-lrclib-lyrics.ts               # all targets
 *
 * Then re-ingest the upgraded songs and re-run the triage:
 *   npx tsx scripts/ingest-mcgill-catalog.ts --only "<files from report>"
 *   npx tsx scripts/triage-catalog.ts --require-synced
 *
 * Lookup strategy per song: exact /api/get first, then two /api/search
 * passes (fielded, then free-text). Candidates must carry syncedLyrics;
 * they are ranked by normalized title/artist equality and duration
 * closeness (song duration estimated from the corpus sections). Originals
 * are backed up once to lyrics_from_lrclib/_refresh_backup/ before the
 * first edit. Upgrades only — a result can never make a lyric file worse.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeTitle } from "./catalog/normalizeTitle.js";

const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const LYRICS_DIR = path.join(MCGILL_ROOT, "lyrics_from_lrclib");
const BACKUP_DIR = path.join(LYRICS_DIR, "_refresh_backup");
const TRIAGE_REPORT = path.join(import.meta.dirname, "output", "mcgill-triage-report.json");
const REPORT_PATH = path.join(import.meta.dirname, "output", "lrclib-refresh-report.json");

const UA = "TrackDraft-CatalogRefresher/1.0 (https://github.com/2nist/ableton-agent-toolkit)";

interface Args {
  limit: number;
  only: string[] | null;
  dry: boolean;
  root: string;
  lyricsDir: string;
  triageReport: string;
  reportOut: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: Infinity,
    only: null,
    dry: false,
    root: MCGILL_ROOT,
    lyricsDir: LYRICS_DIR,
    triageReport: TRIAGE_REPORT,
    reportOut: REPORT_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") args.limit = Number.parseInt(argv[++i], 10);
    else if (argv[i] === "--only") {
      args.only = argv[++i].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (argv[i] === "--dry") args.dry = true;
    else if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--lyrics-dir") args.lyricsDir = argv[++i];
    else if (argv[i] === "--triage-report") args.triageReport = argv[++i];
    else if (argv[i] === "--report") args.reportOut = argv[++i];
  }
  return args;
}

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface TriageRow {
  file: string;
  id: string;
  title: string;
  artist?: string;
  verdict: string;
  reasons: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<{ status: number; data: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() };
  }
  return { status: 0, data: null };
}

function scoreCandidate(c: LrclibRecord, title: string, artist: string | undefined, durationSec: number | undefined): number {
  let score = 0;
  if (normalizeTitle(c.trackName ?? "") === normalizeTitle(title)) score += 3;
  if (artist && normalizeTitle(c.artistName ?? "") === normalizeTitle(artist)) score += 2;
  if (durationSec && c.duration) {
    const delta = Math.abs(c.duration - durationSec);
    if (delta <= 3) score += 2;
    else if (delta <= 8) score += 1;
    else score -= 1;
  }
  return score;
}

function pickBest(
  candidates: LrclibRecord[],
  title: string,
  artist: string | undefined,
  durationSec: number | undefined,
  requireSynced: boolean,
): LrclibRecord | null {
  const usable = candidates.filter((c) =>
    requireSynced ? Boolean(c.syncedLyrics && c.syncedLyrics.trim()) : true,
  );
  if (usable.length === 0) return null;
  return usable.sort(
    (a, b) =>
      scoreCandidate(b, title, artist, durationSec) - scoreCandidate(a, title, artist, durationSec) ||
      Math.abs((a.duration ?? 0) - (durationSec ?? 0)) - Math.abs((b.duration ?? 0) - (durationSec ?? 0)),
  )[0];
}

function slugBase(base: string): string {
  return base.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/** Corpus filename ↔ blueprint id resolution: ids are `<prefix>-<slug>`
 *  of the source filename (with any `_tdc` marker stripped), so map every
 *  corpus file to its slug once. Fixes the earlier gap where the duration
 *  hint was looked up with the catalog-side filename and never found. */
function buildSourceIndex(root: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fs.readdirSync(root)) {
    if (!/\.(json|jcrd)$/.test(f)) continue;
    const base = f.replace(/\.[a-z]+$/, "").replace(/_tdc$/, "");
    map.set(slugBase(base), f);
  }
  return map;
}

/** Multi-key index of the existing lyric snapshot — same rules as the
 *  ingest's loader (trackName parts, filename parts, artist prefixes). */
function loadLyricFileIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    let data: { trackName?: string; artistName?: string };
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch {
      continue;
    }
    const candidates = new Set<string>();
    const add = (s: string | undefined) => {
      const t = s ? normalizeTitle(s) : "";
      if (t) candidates.add(t);
    };
    add(data.trackName);
    for (const part of (data.trackName ?? "").split(" - ")) add(part);
    const stem = file.replace(/\.json$/, "");
    for (const part of stem.split(" - ")) add(part);
    for (const t of candidates) index.set(t, file);
  }
  return index;
}

function songDurationSec(root: string, corpusFile: string): number | undefined {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, corpusFile), "utf8")) as {
      sections?: Array<{ start_ms?: number; duration_ms?: number }>;
    };
    const secs = d.sections ?? [];
    if (secs.length === 0) return undefined;
    const last = secs[secs.length - 1];
    return ((last.start_ms ?? 0) + (last.duration_ms ?? 0)) / 1000;
  } catch {
    return undefined;
  }
}

interface RefreshRow {
  file: string;
  id: string;
  title: string;
  artist?: string;
  sourceFile?: string;
  before: "plain" | "none";
  result: "synced-found" | "plain-only" | "instrumental" | "no-match" | "error";
  lyricFile?: string;
  trackName?: string;
  artistName?: string;
  durationDeltaSec?: number;
  syncedLines?: number;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const backupDir = path.join(args.lyricsDir, "_refresh_backup");

  const triage = JSON.parse(fs.readFileSync(args.triageReport, "utf8")) as { rows: TriageRow[] };
  let targets = triage.rows.filter(
    (r) =>
      r.verdict === "triaged" &&
      (r.reasons.some((x) => x.includes("lyrics not line-timed")) ||
        r.reasons.some((x) => x.includes("no lyric data"))),
  );
  if (args.only) {
    targets = targets.filter((r) => args.only!.some((n) => r.id.toLowerCase().includes(n) || r.file.toLowerCase().includes(n)));
  }
  targets = targets.slice(0, args.limit);

  const fileIndex = loadLyricFileIndex(args.lyricsDir);
  const sourceIndex = buildSourceIndex(args.root);
  console.log(`${targets.length} refresh targets (of ${triage.rows.length} reviewed)\n`);

  const rows: RefreshRow[] = [];
  let syncedFound = 0;
  let plainGained = 0;
  let instruct = 0;
  let none = 0;

  for (const t of targets) {
    const before: "plain" | "none" = t.reasons.some((x) => x.includes("no lyric data")) ? "none" : "plain";
    const sourceFile = sourceIndex.get(t.id.replace(/^[a-z]+-/, ""));
    const durationSec = sourceFile ? songDurationSec(args.root, sourceFile) : undefined;
    const q = encodeURIComponent;
    const row: RefreshRow = { file: t.file, id: t.id, title: t.title, artist: t.artist, sourceFile, before, result: "no-match" };

    try {
      let record: LrclibRecord | null = null;

      // 1) exact get
      const getUrl = `https://lrclib.net/api/get?artist_name=${q(t.artist ?? "")}&track_name=${q(t.title)}${durationSec ? `&duration=${Math.round(durationSec)}` : ""}`;
      const exact = await fetchJson(getUrl);
      if (exact.status === 200 && exact.data) {
        const rec = exact.data as LrclibRecord;
        if (rec.syncedLyrics && rec.syncedLyrics.trim()) record = rec;
      }

      // 2) fielded search
      if (!record) {
        const s1 = await fetchJson(`https://lrclib.net/api/search?artist_name=${q(t.artist ?? "")}&track_name=${q(t.title)}`);
        if (s1.status === 200 && Array.isArray(s1.data)) {
          record = pickBest(s1.data as LrclibRecord[], t.title, t.artist, durationSec, true);
        }
      }

      // 3) free-text search
      if (!record) {
        const s2 = await fetchJson(`https://lrclib.net/api/search?q=${q(`${t.artist ?? ""} ${t.title}`.trim())}`);
        if (s2.status === 200 && Array.isArray(s2.data)) {
          record = pickBest(s2.data as LrclibRecord[], t.title, t.artist, durationSec, true);
        }
      }

      // 4) last resort: any plain result (fills a "none" file with text)
      if (!record && before === "none") {
        const s3 = await fetchJson(`https://lrclib.net/api/search?q=${q(`${t.artist ?? ""} ${t.title}`.trim())}`);
        if (s3.status === 200 && Array.isArray(s3.data)) {
          record = pickBest(s3.data as LrclibRecord[], t.title, t.artist, durationSec, false);
        }
      }

      if (!record) {
        row.result = "no-match";
        none++;
      } else {
        const hasSynced = Boolean(record.syncedLyrics && record.syncedLyrics.trim());
        const lyricFile = fileIndex.get(normalizeTitle(t.title));
        row.trackName = record.trackName;
        row.artistName = record.artistName;
        row.durationDeltaSec = record.duration && durationSec ? Math.round(record.duration - durationSec) : undefined;
        row.syncedLines = hasSynced ? record.syncedLyrics!.split("\n").filter((l) => l.trim()).length : 0;
        row.lyricFile = lyricFile ?? `${record.artistName} - ${record.trackName}.json`.replace(/[/:]/g, "_");

        if (!hasSynced) {
          row.result = "plain-only";
          plainGained++;
        } else {
          row.result = "synced-found";
          syncedFound++;
        }

        if (!args.dry) {
          fs.mkdirSync(backupDir, { recursive: true });
          const dest = path.join(args.lyricsDir, row.lyricFile);
          if (lyricFile) {
            const backup = path.join(backupDir, lyricFile);
            if (!fs.existsSync(backup)) fs.copyFileSync(dest, backup);
          }
          let existing: Record<string, unknown> = {};
          if (lyricFile && fs.existsSync(dest)) {
            try {
              existing = JSON.parse(fs.readFileSync(dest, "utf8")) as Record<string, unknown>;
            } catch {
              existing = {};
            }
          }
          const merged = {
            ...existing,
            trackName: record.trackName,
            artistName: record.artistName,
            albumName: record.albumName ?? existing.albumName,
            duration: record.duration ?? existing.duration,
            instrumental: record.instrumental ?? false,
            plainLyrics: record.plainLyrics ?? existing.plainLyrics ?? null,
            syncedLyrics: record.syncedLyrics ?? existing.syncedLyrics ?? null,
            refreshedAt: new Date().toISOString(),
            refreshSource: "lrclib-refresh",
          };
          fs.writeFileSync(dest, JSON.stringify(merged, null, 2));
        }
      }
    } catch (err) {
      row.result = "error";
      row.error = (err as Error).message;
    }

    rows.push(row);
    const mark = row.result === "synced-found" ? "✓" : row.result === "plain-only" ? "·" : "✗";
    console.log(
      `  ${mark} ${t.title.slice(0, 40).padEnd(42)} ${(t.artist ?? "").slice(0, 20).padEnd(22)} ${before} → ${row.result}${row.syncedLines ? ` (${row.syncedLines} lines)` : ""}`,
    );
    await sleep(250);
  }

  fs.writeFileSync(
    args.reportOut,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dry: args.dry,
        totals: { targets: rows.length, syncedFound, plainGained, instrumental: instruct, noMatch: rows.filter((r) => r.result === "no-match").length, errors: rows.filter((r) => r.result === "error").length },
        rows,
      },
      null,
      2,
    ),
  );

  console.log(`\nsynced found: ${syncedFound} · plain-only: ${plainGained} · no match: ${none} · of ${rows.length} targets`);
  console.log(`report → ${args.reportOut}`);
  if (args.dry) console.log("(dry run — lyric files not touched)");
  else console.log(`backups (first edit of each file) → ${backupDir}`);
  console.log(`\nre-ingest upgraded songs, then re-run the triage (see the report's sourceFile column)`);
}

main();
