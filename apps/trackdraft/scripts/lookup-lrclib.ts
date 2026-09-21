/**
 * LRCLIB lookup — the CLI form of the app's "lookup" stage: query LRCLIB
 * for a song's lyrics (exact get → fielded search → free-text search),
 * prefer line-timed (syncedLyrics) records, and save the record JSON in
 * the shape the import pipeline consumes (chordmini-bridge --lyrics /
 * song-blueprint LrclibData: { trackName, artistName, syncedLyrics,
 * plainLyrics }).
 *
 *   npx tsx scripts/lookup-lrclib.ts "The Flaming Lips" "Pilot Can at the Queer of God" --out lyrics.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeTitle } from "./catalog/normalizeTitle.js";

const UA = "TrackDraft-Lookup/1.0 (https://github.com/2nist/ableton-agent-toolkit)";

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

function parseArgs(argv: string[]): { artist: string; title: string; out: string | null } {
  let artist = "";
  let title = "";
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else if (!artist) artist = argv[i];
    else if (!title) title = argv[i];
  }
  return { artist, title, out };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<{ status: number; data: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() };
  }
  return { status: 0, data: null };
}

function score(c: LrclibRecord, title: string, artist: string): number {
  let s = 0;
  if (c.syncedLyrics && c.syncedLyrics.trim()) s += 3;
  if (normalizeTitle(c.trackName ?? "") === normalizeTitle(title)) s += 3;
  if (normalizeTitle(c.artistName ?? "") === normalizeTitle(artist)) s += 2;
  return s;
}

function pickBest(candidates: LrclibRecord[], title: string, artist: string): LrclibRecord | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => score(b, title, artist) - score(a, title, artist))[0];
}

async function main(): Promise<void> {
  const { artist, title, out } = parseArgs(process.argv.slice(2));
  if (!artist || !title) {
    console.error('Usage: npx tsx scripts/lookup-lrclib.ts "<artist>" "<title>" [--out file.json]');
    process.exit(1);
  }
  const q = encodeURIComponent;
  let record: LrclibRecord | null = null;
  let via = "";

  // 1) exact get
  const exact = await fetchJson(`https://lrclib.net/api/get?artist_name=${q(artist)}&track_name=${q(title)}`);
  if (exact.status === 200 && exact.data) {
    record = exact.data as LrclibRecord;
    via = "get";
  }
  // 2) fielded search
  if (!record) {
    const s1 = await fetchJson(`https://lrclib.net/api/search?artist_name=${q(artist)}&track_name=${q(title)}`);
    if (s1.status === 200 && Array.isArray(s1.data) && s1.data.length > 0) {
      record = pickBest(s1.data as LrclibRecord[], title, artist);
      via = "fielded-search";
    }
  }
  // 3) free-text
  if (!record) {
    const s2 = await fetchJson(`https://lrclib.net/api/search?q=${q(`${artist} ${title}`)}`);
    if (s2.status === 200 && Array.isArray(s2.data) && s2.data.length > 0) {
      record = pickBest(s2.data as LrclibRecord[], title, artist);
      via = "free-search";
    }
  }

  if (!record) {
    console.error(`✗ no LRCLIB match for "${artist} — ${title}"`);
    process.exit(1);
  }

  const hasSynced = Boolean(record.syncedLyrics && record.syncedLyrics.trim());
  const syncedLines = hasSynced ? record.syncedLyrics!.split("\n").filter((l) => l.trim()).length : 0;
  console.log(`✓ ${record.artistName} — ${record.trackName} (via ${via})`);
  console.log(
    `  ${hasSynced ? `synced lyrics, ${syncedLines} lines` : record.plainLyrics ? "plain lyrics only" : "instrumental / no lyrics"} · ${record.duration ? `${Math.round(record.duration)}s` : "duration n/a"} · album: ${record.albumName ?? "-"}`,
  );

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          trackName: record.trackName,
          artistName: record.artistName,
          albumName: record.albumName,
          duration: record.duration,
          instrumental: record.instrumental ?? false,
          plainLyrics: record.plainLyrics ?? null,
          syncedLyrics: record.syncedLyrics ?? null,
          lrclibId: record.id,
          lookedUpAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`  saved → ${out}`);
  }
}

main();
