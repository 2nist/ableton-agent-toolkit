/**
 * Derive the initial narrative-form taxonomy empirically by clustering
 * song skeletons across three annotated corpora — McGill Billboard/SALAMI,
 * Rock Corpus, and the TrackDraft Beatles catalog — rather than
 * hand-authoring canonical forms.
 *
 * The clustering threshold (0.34) and minimum support (5) below aren't
 * arbitrary: they're the values measured against the McGill corpus to
 * produce a ~20-30 class taxonomy with musically sane exemplars (see the
 * package README). Re-running at a different threshold is one flag away.
 *
 * Run: npx tsx scripts/mine-corpora.ts
 * Env overrides: MCGILL_ROOT, ROCK_CORPUS_ROOT, CATALOG_ROOT
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fromMcgill,
  fromRockCorpus,
  fromBlueprintSong,
  toSkeleton,
  formDistance,
  matchLyrics,
  parseLrc,
  attachLyricCounts,
  type SectionToken,
  type CanonicalRole,
  type NarrativeForm,
} from "../src/index.js";
import { candidateIdFor, type NarrativeCandidate } from "../src/candidates.js";

const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const ROCK_CORPUS_ROOT = process.env.ROCK_CORPUS_ROOT ?? "/Users/Matthew/Rock Corpus-TDC";
const CATALOG_ROOT =
  process.env.CATALOG_ROOT ??
  path.join(import.meta.dirname, "..", "..", "..", "apps", "trackdraft", "scripts", "output", "catalog");

/** Distance at or below which a skeleton merges into an existing cluster. */
const CLUSTER_THRESHOLD = 0.34;
/** A cluster needs this many songs to become a canonical form; below it, queued as a candidate instead. */
const MIN_SUPPORT = 5;

const OUT_DIR = path.join(import.meta.dirname, "..", "src", "data");

const ROLE_DISPLAY: Record<CanonicalRole, string> = {
  verse: "Verse",
  chorus: "Chorus",
  pre_chorus: "Pre-Chorus",
  bridge: "Bridge",
  solo: "Solo",
  intro: "Intro",
  outro: "Outro",
  link: "Link",
  other: "Other",
};

interface SongSkeleton {
  corpus: string;
  songId: string;
  title: string;
  skeleton: CanonicalRole[];
}

interface LyricCandidateFile {
  title: string;
  artist: string;
  syncedLyrics: string;
}

function loadLyricCandidates(lyricsDir: string): LyricCandidateFile[] {
  if (!fs.existsSync(lyricsDir)) return [];
  const files = fs
    .readdirSync(lyricsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const candidates: LyricCandidateFile[] = [];
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(lyricsDir, file), "utf8"));
      if (record.syncedLyrics) {
        candidates.push({
          title: record.trackName ?? record.name ?? "",
          artist: record.artistName ?? "",
          syncedLyrics: record.syncedLyrics,
        });
      }
    } catch {
      // corrupt lyric file — skip, not fatal to the whole corpus
    }
  }
  return candidates;
}

function loadMcgill(): SongSkeleton[] {
  if (!fs.existsSync(MCGILL_ROOT)) {
    console.log(`McGill corpus not found at ${MCGILL_ROOT} — skipping`);
    return [];
  }
  const lyricCandidates = loadLyricCandidates(path.join(MCGILL_ROOT, "lyrics_from_lrclib"));
  const files = fs
    .readdirSync(MCGILL_ROOT)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const results: SongSkeleton[] = [];
  let parseFailures = 0;
  let lyricMatches = 0;

  for (const file of files) {
    let song: { title?: string; artist?: string; sections?: unknown[] };
    try {
      song = JSON.parse(fs.readFileSync(path.join(MCGILL_ROOT, file), "utf8"));
    } catch {
      parseFailures++;
      continue;
    }
    if (!song.sections || song.sections.length === 0) {
      parseFailures++;
      continue;
    }

    let tokens: SectionToken[] = fromMcgill(song as Parameters<typeof fromMcgill>[0]);
    const lyricMatch = matchLyrics(song.title ?? "", song.artist ?? "", lyricCandidates);
    if (lyricMatch) {
      lyricMatches++;
      tokens = attachLyricCounts(tokens, parseLrc(lyricMatch.syncedLyrics));
    }

    const { skeleton } = toSkeleton(tokens);
    if (skeleton.length === 0) continue;
    results.push({ corpus: "mcgill", songId: file.replace(/\.json$/, ""), title: song.title ?? file, skeleton });
  }

  console.log(`mcgill: ${results.length} skeletons (${parseFailures} parse/empty failures), ${lyricMatches} lyric matches`);
  return results;
}

