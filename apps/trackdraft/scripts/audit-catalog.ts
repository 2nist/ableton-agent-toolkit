/**
 * Full 5-dimension quality audit for the Beatles catalog.
 *
 * Run:  npx tsx scripts/audit-catalog.ts
 *
 * Reads every .trackdraft.json in scripts/output/catalog/, correlates
 * with its JCRD source and LRCLIB match, scores sections / chords /
 * timing / lyrics / honeycomb-walk coverage, and writes a single
 * catalog-audit.json with per-song scores, tier classifications, and
 * actionable flags.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { NOTE_TO_PC, SCALE_INTERVALS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSong, BlueprintSection } from "../src/types/blueprint";

// ----------------------------------------------------------------- types

export interface DimensionScore {
  score: number;
  issues: string[];
}

export interface SongAuditResult {
  file: string;
  songId: string;
  title: string;
  artist?: string;
  key: string;
  scale: string;
  bpm: number;
  sectionCount: number;
  totalChords: number;
  lyricSource: "synced" | "plain" | "none";
  confidence: number;
  tier: "high" | "review" | "manual";
  sections: DimensionScore;
  chords: DimensionScore;
  timing: DimensionScore;
  lyrics: DimensionScore;
  honeycomb: DimensionScore;
}

export interface CatalogAuditSummary {
  generatedAt: string;
  totalSongs: number;
  tierCounts: { high: number; review: number; manual: number };
  dimAverages: Record<string, number>;
  worstSongs: Array<{ title: string; confidence: number; topIssues: string[] }>;
  globalFlags: string[];
}

export interface CatalogAudit {
  summary: CatalogAuditSummary;
  songs: SongAuditResult[];
}

// ----------------------------------------------------------------- helpers

function lyricLineCount(s: BlueprintSection): number {
  if (s.lyricsTimeline && s.lyricsTimeline.length > 0) return s.lyricsTimeline.length;
  if (s.lyrics) return s.lyrics.split("\n").filter((l) => l.trim().length > 0).length;
  return 0;
}

function hasLyrics(s: BlueprintSection): boolean {
  return lyricLineCount(s) > 0;
}

// ------------------------------------------------- flag-based audit
//
// A separate, structured-flag analysis (as opposed to the dimension-score
// model above) -- this is the API `repair-catalog.ts` actually consumes to
// know *which* sections to fix and how. Restored from commit 6579d64 after
// f8f8608's dimension-score rewrite dropped it while leaving repair-catalog.ts
// (and its tests) still depending on it.

export type AuditFlag =
  | { kind: "single-blob"; sectionId: string; sectionName: string; lineCount: number }
  | { kind: "missing-lyrics" }
  | { kind: "custom-role"; sectionId: string; sectionName: string }
  | { kind: "suspicious-intro"; sectionId: string; sectionName: string; lineCount: number }
  | { kind: "bad-timing"; sectionId: string; sectionName: string; reason: string };

export interface SongAudit {
  file: string;
  songId: string;
  title: string;
  flags: AuditFlag[];
}

/** Same order-of-magnitude as the verified `get_ready_rare_earth` case (12–13 sung lines
 *  in a section labeled Intro proved it was a mislabeled verse/chorus). */
const SUSPICIOUS_INTRO_LINE_THRESHOLD = 6;

/** Non-monotonic timeline, or a timed span that wildly mismatches the
 *  section's declared bar length (>2x or <0.5x) — either means the
 *  timing data can't be trusted to derive real bar counts from. */
function timingProblem(section: BlueprintSection): string | null {
  const timeline = section.lyricsTimeline;
  if (!timeline || timeline.length < 2) return null;

  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].startBeat <= timeline[i - 1].startBeat) {
      return `non-monotonic startBeat at line ${i} (${timeline[i].startBeat} <= ${timeline[i - 1].startBeat})`;
    }
  }

  const span = timeline[timeline.length - 1].startBeat - timeline[0].startBeat;
  const declaredBeats = section.bars * section.timeSignatureNumerator;
  if (declaredBeats > 0 && span > 0) {
    const ratio = span / declaredBeats;
    if (ratio > 2 || ratio < 0.5) {
      return `timed span ${span.toFixed(1)} beats vs declared ${declaredBeats} beats (${ratio.toFixed(2)}x)`;
    }
  }
  return null;
}

