/**
 * lookup-metadata.ts — song metadata enrichment via free, no-key APIs.
 *
 * Queries iTunes Search, MusicBrainz, Wikipedia, and Deezer (including
 * Deezer's per-track BPM where available) for a given artist + title and
 * writes a merged metadata JSON. This is the automated "what do we know
 * about this song?" step for the ingestion pipeline — release year, album,
 * genre, background info, and an external BPM cross-check.
 *
 * Usage:
 *   npx tsx scripts/lookup-metadata.ts "<artist>" "<title>" [--out <file.json>]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const UA = "TrackDraft-Metadata/0.1 (local dev enrichment step)";

function parseArgs(): { artist: string; title: string; out?: string } {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && i + 1 < args.length) {
      out = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length < 2) {
    console.error('Usage: npx tsx scripts/lookup-metadata.ts "<artist>" "<title>" [--out <file.json>]');
    process.exit(1);
  }
  return { artist: positional[0], title: positional[1], out };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleScore(candidate: string | undefined, target: string): number {
  if (!candidate) return 0;
  const a = norm(candidate);
  const b = norm(target);
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  return 0;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

interface ItunesPick {
  trackName?: string; artistName?: string; collectionName?: string;
  releaseDate?: string; primaryGenreName?: string; trackTimeMillis?: number;
}

async function lookupItunes(artist: string, title: string) {
  const term = encodeURIComponent(`${artist} ${title}`);
  const json = (await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`)) as {
    results?: ItunesPick[];
  };
  const results = json.results ?? [];
  results.sort((a, b) => titleScore(b.trackName, title) - titleScore(a.trackName, title));
  const best = results[0];
  if (!best) return null;
  return {
    trackName: best.trackName,
    artistName: best.artistName,
    album: best.collectionName,
    year: best.releaseDate?.slice(0, 4),
    genre: best.primaryGenreName,
    durationSec: best.trackTimeMillis ? Math.round(best.trackTimeMillis / 1000) : undefined,
  };
}

async function lookupMusicBrainz(artist: string, title: string) {
  await sleep(1100); // MusicBrainz rate limit: 1 req/sec
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  const json = (await getJson(
    `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=3`,
  )) as {
    recordings?: Array<{
      title?: string;
      "first-release-date"?: string;
      "artist-credit"?: Array<{ name?: string }>;
      releases?: Array<{ title?: string; date?: string }>;
    }>;
  };
  const rec = json.recordings?.[0];
  if (!rec) return null;
  return {
    title: rec.title,
    artist: rec["artist-credit"]?.[0]?.name,
    firstReleaseDate: rec["first-release-date"],
    releases: (rec.releases ?? []).slice(0, 3).map((r) => ({ title: r.title, date: r.date })),
  };
}

async function lookupWikipedia(artist: string, title: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  const search = (await getJson(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${q}&limit=3`,
  )) as { pages?: Array<{ key: string; title: string; description?: string }> };
  const top = search.pages?.[0];
  if (!top) return null;
  const summary = (await getJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.key)}`,
  )) as { title?: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
  return {
    page: summary.title,
    description: summary.description,
    extract: summary.extract?.slice(0, 600),
    url: summary.content_urls?.desktop?.page,
  };
}

async function lookupDeezer(artist: string, title: string) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const search = (await getJson(`https://api.deezer.com/search?q=${q}&limit=3`)) as {
    data?: Array<{ id: number; title?: string; artist?: { name?: string }; album?: { title?: string }; duration?: number }>;
  };
  const hit = search.data?.[0];
  if (!hit) return null;
  let bpm: number | undefined;
  try {
    const detail = (await getJson(`https://api.deezer.com/track/${hit.id}`)) as { bpm?: number };
    if (detail.bpm && detail.bpm > 0) bpm = detail.bpm;
  } catch { /* bpm optional */ }
  return {
    track: hit.title,
    artist: hit.artist?.name,
    album: hit.album?.title,
    durationSec: hit.duration,
    bpm,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { artist, title, out } = parseArgs();
  console.log(`Looking up metadata: "${title}" — ${artist}`);

  const [itunes, wikipedia, deezer, musicbrainz] = await Promise.all([
    lookupItunes(artist, title).catch((e) => ({ error: String(e) })),
    lookupWikipedia(artist, title).catch((e) => ({ error: String(e) })),
    lookupDeezer(artist, title).catch((e) => ({ error: String(e) })),
    lookupMusicBrainz(artist, title).catch((e) => ({ error: String(e) })),
  ]);

  const result = {
    query: { artist, title },
    fetchedAt: new Date().toISOString(),
    itunes, musicbrainz, wikipedia, deezer,
  };

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`✅ Written: ${out}`);
  }

  const i = itunes as { album?: string; year?: string; genre?: string; durationSec?: number; error?: string } | null;
  if (i && !i.error) {
    console.log(`   iTunes:  ${i.album} (${i.year ?? "?"}) — ${i.genre ?? "?"}, ${i.durationSec ?? "?"}s`);
  }
  const d = deezer as { album?: string; durationSec?: number; bpm?: number; error?: string };
  if (d && !d.error) {
    console.log(`   Deezer:  ${d.album ?? "?"} — ${d.durationSec ?? "?"}s${d.bpm ? ` | BPM ${d.bpm}` : ""}`);
  }
  const w = wikipedia as { page?: string; description?: string; extract?: string };
  if (w && w.page) {
    console.log(`   Wiki:    ${w.description ?? ""} — ${(w.extract ?? "").slice(0, 110)}…`);
  }
  const m = musicbrainz as { firstReleaseDate?: string; releases?: Array<{ title?: string; date?: string }> };
  if (m && m.firstReleaseDate) {
    console.log(`   MB:      first release ${m.firstReleaseDate} — ${m.releases?.[0]?.title ?? "?"}`);
  }
}

main();
