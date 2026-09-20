/**
 * Batch drum fixer — the "fix the rest of the tunes" runner.
 *
 * For every catalog song that doesn't have drums authored yet:
 *   1. finds its audio in the master archive (fuzzy title match),
 *   2. separates a drums stem with demucs (cached under tempdrumpatgencode/stems),
 *   3. transcribes it with analyze-drums (cached under tempdrumpatgencode/analyses),
 *   4. merges the result into the catalog blueprint IN PLACE (backed up once
 *      to scripts/output/catalog/_pre-drums-backup/).
 *
 * Everything is resumable: cached stems/analyses are reused, songs that
 * already have drum blocks are skipped, and every processed song is appended
 * to scripts/output/drums-batch-report.json as it finishes.
 *
 * Run from apps/trackdraft:
 *   npx tsx scripts/batch-fix-drums.ts --list                  (match report only)
 *   npx tsx scripts/batch-fix-drums.ts --dry                   (plan, no writes)
 *   npx tsx scripts/batch-fix-drums.ts --album rubber --limit 3
 *
 * Options:
 *   --list             catalog↔audio match table, write nothing
 *   --dry              plan only (what would run), write nothing
 *   --only <substr>    filter on title/id (case-insensitive substring)
 *   --album <substr>   filter on the matched album folder (normalized contains)
 *   --limit <n>        stop after n songs actually processed
 *   --force            also process songs that already have drums
 *   --steps 12|16      analysis grid (default 16, straight)
 *   --demucs <path>    demucs binary (default: the chord-extractor-env one)
 *   --audio-root <dir> audio archive root (default: /Users/Matthew/beatles data/audio)
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const APP_DIR = process.cwd();
if (!fs.existsSync(path.join(APP_DIR, "scripts", "output", "catalog"))) {
  console.error("✗ run this from apps/trackdraft (scripts/output/catalog not found)");
  process.exit(1);
}
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");
const CATALOG_DIR = path.join(APP_DIR, "scripts", "output", "catalog");
const BACKUP_DIR = path.join(CATALOG_DIR, "_pre-drums-backup");
const STEMS_DIR = path.join(REPO_ROOT, "tempdrumpatgencode", "stems");
const ANALYSES_DIR = path.join(REPO_ROOT, "tempdrumpatgencode", "analyses");
const REPORT_PATH = path.join(APP_DIR, "scripts", "output", "drums-batch-report.json");
const DEFAULT_AUDIO_ROOT = "/Users/Matthew/beatles data/audio";
const DEFAULT_DEMUCS = path.join(os.homedir(), ".pyenv", "versions", "chord-extractor-env", "bin", "demucs");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Map<string, string | true>();
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--list" || a === "--dry" || a === "--force") flags.set(a, true);
  else if (a.startsWith("--")) {
    const v = args[++i];
    if (v === undefined) {
      console.error(`✗ ${a} needs a value`);
      process.exit(1);
    }
    flags.set(a, v);
  } else {
    console.error(`✗ unexpected argument ${a}`);
    process.exit(1);
  }
}
const LIST = flags.has("--list");
const DRY = flags.has("--dry");
const FORCE = flags.has("--force");
const ONLY = typeof flags.get("--only") === "string" ? String(flags.get("--only")).toLowerCase() : null;
const ALBUM = typeof flags.get("--album") === "string" ? normalize(String(flags.get("--album"))) : null;
const LIMIT = flags.has("--limit") ? Number(flags.get("--limit")) : Infinity;
const STEPS = flags.has("--steps") ? String(flags.get("--steps")) : "16";
const DEMUCS = typeof flags.get("--demucs") === "string" ? String(flags.get("--demucs")) : DEFAULT_DEMUCS;
const AUDIO_ROOT = typeof flags.get("--audio-root") === "string" ? String(flags.get("--audio-root")) : DEFAULT_AUDIO_ROOT;

// ---------------------------------------------------------------------------
// Audio matching
// ---------------------------------------------------------------------------

interface Candidate {
  file: string;
  album: string;
  norm: string;
}

/** Lowercase, punctuation-free, leading track numbers and noise words gone —
 *  "P.S. I Love You" and "09_p_s_i_love_you" both become "p s i love you". */