export function auditSong(song: BlueprintSong): AuditFlag[] {
  const flags: AuditFlag[] = [];
  const withLyrics = song.sections.filter(hasLyrics);

  if (withLyrics.length === 0) {
    flags.push({ kind: "missing-lyrics" });
  } else if (withLyrics.length === 1 && song.sections.length >= 3) {
    const section = withLyrics[0];
    flags.push({ kind: "single-blob", sectionId: section.id, sectionName: section.name, lineCount: lyricLineCount(section) });
  }

  for (const section of song.sections) {
    // A "custom" role is only a problem when the section actually carries
    // musical content (chords or lyrics) — a real section whose label the
    // normalizer failed to recognize. Content-free boundary markers
    // ("silence", "applause") are *correctly* custom; flagging those too
    // would swamp the real signal, since nearly every song has one.
    if (section.role === "custom" && (section.chords.length > 0 || hasLyrics(section))) {
      flags.push({ kind: "custom-role", sectionId: section.id, sectionName: section.name });
    }
    if (section.role === "intro") {
      const lines = lyricLineCount(section);
      if (lines > SUSPICIOUS_INTRO_LINE_THRESHOLD) {
        flags.push({ kind: "suspicious-intro", sectionId: section.id, sectionName: section.name, lineCount: lines });
      }
    }
    const problem = timingProblem(section);
    if (problem) flags.push({ kind: "bad-timing", sectionId: section.id, sectionName: section.name, reason: problem });
  }

  return flags;
}

export function auditCatalog(dir: string): SongAudit[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const audits: SongAudit[] = [];
  for (const file of files) {
    const song: BlueprintSong = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const flags = auditSong(song);
    if (flags.length > 0) audits.push({ file, songId: song.id, title: song.title, flags });
  }
  return audits;
}

// ------------------------------------------------------------- sections

