/**
 * Formalizes the catalog data-quality audit as a real, rerunnable script
 * instead of a remembered number in a plan document. Scans every exported
 * catalog blueprint and reports, per song, exactly which data-quality
 * problems it has — the concrete worklist `repair-catalog.ts` consumes.
 *
 * Run: npx tsx scripts/audit-catalog.ts [--dir scripts/output/catalog]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintSong, BlueprintSection } from "../src/types/blueprint";

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

function lyricLineCount(section: BlueprintSection): number {
  if (section.lyricsTimeline && section.lyricsTimeline.length > 0) return section.lyricsTimeline.length;
  if (section.lyrics) return section.lyrics.split("\n").filter((l) => l.trim().length > 0).length;
  return 0;
}

function hasLyrics(section: BlueprintSection): boolean {
  return lyricLineCount(section) > 0;
}

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

function summarize(audits: SongAudit[]): void {
  const counts: Record<AuditFlag["kind"], number> = {
    "single-blob": 0,
    "missing-lyrics": 0,
    "custom-role": 0,
    "suspicious-intro": 0,
    "bad-timing": 0,
  };
  for (const audit of audits) for (const flag of audit.flags) counts[flag.kind]++;

  console.log("catalog audit summary");
  console.log(`  songs with any flag: ${audits.length}`);
  console.log(`  single-blob songs:        ${audits.filter((a) => a.flags.some((f) => f.kind === "single-blob")).length}`);
  console.log(`  missing-lyrics songs:     ${audits.filter((a) => a.flags.some((f) => f.kind === "missing-lyrics")).length}`);
  console.log(`  songs w/ custom role:     ${audits.filter((a) => a.flags.some((f) => f.kind === "custom-role")).length}`);
  console.log(`  suspicious-intro sections:${counts["suspicious-intro"]}`);
  console.log(`  bad-timing sections:      ${counts["bad-timing"]}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const dirFlagIndex = args.indexOf("--dir");
  const dir = dirFlagIndex !== -1 ? args[dirFlagIndex + 1] : path.join(import.meta.dirname, "output", "catalog");

  const audits = auditCatalog(dir);
  summarize(audits);

  const outPath = path.join(import.meta.dirname, "output", "catalog-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(audits, null, 2));
  console.log(`\nwrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