function loadRockCorpus(): SongSkeleton[] {
  if (!fs.existsSync(ROCK_CORPUS_ROOT)) {
    console.log(`Rock Corpus not found at ${ROCK_CORPUS_ROOT} — skipping`);
    return [];
  }
  const lyricCandidates = loadLyricCandidates(path.join(ROCK_CORPUS_ROOT, "lyrics_from_lrclib"));
  const files = fs
    .readdirSync(ROCK_CORPUS_ROOT)
    .filter((f) => f.endsWith(".jcrd"))
    .sort();

  const results: SongSkeleton[] = [];
  let parseFailures = 0;
  let lyricMatches = 0;

  for (const file of files) {
    let song: { metadata?: { title?: string; artist?: string }; sections?: unknown[] };
    try {
      song = JSON.parse(fs.readFileSync(path.join(ROCK_CORPUS_ROOT, file), "utf8"));
    } catch {
      parseFailures++;
      continue;
    }
    if (!song.sections || song.sections.length === 0) {
      parseFailures++;
      continue;
    }

    const title = song.metadata?.title ?? file;
    const artist = song.metadata?.artist ?? "";
    let tokens: SectionToken[] = fromRockCorpus(song as Parameters<typeof fromRockCorpus>[0]);
    const lyricMatch = matchLyrics(title, artist, lyricCandidates);
    if (lyricMatch) {
      lyricMatches++;
      tokens = attachLyricCounts(tokens, parseLrc(lyricMatch.syncedLyrics));
    }

    const { skeleton } = toSkeleton(tokens);
    if (skeleton.length === 0) continue;
    results.push({ corpus: "rock-corpus", songId: file.replace(/\.jcrd$/, ""), title, skeleton });
  }

  console.log(
    `rock-corpus: ${results.length} skeletons (${parseFailures} parse/empty failures), ${lyricMatches} lyric matches`,
  );
  return results;
}

function loadCatalog(): SongSkeleton[] {
  if (!fs.existsSync(CATALOG_ROOT)) {
    console.log(`Beatles catalog not found at ${CATALOG_ROOT} — skipping`);
    return [];
  }
  const files = fs
    .readdirSync(CATALOG_ROOT)
    .filter((f) => f.endsWith(".trackdraft.json"))
    .sort();

  const results: SongSkeleton[] = [];
  let empty = 0;

  for (const file of files) {
    const song = JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, file), "utf8"));
    if (!song.sections || song.sections.length === 0) {
      empty++;
      continue;
    }
    const tokens = fromBlueprintSong(song);
    const { skeleton } = toSkeleton(tokens);
    if (skeleton.length === 0) {
      empty++;
      continue;
    }
    results.push({ corpus: "beatles-catalog", songId: song.id ?? file, title: song.title ?? file, skeleton });
  }

  console.log(`beatles-catalog: ${results.length} skeletons (${empty} empty/unmatched)`);
  return results;
}

function skeletonKey(skeleton: readonly CanonicalRole[]): string {
  return skeleton.join("-") || "(empty)";
}

interface SkeletonGroup {
  skeleton: CanonicalRole[];
  songs: SongSkeleton[];
}

function groupBySkeleton(all: SongSkeleton[]): SkeletonGroup[] {
  const map = new Map<string, SkeletonGroup>();
  for (const song of all) {
    const key = skeletonKey(song.skeleton);
    let group = map.get(key);
    if (!group) {
      group = { skeleton: song.skeleton, songs: [] };
      map.set(key, group);
    }
    group.songs.push(song);
  }
  return [...map.values()];
}

interface Cluster {
  leader: CanonicalRole[];
  members: SkeletonGroup[];
  totalSupport: number;
}

/**
 * Greedy leader clustering: process skeletons in deterministic
 * frequency-then-lexicographic order, joining each into the nearest
 * existing cluster if it's within CLUSTER_THRESHOLD, else founding a new
 * one. Frequency-first ordering means common forms become leaders (and
 * therefore get the more natural-looking canonical signature) rather than
 * an arbitrary rare variant.
 */
