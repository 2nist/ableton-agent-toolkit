/**
 * Classify every song across the three mining corpora against the bundled
 * narrative-form taxonomy and report coverage — the verification step for
 * the mining output, not a data-writing step (see mine-corpora.ts for
 * that). Run after `npm run mine`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fromMcgill,
  fromRockCorpus,
  fromBlueprintSong,
  classifyNarrative,
  matchLyrics,
  parseLrc,
  attachLyricCounts,
  type SectionToken,
} from "../src/index.js";
import narrativeForms from "../src/data/narrative-forms.json" with { type: "json" };
import candidatesData from "../src/data/candidates.json" with { type: "json" };
import type { NarrativeForm } from "../src/types.js";
import type { NarrativeCandidate } from "../src/candidates.js";

const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const ROCK_CORPUS_ROOT = process.env.ROCK_CORPUS_ROOT ?? "/Users/Matthew/Rock Corpus-TDC";
const CATALOG_ROOT =
  process.env.CATALOG_ROOT ??
  path.join(import.meta.dirname, "..", "..", "..", "apps", "trackdraft", "scripts", "output", "catalog");

const taxonomy = narrativeForms as NarrativeForm[];

function loadLyricCandidates(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return r.syncedLyrics ? { title: r.trackName ?? r.name ?? "", artist: r.artistName ?? "", syncedLyrics: r.syncedLyrics } : null;
      } catch {
        return null;
      }
    })
    .filter((c): c is { title: string; artist: string; syncedLyrics: string } => c !== null);
}

let total = 0;
let matched = 0;

function classifyAll(tokensList: SectionToken[][], label: string): void {
  let localMatched = 0;
  for (const tokens of tokensList) {
    const match = classifyNarrative(tokens, taxonomy);
    total++;
    if (match.formId) {
      matched++;
      localMatched++;
    }
  }
  console.log(`  ${label}: ${localMatched}/${tokensList.length} classified`);
}

function main(): void {
  if (fs.existsSync(MCGILL_ROOT)) {
    const lyricCandidates = loadLyricCandidates(path.join(MCGILL_ROOT, "lyrics_from_lrclib"));
    const files = fs.readdirSync(MCGILL_ROOT).filter((f) => f.endsWith(".json"));
    const tokensList: SectionToken[][] = [];
    for (const file of files) {
      try {
        const song = JSON.parse(fs.readFileSync(path.join(MCGILL_ROOT, file), "utf8"));
        if (!song.sections?.length) continue;
        let tokens = fromMcgill(song);
        const lyricMatch = matchLyrics(song.title ?? "", song.artist ?? "", lyricCandidates);
        if (lyricMatch) tokens = attachLyricCounts(tokens, parseLrc(lyricMatch.syncedLyrics));
        tokensList.push(tokens);
      } catch {
        // skip
      }
    }
    classifyAll(tokensList, "mcgill");
  }

  if (fs.existsSync(ROCK_CORPUS_ROOT)) {
    const lyricCandidates = loadLyricCandidates(path.join(ROCK_CORPUS_ROOT, "lyrics_from_lrclib"));
    const files = fs.readdirSync(ROCK_CORPUS_ROOT).filter((f) => f.endsWith(".jcrd"));
    const tokensList: SectionToken[][] = [];
    for (const file of files) {
      try {
        const song = JSON.parse(fs.readFileSync(path.join(ROCK_CORPUS_ROOT, file), "utf8"));
        if (!song.sections?.length) continue;
        let tokens = fromRockCorpus(song);
        const lyricMatch = matchLyrics(song.metadata?.title ?? "", song.metadata?.artist ?? "", lyricCandidates);
        if (lyricMatch) tokens = attachLyricCounts(tokens, parseLrc(lyricMatch.syncedLyrics));
        tokensList.push(tokens);
      } catch {
        // skip
      }
    }
    classifyAll(tokensList, "rock-corpus");
  }

  if (fs.existsSync(CATALOG_ROOT)) {
    const files = fs.readdirSync(CATALOG_ROOT).filter((f) => f.endsWith(".trackdraft.json"));
    const tokensList: SectionToken[][] = [];
    for (const file of files) {
      const song = JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, file), "utf8"));
      if (!song.sections?.length) continue;
      tokensList.push(fromBlueprintSong(song));
    }
    classifyAll(tokensList, "beatles-catalog");
  }

  const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : "0";
  console.log(`\ntotal: ${matched}/${total} classified (${pct}%)`);

  const candidates = candidatesData as NarrativeCandidate[];
  console.log(`pending candidates on file: ${candidates.filter((c) => c.status === "pending").length}`);
}

main();