function scoreSections(song: BlueprintSong): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  for (const s of song.sections) {
    if (s.chords.length === 0 && hasLyrics(s)) {
      issues.push('section "' + s.name + '" has lyrics but no chords');
      score -= 0.05;
    }
  }

  const customCount = song.sections.filter(
    (s) => s.role === "custom" && (s.chords.length > 0 || hasLyrics(s)),
  ).length;
  if (customCount > 0) {
    issues.push(customCount + ' section(s) labeled "custom" despite content');
    score -= Math.min(0.15, customCount * 0.05);
  }

  for (const s of song.sections) {
    if (s.role === "intro") {
      const lines = lyricLineCount(s);
      if (lines > 6) {
        issues.push('intro "' + s.name + '" has ' + lines + ' lines -- maybe mislabeled verse');
        score -= 0.05;
      }
    }
  }

  const names = song.sections.map((s) => s.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    issues.push("duplicate names: " + [...new Set(dupes)].join(", "));
    score -= 0.1;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --------------------------------------------------------------- chords

function scoreChords(song: BlueprintSong, jcrdChordCount: number | null): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  const allChords = song.sections.flatMap((s) => s.chords);

  if (jcrdChordCount !== null && allChords.length !== jcrdChordCount) {
    const delta = allChords.length - jcrdChordCount;
    issues.push(
      "chord count mismatch: BP=" + allChords.length +
      " vs JCRD=" + jcrdChordCount +
      " (delta=" + (delta > 0 ? "+" : "") + delta + ")",
    );
    score -= 0.2;
  }

  for (const c of allChords) {
    if (!c.beats || isNaN(c.beats) || c.beats <= 0) {
      issues.push("chord " + c.root + c.quality + " has invalid beats=" + c.beats);
      score -= 0.1;
      break;
    }
    if (!(c.root in NOTE_TO_PC)) {
      issues.push('unrecognized root "' + c.root + '"');
      score -= 0.05;
    }
  }

  for (const s of song.sections) {
    const density = s.bars > 0 ? s.chords.length / s.bars : 0;
    if (s.chords.length > 0 && density < 0.5) {
      issues.push(
        'sparse chords in "' + s.name + '" (' +
        s.chords.length + " over " + s.bars + " bars)",
      );
      score -= 0.02;
    }
    // Chord track should (nearly) tile the section: `snapProgressionToGrid`
    // promises at most a ≤3-beat tail rest; anything larger means the
    // annotation stops early and looping playback restarts the cycle under
    // the tail (see `repair-chord-tracks.ts`).
    if (s.chords.length > 0) {
      const beatsPerBar = (s.timeSignatureNumerator ?? 4) * (4 / 2 ** (s.timeSignatureDenPower ?? 2));
      const totalBeats = s.chords.reduce((sum, c) => sum + (c.beats > 0 ? c.beats : 0), 0);
      const gap = s.bars * beatsPerBar - totalBeats;
      if (gap > 3) {
        issues.push('chord track ends ' + gap + ' beats short in "' + s.name + '"');
        score -= 0.02;
      }
    }
  }

  if (jcrdChordCount === null) {
    issues.push("could not correlate JCRD source");
    score -= 0.05;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --------------------------------------------------------------- timing

function scoreTiming(song: BlueprintSong): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  for (const s of song.sections) {
    const tl = s.lyricsTimeline;
    if (!tl || tl.length < 2) continue;
    for (let i = 1; i < tl.length; i++) {
      if (tl[i].startBeat <= tl[i - 1].startBeat) {
        issues.push(
          '"' + s.name + '" non-monotonic at line ' + i +
          " (" + tl[i].startBeat + " <= " + tl[i - 1].startBeat + ")",
        );
        score -= 0.08;
        break;
      }
    }
    const span = tl[tl.length - 1].startBeat - tl[0].startBeat;
    const declared = s.bars * s.timeSignatureNumerator;
    if (declared > 0 && span > 0) {
      const ratio = span / declared;
      if (ratio > 2.5 || ratio < 0.3) {
        issues.push(
          '"' + s.name + '" lyric span ' + span.toFixed(1) +
          "b vs declared " + declared + "b",
        );
        score -= 0.05;
      }
    }
  }

  const totalBars = song.sections.reduce((sum, s) => sum + s.bars, 0);
  if (totalBars < 4) {
    issues.push("total song length " + totalBars + " bars -- suspiciously short");
    score -= 0.1;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --------------------------------------------------------------- lyrics

function scoreLyrics(song: BlueprintSong, hasSyncedLyrics: boolean): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  if (!hasSyncedLyrics) {
    if (song.sections.some(hasLyrics)) {
      issues.push("plain lyrics only (no timestamps)");
      score -= 0.3;
    } else {
      issues.push("no LRCLIB match");
      score -= 0.4;
    }
  }

  const totalLines = song.sections.reduce((sum, s) => sum + lyricLineCount(s), 0);
  if (totalLines === 0) {
    issues.push("zero lyric lines");
    score = Math.min(score, 0.5);
  }

  const sectionsWithLyrics = song.sections.filter(hasLyrics);
  if (sectionsWithLyrics.length === 1 && song.sections.length >= 3) {
    const blob = sectionsWithLyrics[0];
    issues.push("all " + lyricLineCount(blob) + ' lines in single section "' + blob.name + '"');
    score -= 0.2;
  }

  for (const s of song.sections) {
    if ((s.role === "verse" || s.role === "chorus") && !hasLyrics(s) && hasSyncedLyrics) {
      issues.push(s.role + ' "' + s.name + '" has no lyrics');
      score -= 0.03;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// ----------------------------------------------------------- honeycomb

function scoreHoneycomb(song: BlueprintSong): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  const allChords = song.sections.flatMap((s) => s.chords);
  if (allChords.length === 0) {
    return { score: 0, issues: ["no chords"] };
  }

  const pcs = new Set(allChords.map((c) => NOTE_TO_PC[c.root as NoteName] ?? -1));
  pcs.delete(-1);
  const chromCoverage = pcs.size / 12;
  if (chromCoverage < 0.25) {
    issues.push("chromatic coverage " + pcs.size + "/12");
    score -= 0.1;
  }

  const keyPc = NOTE_TO_PC[song.key as NoteName] ?? 0;
  const scale = (song.scale as ScaleType) || "ionian";
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const diatSet = new Set(intervals.map((i) => (keyPc + i) % 12));
  const diatHits = [...pcs].filter((pc) => diatSet.has(pc)).length;
  const diatCoverage = diatHits / 7;
  if (diatCoverage < 0.5) {
    issues.push("diatonic coverage " + diatHits + "/7 for " + song.key + " " + scale);
    score -= 0.1;
  }

  const uniqueNames = new Set(allChords.map((c) => c.root + c.quality));
  const richness = uniqueNames.size / allChords.length;
  if (richness < 0.05 && allChords.length > 20) {
    issues.push("low variety: " + uniqueNames.size + "/" + allChords.length + " unique");
    score -= 0.05;
  }

  const borrowed = allChords.filter((c) => {
    const pc = NOTE_TO_PC[c.root as NoteName];
    return pc !== undefined && !diatSet.has(pc);
  }).length;
  const borrowRatio = borrowed / allChords.length;
  if (borrowRatio > 0.5) {
    issues.push(
      borrowed + "/" + allChords.length + " borrowed chords -- key may be wrong",
    );
    score -= 0.15;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// ------------------------------------------------------- JCRD index

interface JcrdRef {
  chordCount: number;
  rawTitle: string;
  rawKey: string;
  rawBpm: number;
  sectionCount: number;
}

function loadJcrdIndex(): Map<string, JcrdRef> {
  const jcrdDir = "/Users/Matthew/Beatles Data/Beatles-Chords";
  if (!fs.existsSync(jcrdDir)) return new Map();

  const index = new Map<string, JcrdRef>();
  for (const file of fs.readdirSync(jcrdDir)) {
    if (!file.endsWith(".jcrd.json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(jcrdDir, file), "utf8"));
      const title = (raw.metadata?.title ?? file)
        .replace(/_/g, " ")
        .replace("CD1 -", "")
        .replace("CD2 -", "")
        .trim();
      const jcrdCount = (raw.sections ?? []).reduce(
        (sum: number, s: any) =>
          sum + (s.chords ?? []).filter((c: any) => c.chord && c.chord !== "N").length,
        0,
      );
      const key = raw.metadata?.key?.replace("Key ", "") ?? "?";
      index.set(title.toLowerCase(), {
        chordCount: jcrdCount,
        rawTitle: title,
        rawKey: key,
        rawBpm: raw.metadata?.tempo ?? 0,
        sectionCount: (raw.sections ?? []).length,
      });
    } catch {}
  }
  return index;
}

function findJcrdMatch(bpTitle: string, index: Map<string, JcrdRef>): JcrdRef | null {
  const key = bpTitle.toLowerCase();
  if (index.has(key)) return index.get(key)!;
  const stripped = key.replace(/^\\d+\\s*[-–]\\s*/, "");
  if (index.has(stripped)) return index.get(stripped)!;
  for (const [jcrdTitle, ref] of index) {
    const bpWords = new Set(key.split(/\\s+/).filter((w) => w.length > 2));
    const jcrdWords = new Set(jcrdTitle.split(/\\s+/).filter((w) => w.length > 2));
    const combined = [...bpWords].filter((w) => jcrdWords.has(w));
    if (combined.length >= 3) return ref;
  }
  return null;
}

// --------------------------------------------------------------- tier

function classifyTier(confidence: number): "high" | "review" | "manual" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "review";
  return "manual";
}

// --------------------------------------------------------------- main

const WEIGHTS: Record<string, number> = {
  sections: 0.15,
  chords: 0.25,
  timing: 0.15,
  lyrics: 0.30,
  honeycomb: 0.15,
};

function main(): void {
  const bpDir = path.join(import.meta.dirname, "output", "catalog");
  const files = fs.readdirSync(bpDir).filter((f) => f.endsWith(".json")).sort();
  const jcrdIndex = loadJcrdIndex();

  const songs: SongAuditResult[] = [];

  for (const file of files) {
    const bpPath = path.join(bpDir, file);
    const song: BlueprintSong = JSON.parse(fs.readFileSync(bpPath, "utf8"));

    const hasTimeline = song.sections.some(
      (s) => s.lyricsTimeline && s.lyricsTimeline.length > 0,
    );
    const hasPlain = !hasTimeline && song.sections.some(
      (s) => s.lyrics && s.lyrics.length > 0,
    );
    const lyricSource: SongAuditResult["lyricSource"] =
      hasTimeline ? "synced" : hasPlain ? "plain" : "none";

    const jcrd = findJcrdMatch(song.title, jcrdIndex);

    const sections = scoreSections(song);
    const chords = scoreChords(song, jcrd?.chordCount ?? null);
    const timing = scoreTiming(song);
    const lyrics = scoreLyrics(song, lyricSource === "synced");
    const honeycomb = scoreHoneycomb(song);

    const confidence =
      sections.score * WEIGHTS.sections +
      chords.score * WEIGHTS.chords +
      timing.score * WEIGHTS.timing +
      lyrics.score * WEIGHTS.lyrics +
      honeycomb.score * WEIGHTS.honeycomb;

    songs.push({
      file,
      songId: song.id,
      title: song.title,
      artist: song.artist,
      key: song.key,
      scale: song.scale,
      bpm: song.bpm,
      sectionCount: song.sections.length,
      totalChords: song.sections.reduce((sum, s) => sum + s.chords.length, 0),
      lyricSource,
      confidence: Math.round(confidence * 1000) / 1000,
      tier: classifyTier(confidence),
      sections,
      chords,
      timing,
      lyrics,
      honeycomb,
    });
  }

  const tierCounts = { high: 0, review: 0, manual: 0 };
  for (const s of songs) tierCounts[s.tier]++;

  const dimAverages: Record<string, number> = {};
  for (const dim of ["sections", "chords", "timing", "lyrics", "honeycomb"]) {
    dimAverages[dim] =
      Math.round(
        (songs.reduce((sum, s) => sum + (s as any)[dim].score, 0) / songs.length) * 1000,
      ) / 1000;
  }

  const sorted = [...songs].sort((a, b) => a.confidence - b.confidence);
  const worstSongs = sorted.slice(0, 15).map((s) => ({
    title: s.title,
    confidence: s.confidence,
    topIssues: [
      ...s.lyrics.issues,
      ...s.chords.issues,
      ...s.sections.issues,
      ...s.timing.issues,
    ].slice(0, 5),
  }));

  const globalFlags: string[] = [];
  const plainCount = songs.filter((s) => s.lyricSource === "plain").length;
  const noneCount = songs.filter((s) => s.lyricSource === "none").length;
  if (plainCount > 0) globalFlags.push(plainCount + " songs plain lyrics only (no timestamps)");
  if (noneCount > 0) globalFlags.push(noneCount + " songs no LRCLIB match");
  globalFlags.push(
    "Average confidence: " +
    (songs.reduce((s, r) => s + r.confidence, 0) / songs.length * 100).toFixed(1) + "%",
  );

  const summary: CatalogAuditSummary = {
    generatedAt: new Date().toISOString(),
    totalSongs: songs.length,
    tierCounts,
    dimAverages,
    worstSongs,
    globalFlags,
  };

  const audit: CatalogAudit = { summary, songs };

  const outPath = path.join(import.meta.dirname, "output", "catalog-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2));
  console.log("Wrote " + outPath);
  console.log("\\nSummary:");
  console.log("  Total songs: " + songs.length);
  console.log("  High confidence: " + tierCounts.high + " (" + (tierCounts.high / songs.length * 100).toFixed(0) + "%)");
  console.log("  Review recommended: " + tierCounts.review + " (" + (tierCounts.review / songs.length * 100).toFixed(0) + "%)");
  console.log("  Manual review: " + tierCounts.manual + " (" + (tierCounts.manual / songs.length * 100).toFixed(0) + "%)");
  console.log(
    "  Dims: sec=" + dimAverages.sections.toFixed(2) +
    " ch=" + dimAverages.chords.toFixed(2) +
    " tm=" + dimAverages.timing.toFixed(2) +
    " ly=" + dimAverages.lyrics.toFixed(2) +
    " hc=" + dimAverages.honeycomb.toFixed(2),
  );
}

if (import.meta.url === "file://" + process.argv[1]) main();