function clusterSkeletons(groups: SkeletonGroup[]): Cluster[] {
  const sorted = [...groups].sort((a, b) => {
    if (b.songs.length !== a.songs.length) return b.songs.length - a.songs.length;
    return skeletonKey(a.skeleton).localeCompare(skeletonKey(b.skeleton));
  });

  const clusters: Cluster[] = [];
  for (const group of sorted) {
    let best: Cluster | null = null;
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const dist = formDistance(group.skeleton, cluster.leader);
      if (dist < bestDist) {
        bestDist = dist;
        best = cluster;
      }
    }
    if (best && bestDist <= CLUSTER_THRESHOLD) {
      best.members.push(group);
      best.totalSupport += group.songs.length;
    } else {
      clusters.push({ leader: group.skeleton, members: [group], totalSupport: group.songs.length });
    }
  }
  return clusters;
}

function corpusBreakdown(cluster: Cluster): string {
  const counts = new Map<string, number>();
  for (const member of cluster.members) {
    for (const song of member.songs) counts.set(song.corpus, (counts.get(song.corpus) ?? 0) + 1);
  }
  return [...counts.entries()].map(([corpus, n]) => `${corpus}:${n}`).join(", ");
}

function buildForms(clusters: Cluster[]): { forms: NarrativeForm[]; report: string[] } {
  const accepted = clusters
    .filter((c) => c.totalSupport >= MIN_SUPPORT)
    .sort((a, b) => b.totalSupport - a.totalSupport || skeletonKey(a.leader).localeCompare(skeletonKey(b.leader)));

  const forms: NarrativeForm[] = [];
  const report: string[] = [];

  for (const cluster of accepted) {
    const exemplars = cluster.members
      .flatMap((m) => m.songs)
      .slice(0, 3)
      .map((s) => ({ corpus: s.corpus, songId: s.songId, title: s.title }));
    const variants = cluster.members.map((m) => m.skeleton).filter((sk) => skeletonKey(sk) !== skeletonKey(cluster.leader));

    forms.push({
      id: skeletonKey(cluster.leader).replace(/[()]/g, ""),
      name: cluster.leader.map((role) => ROLE_DISPLAY[role]).join("-") || "Empty",
      definition: "",
      signature: cluster.leader,
      variants: variants.length > 0 ? variants : undefined,
      exemplars,
      provenance: {
        addedAt: new Date().toISOString(),
        addedBy: "corpus-mining",
        derivedFrom: { corpus: corpusBreakdown(cluster), support: cluster.totalSupport, threshold: CLUSTER_THRESHOLD },
      },
    });
    report.push(`  ${String(cluster.totalSupport).padStart(4)}x  ${skeletonKey(cluster.leader)}  [${corpusBreakdown(cluster)}]`);
  }

  return { forms, report };
}

function buildCandidates(clusters: Cluster[]): NarrativeCandidate[] {
  return clusters
    .filter((c) => c.totalSupport < MIN_SUPPORT)
    .map((cluster) => ({
      id: candidateIdFor(cluster.leader),
      kind: "narrative" as const,
      status: "pending" as const,
      proposedName: "",
      proposedDefinition: "",
      signature: cluster.leader,
      support: cluster.totalSupport,
      exemplars: cluster.members
        .flatMap((m) => m.songs)
        .slice(0, 5)
        .map((s) => ({ corpus: s.corpus, songId: s.songId, title: s.title })),
      proposedAt: new Date().toISOString(),
    }));
}

function main(): void {
  const all = [...loadMcgill(), ...loadRockCorpus(), ...loadCatalog()];
  console.log(`\ntotal songs with a non-empty skeleton: ${all.length}`);

  const groups = groupBySkeleton(all);
  console.log(`distinct skeletons: ${groups.length}`);

  const clusters = clusterSkeletons(groups);
  console.log(`clusters at distance <= ${CLUSTER_THRESHOLD}: ${clusters.length}`);

  const { forms, report } = buildForms(clusters);
  const candidates = buildCandidates(clusters);

  console.log(`\ncanonical forms (support >= ${MIN_SUPPORT}):`);
  for (const line of report) console.log(line);
  console.log(`\ncandidates queued (support < ${MIN_SUPPORT}): ${candidates.length}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "narrative-forms.json"), JSON.stringify(forms, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "candidates.json"), JSON.stringify(candidates, null, 2));
  console.log(`\nwrote ${OUT_DIR}/narrative-forms.json (${forms.length} forms) and candidates.json (${candidates.length} candidates)`);
}

main();