function normalize(s: string): string {
  const NOISE = new Set(["remaster", "remastered", "stereo", "mono", "mix", "the", "beatles", "take", "version"]);
  const t = s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = t.split(" ").filter(Boolean);
  while (tokens.length > 1 && /^\d+$/.test(tokens[0]!)) tokens.shift();
  return tokens.filter((tok) => !NOISE.has(tok)).join(" ");
}

function walkAudio(root: string): Candidate[] {
  const EXTS = new Set([".mp3", ".wav", ".m4a", ".flac", ".aif", ".aiff"]);
  const out: Candidate[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push({ file: full, album: path.basename(dir), norm: normalize(path.basename(e.name, path.extname(e.name))) });
      }
    }
  };
  visit(root);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function matchScore(target: string, cand: string): number {
  if (!target || !cand) return 0;
  if (cand === target) return 100;
  /** Compact-form battery: exact, then near-containment ("medley a kansas
   *  city b …" — the junk word breaks a plain substring), then a long-enough
   *  prefix ("Money" → "money_that_s_what_i_want"). */
  const viaCompact = (ta: string, ca: string): number => {
    if (!ta || !ca) return 0;
    if (ta === ca) return 100;
    const ratio = Math.min(ta.length, ca.length) / Math.max(ta.length, ca.length);
    if (ratio >= 0.7 && (ca.includes(ta) || ta.includes(ca))) return 85;
    if (ta.length >= 5 && (ca.startsWith(ta) || ta.startsWith(ca))) return 85;
    return 0;
  };
  const compact = (s: string) => s.split(" ").join("");
  const deSingled = (s: string) => s.split(" ").filter((t) => t.length > 1).join("");
  let best = Math.max(viaCompact(compact(target), compact(cand)), viaCompact(deSingled(target), deSingled(cand)));
  // Token overlap fallback, max-denominator so a short candidate can't
  // fake a match against a long title.
  const A = new Set(target.split(" "));
  const B = new Set(cand.split(" "));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return Math.max(best, (inter / Math.max(A.size, B.size)) * 60);
}

interface SongRow {
  id: string;
  title: string;
  file: string;
  sections: number;
  hasDrums: boolean;
  album: string | null;
  audioFile: string | null;
  matchScore: number;
  ambiguousWith: string[];
  stemCached: boolean;
  analysisCached: boolean;
  status: "planned" | "already-drums" | "no-audio" | "skipped-limit" | "ok" | "error";
  demucsSec?: number;
  analyzeSec?: number;
  importSec?: number;
  sectionsWithDrums?: number;
  totalBlocks?: number;
  error?: string;
}

interface SongFile {
  id: string;
  title: string;
  file: string;
  sections: { drumBlocks?: unknown[] }[];
}

function loadSongs(): SongFile[] {
  return fs
    .readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith(".trackdraft.json"))
    .sort()
    .map((f) => {
      const full = path.join(CATALOG_DIR, f);
      const raw = JSON.parse(fs.readFileSync(full, "utf8")) as { id?: string; title?: string; sections?: { drumBlocks?: unknown[] }[] };
      return { id: raw.id ?? f, title: raw.title ?? f, file: full, sections: raw.sections ?? [] };
    });
}

/** Expected demucs output for an audio file: <stems>/htdemucs/<slug>/drums.wav,
 *  with a normalized-name scan as a fallback when demucs sanitized the slug. */
