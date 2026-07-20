/**
 * Joins the Beatles chord-annotation corpus (Isophonics, via
 * Beatles-Chords/*.jcrd.json) with LRCLIB-matched synced lyrics
 * (lyrics_from_lrclib/*.json, already fetched separately) into draft
 * .trackdraft.json blueprints — same "draft for review in TrackDraft's
 * UI" philosophy as ingest-lalo-chezia.ts, just for known/catalog songs
 * instead of lalo-chezia's originals.
 *
 * Run: npx tsx scripts/ingest-beatles-catalog.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseBeatlesJcrd } from "./catalog/beatlesJcrd.js";
import { parseLrc } from "./catalog/lrc.js";
import { normalizeTitle } from "./catalog/normalizeTitle.js";
import { catalogSongToBlueprintSong } from "./catalog/toBlueprintSong.js";

const CHORDS_DIR = "/Users/Matthew/beatles data/Beatles-Chords";
const LRCLIB_DIR = "/Users/Matthew/beatles data/lyrics_from_lrclib";
const OUTPUT_DIR = path.join(import.meta.dirname, "output", "catalog");

interface LrclibMatch {
  trackName: string;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadLrclibIndex(): Map<string, LrclibMatch> {
  const index = new Map<string, LrclibMatch>();
  for (const file of fs.readdirSync(LRCLIB_DIR)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(LRCLIB_DIR, file), "utf8")) as LrclibMatch;
    if (!data.trackName) continue;
    index.set(normalizeTitle(data.trackName), data);
  }
  return index;
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const lrclibIndex = loadLrclibIndex();

  const chordFiles = fs.readdirSync(CHORDS_DIR).filter((f) => f.endsWith(".jcrd.json"));
  console.log(`Found ${chordFiles.length} chord files, ${lrclibIndex.size} LRCLIB matches.\n`);

  let matched = 0;
  let synced = 0;

  for (const file of chordFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(CHORDS_DIR, file), "utf8"));
    const parsed = parseBeatlesJcrd(raw);
    const lrclib = lrclibIndex.get(normalizeTitle(parsed.title));

    const hasSyncedLyrics = Boolean(lrclib?.syncedLyrics);
    const lyricLines = lrclib
      ? hasSyncedLyrics
        ? parseLrc(lrclib.syncedLyrics!)
        : lrclib.plainLyrics
          ? [{ text: lrclib.plainLyrics, startSec: 0 }]
          : []
      : undefined;

    const id = `beatles-${slugify(parsed.title)}`;
    const song = catalogSongToBlueprintSong({ id, raw: parsed, lyricLines, hasSyncedLyrics });

    fs.writeFileSync(path.join(OUTPUT_DIR, `${id}.trackdraft.json`), JSON.stringify(song, null, 2));

    if (lrclib) matched += 1;
    if (hasSyncedLyrics) synced += 1;

    console.log(
      `${parsed.title.padEnd(40)} sections=${song.sections.length} chords=${song.sections.reduce((n, s) => n + s.chords.length, 0)} lyrics=${
        hasSyncedLyrics ? "synced" : lrclib ? "plain" : "none"
      }`,
    );
  }

  console.log(`\n${chordFiles.length} songs processed, ${matched} matched to LRCLIB (${synced} with synced timing).`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main();
