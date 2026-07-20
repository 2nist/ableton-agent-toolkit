/**
 * Repairs real catalog songs flagged by `audit-catalog.ts`, using the exact
 * same production functions the "Song text" editor calls — a scripted batch
 * pass standing in for manual review (no browser-automation tool exists to
 * click through 77 real songs by hand), not a reimplementation of the
 * editor's logic.
 *
 * Two repairs, deliberately asymmetric in how much they're trusted:
 *
 * - Chorus consolidation (mechanical, auto-applied): `detectRepeatedBlocks`
 *   + `assignLinesToSection`, identical to the "Mark all N as Chorus"
 *   button. Text is only ever moved, never invented, so this is safe to
 *   apply broadly.
 * - Intro repair (`repairSuspiciousIntros`): a section audited as
 *   "suspicious-intro" (real sung lyrics where the label says otherwise)
 *   gets relabeled `verse` — a role change only, no lines move. Reported
 *   with its trigger line count for every song rather than silently
 *   trusted, per this project's "assistive, not authoritative" rule.
 *
 * Run: npx tsx scripts/repair-catalog.ts [--dir scripts/output/catalog] [--dry-run]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fromBlueprintSong, classifyNarrative, NARRATIVE_FORMS } from "@music-theory/song-taxonomy";
import { auditSong, type AuditFlag } from "./audit-catalog";
import { buildLyricDocument, assignLinesToSection, detectRepeatedBlocks } from "../src/lib/lyrics/sectionize";
import type { BlueprintSong } from "../src/types/blueprint";

export interface RepairResult {
  song: BlueprintSong;
  changed: boolean;
  chorusBlocksApplied: number;
  introsRelabeled: { sectionName: string; lineCount: number }[];
}

/** For every section flagged `suspicious-intro`, relabel its role from
 *  `intro` to `verse`. Text and bounds are untouched — this only corrects
 *  a mislabeled container, it never carves or moves lines. */
export function repairSuspiciousIntros(song: BlueprintSong, flags: AuditFlag[]): { song: BlueprintSong; relabeled: { sectionName: string; lineCount: number }[] } {
  const suspicious = new Map(
    flags.filter((f): f is Extract<AuditFlag, { kind: "suspicious-intro" }> => f.kind === "suspicious-intro").map((f) => [f.sectionId, f]),
  );
  if (suspicious.size === 0) return { song, relabeled: [] };

  const relabeled: { sectionName: string; lineCount: number }[] = [];
  const sections = song.sections.map((section) => {
    const flag = suspicious.get(section.id);
    if (!flag) return section;
    relabeled.push({ sectionName: flag.sectionName, lineCount: flag.lineCount });
    return { ...section, role: "verse" as const };
  });
  return { song: { ...song, sections }, relabeled };
}

/**
 * Consolidate the top detected repeated block (if any) into real Chorus
 * sections, exactly as `LyricDocumentView`'s "Mark all N as Chorus" does:
 * batch-apply `assignLinesToSection` per occurrence, rebuilding the
 * document each time (line order/count never changes across these edits,
 * only section ownership, so the original occurrence index ranges stay
 * valid throughout — see the comment on this same pattern in
 * `LyricDocumentView.tsx`).
 *
 * **Gated on the song not already classifying confidently.** Measured via
 * `measure-repair-improvement.ts` against the real catalog: many
 * single-blob songs already have a *correct, complete role skeleton* —
 * `guessSectionRole` labeled every section right from its name alone
 * (verse/bridge/verse/bridge/verse) — with only the *lyric text* dumped
 * into one blob elsewhere. For those, splitting a short repeated phrase
 * out of the blob doesn't fix anything structural; it just inserts a
 * `chorus` token the mined taxonomy didn't see in that position, which
 * measurably *hurt* 15 real songs (all with a pre-repair score of
 * 0.86–1.00, all dropping after "repair") for exactly 1 real win. The fix
 * isn't a smarter consolidation heuristic — it's not touching a skeleton
 * that already works. `classifyNarrative` already encodes "not confident"
 * as `formId: null`; reusing that instead of inventing a new threshold. */
export function repairChorusBlob(song: BlueprintSong, flags: AuditFlag[]): { song: BlueprintSong; applied: number } {
  const isSingleBlob = flags.some((f) => f.kind === "single-blob");
  if (!isSingleBlob) return { song, applied: 0 };

  const preRepairMatch = classifyNarrative(fromBlueprintSong(song), NARRATIVE_FORMS);
  if (preRepairMatch.formId !== null) return { song, applied: 0 };

  const doc = buildLyricDocument(song);
  const blocks = detectRepeatedBlocks(doc);
  if (blocks.length === 0) return { song, applied: 0 };

  const top = blocks[0];
  let current = song;
  top.occurrences.forEach((occ, i) => {
    current = assignLinesToSection(current, buildLyricDocument(current), occ, {
      role: "chorus",
      name: top.occurrences.length > 1 ? `Chorus ${i + 1}` : "Chorus",
    });
  });
  return { song: current, applied: top.occurrences.length };
}

/** Uses the exact same canonical line-splitting as the editor itself
 *  (`buildLyricDocument`), rather than a naive re-derivation — an earlier
 *  version compared raw `lyricsTimeline` entries directly, which falsely
 *  flagged text loss on every repaired single-blob song: the *before*
 *  snapshot saw one giant multi-line blob as a single "line" (the bug
 *  `buildLyricDocument` itself just got fixed for), while *after* repair
 *  the same content was correctly split into real lines — identical
 *  content, spuriously "different" under the old, inconsistent check. */
function totalLyricText(song: BlueprintSong): string {
  return buildLyricDocument(song)
    .map((l) => l.text)
    .filter((l) => l.length > 0)
    .sort()
    .join("|");
}

export function repairSong(song: BlueprintSong): RepairResult {
  const flags = auditSong(song);
  const before = totalLyricText(song);

  const introResult = repairSuspiciousIntros(song, flags);
  const chorusResult = repairChorusBlob(introResult.song, flags);

  const after = totalLyricText(chorusResult.song);
  if (after !== before) {
    throw new Error(`repair changed total lyric text for "${song.title}" — refusing to write (text loss guardrail)`);
  }

  return {
    song: chorusResult.song,
    changed: introResult.relabeled.length > 0 || chorusResult.applied > 0,
    chorusBlocksApplied: chorusResult.applied,
    introsRelabeled: introResult.relabeled,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dirFlagIndex = args.indexOf("--dir");
  const dir = dirFlagIndex !== -1 ? args[dirFlagIndex + 1] : path.join(import.meta.dirname, "output", "catalog");
  const dryRun = args.includes("--dry-run");

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let changedCount = 0;
  let chorusTotal = 0;
  let introTotal = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const song: BlueprintSong = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const result = repairSong(song);
    if (!result.changed) continue;

    changedCount++;
    chorusTotal += result.chorusBlocksApplied;
    introTotal += result.introsRelabeled.length;

    console.log(`${file}:`);
    if (result.chorusBlocksApplied > 0) console.log(`  consolidated ${result.chorusBlocksApplied} repeated lines into Chorus sections`);
    for (const r of result.introsRelabeled) console.log(`  relabeled "${r.sectionName}" intro -> verse (${r.lineCount} sung lines)`);

    if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(result.song, null, 2));
  }

  console.log(`\n${dryRun ? "[dry run] would change" : "changed"} ${changedCount}/${files.length} songs`);
  console.log(`  chorus consolidations: ${chorusTotal}`);
  console.log(`  intro relabels: ${introTotal}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