function stemPathFor(audioFile: string): string | null {
  const slug = path.basename(audioFile, path.extname(audioFile));
  const direct = path.join(STEMS_DIR, "htdemucs", slug, "drums.wav");
  if (fs.existsSync(direct)) return direct;
  const htdemucs = path.join(STEMS_DIR, "htdemucs");
  if (!fs.existsSync(htdemucs)) return null;
  const target = normalize(slug);
  for (const dir of fs.readdirSync(htdemucs)) {
    if (normalize(dir) === target) {
      const candidate = path.join(htdemucs, dir, "drums.wav");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function analysisPathFor(audioFile: string): string {
  return path.join(ANALYSES_DIR, path.basename(audioFile, path.extname(audioFile)) + ".drum-analysis.json");
}

function backupSong(file: string): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, path.basename(file));
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
}

function run(cmd: string, cmdArgs: string[], label: string): { ok: boolean; sec: number; stderr: string } {
  const t0 = Date.now();
  const res = spawnSync(cmd, cmdArgs, { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
  const sec = (Date.now() - t0) / 1000;
  if (res.error || res.status !== 0) {
    const stderr = (res.stderr?.toString() ?? res.error?.message ?? "").trim().split("\n").slice(-6).join("\n");
    return { ok: false, sec, stderr: `${label} failed (exit ${res.status ?? "?"}): ${stderr}` };
  }
  return { ok: true, sec, stderr: "" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const candidates = walkAudio(AUDIO_ROOT);
console.log(`audio archive: ${candidates.length} files under ${AUDIO_ROOT}`);
const songs = loadSongs();
console.log(`catalog: ${songs.length} songs\n`);

const rows: SongRow[] = [];
for (const song of songs) {
  let best: Candidate | null = null;
  let bestScore = 0;
  const topNorms = new Set<string>();
  const target = normalize(song.title);
  for (const c of candidates) {
    const s = matchScore(target, c.norm);
    if (s > bestScore + 0.001) {
      bestScore = s;
      best = c;
      topNorms.clear();
    }
    if (Math.abs(s - bestScore) <= 0.001 && s >= 60) topNorms.add(c.norm);
  }
  const matched = bestScore >= 45 ? best : null;
  const hasDrums = song.sections.some((s) => Array.isArray(s.drumBlocks) && s.drumBlocks.length > 0);
  const row: SongRow = {
    id: song.id,
    title: song.title,
    file: song.file,
    sections: song.sections.length,
    hasDrums,
    album: matched?.album ?? null,
    audioFile: matched?.file ?? null,
    matchScore: Math.round(bestScore),
    ambiguousWith: topNorms.size > 1 ? [...topNorms] : [],
    stemCached: matched ? stemPathFor(matched.file) !== null : false,
    analysisCached: matched ? fs.existsSync(analysisPathFor(matched.file)) : false,
    status: "planned",
  };
  rows.push(row);
}

// Apply filters to build the run queue.
const filtered = rows.filter((r) => {
  if (ONLY && !`${r.title} ${r.id}`.toLowerCase().includes(ONLY)) return false;
  if (ALBUM && !(r.album && normalize(r.album).includes(ALBUM))) return false;
  return true;
});

if (LIST) {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  for (const r of filtered) {
    const flags = [
      r.hasDrums ? "drums✓" : "     ",
      r.stemCached ? "stem✓" : "     ",
      r.analysisCached ? "anlz✓" : "     ",
      r.matchScore ? `s${String(r.matchScore).padStart(3)}` : "MISS ",
      r.ambiguousWith.length ? "amb" : "   ",
    ].join(" ");
    console.log(`${pad(r.id, 38)} ${pad(r.title, 32)} ${pad(r.album ?? "—", 26)} ${pad(r.audioFile ? path.basename(r.audioFile) : "—", 30)} ${flags}`);
  }
  const matchedCount = filtered.filter((r) => r.audioFile).length;
  console.log(`\nmatched ${matchedCount}/${filtered.length}`);
  const missing = filtered.filter((r) => !r.audioFile);
  if (missing.length) console.log(`missing audio: ${missing.map((r) => `"${r.title}"`).join(", ")}`);
  process.exit(0);
}

const queue = filtered.filter((r) => r.audioFile && (FORCE || !r.hasDrums));
for (const r of filtered) {
  if (!r.audioFile) r.status = "no-audio";
  else if (!FORCE && r.hasDrums) r.status = "already-drums";
}
console.log(`queue: ${Math.min(queue.length, LIMIT)} of ${queue.length} songs would run${DRY ? " (dry run)" : ""}\n`);
if (DRY) {
  for (const r of queue.slice(0, LIMIT)) console.log(`  would run: ${r.id} (${r.title}) ← ${path.basename(r.audioFile!)}`);
  process.exit(0);
}

// Persisted report — read/merge/write after every song so a crash loses nothing.
function loadReport(): Record<string, SongRow> {
  try {
    const raw = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as { rows?: SongRow[] };
    return Object.fromEntries((raw.rows ?? []).map((r) => [r.id, r]));
  } catch {
    return {};
  }
}
function saveReport(byId: Record<string, SongRow>): void {
  const all = Object.values(byId).sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), rows: all }, null, 2) + "\n");
}
const report = loadReport();

let processed = 0;
for (const row of queue) {
  if (processed >= LIMIT) {
    row.status = "skipped-limit";
    report[row.id] = row;
    continue;
  }
  processed++;
  const tag = `[${processed}/${Math.min(queue.length, LIMIT)}] ${row.title}`;
  try {
    // 1. stem
    let stem = stemPathFor(row.audioFile!);
    if (!stem) {
      console.log(`${tag} — demucs… (this is the slow one)`);
      const res = run(DEMUCS, ["--two-stems=drums", "-o", STEMS_DIR, row.audioFile!], "demucs");
      if (!res.ok) throw new Error(res.stderr);
      row.demucsSec = Math.round(res.sec);
      stem = stemPathFor(row.audioFile!);
      if (!stem) throw new Error(`demucs finished but no drums.wav found for ${row.audioFile}`);
    } else {
      row.demucsSec = 0;
    }

    // 2. analysis
    const analysisPath = analysisPathFor(row.audioFile!);
    if (!fs.existsSync(analysisPath)) {
      fs.mkdirSync(ANALYSES_DIR, { recursive: true });
      const res = run("npx", ["tsx", "scripts/analyze-drums.ts", row.file, stem, "--out", analysisPath, "--steps", STEPS], "analyze-drums");
      if (!res.ok) throw new Error(res.stderr);
      row.analyzeSec = Math.round(res.sec);
    } else {
      row.analyzeSec = 0;
    }

    // 3. import (in place, backed up once)
    backupSong(row.file);
    const res = run("npx", ["tsx", "scripts/import-drum-analysis.ts", row.file, analysisPath, "--out", row.file], "import-drum-analysis");
    if (!res.ok) throw new Error(res.stderr);
    row.importSec = Math.round(res.sec);

    const after = JSON.parse(fs.readFileSync(row.file, "utf8")) as { sections: { drumBlocks?: unknown[] }[] };
    row.sectionsWithDrums = after.sections.filter((s) => Array.isArray(s.drumBlocks) && s.drumBlocks.length > 0).length;
    row.totalBlocks = after.sections.reduce((n, s) => n + (s.drumBlocks?.length ?? 0), 0);
    row.status = "ok";
    console.log(
      `${tag} — ✓ demucs ${row.demucsSec}s · analyze ${row.analyzeSec}s · import ${row.importSec}s · ` +
      `${row.sectionsWithDrums}/${after.sections.length} sections, ${row.totalBlocks} blocks`,
    );
  } catch (err) {
    row.status = "error";
    row.error = err instanceof Error ? err.message : String(err);
    console.error(`${tag} — ✗ ${row.error}`);
  }
  report[row.id] = row;
  saveReport(report);
}

console.log(`\n✓ report: ${REPORT_PATH}`);
const ok = Object.values(report).filter((r) => r.status === "ok").length;
const err = Object.values(report).filter((r) => r.status === "error").length;
console.log(`total songs with drums: ${ok} · errors: ${err}`);
