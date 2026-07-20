/**
 * Step 5 of the repair-and-measure plan: compare `classifyNarrative`
 * results before vs. after the Step 3 repair, across the entire audited
 * problem set — one real, measured percentage, not an anecdote. Re-mining
 * `narrative-forms.json` stays out of scope until this number exists.
 *
 * Run: npx tsx scripts/measure-repair-improvement.ts --before <dir> --after <dir>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fromBlueprintSong, classifyNarrative, NARRATIVE_FORMS } from "@music-theory/song-taxonomy";
import { auditSong } from "./audit-catalog";
import type { BlueprintSong } from "../src/types/blueprint";

function classify(song: BlueprintSong) {
  return classifyNarrative(fromBlueprintSong(song), NARRATIVE_FORMS);
}

function main(): void {
  const args = process.argv.slice(2);
  const beforeDir = args[args.indexOf("--before") + 1];
  const afterDir = args[args.indexOf("--after") + 1];
  if (!beforeDir || !afterDir) {
    console.error("usage: measure-repair-improvement.ts --before <dir> --after <dir>");
    process.exit(1);
  }

  const files = fs.readdirSync(beforeDir).filter((f) => f.endsWith(".json")).sort();

  let flaggedCount = 0;
  let improved = 0;
  let unchanged = 0;
  let regressed = 0;
  const rows: string[] = [];

  for (const file of files) {
    const beforeSong: BlueprintSong = JSON.parse(fs.readFileSync(path.join(beforeDir, file), "utf8"));
    const flags = auditSong(beforeSong);
    // Only measure over songs the audit actually flagged — the repair
    // pass is a no-op everywhere else, so including unflagged songs would
    // just dilute the number with songs that couldn't possibly change.
    if (flags.length === 0) continue;
    flaggedCount++;

    const afterPath = path.join(afterDir, file);
    if (!fs.existsSync(afterPath)) continue;
    const afterSong: BlueprintSong = JSON.parse(fs.readFileSync(afterPath, "utf8"));

    const beforeMatch = classify(beforeSong);
    const afterMatch = classify(afterSong);

    const beforeScore = beforeMatch.formId === null ? 0 : beforeMatch.score;
    const afterScore = afterMatch.formId === null ? 0 : afterMatch.score;

    if (afterScore > beforeScore + 1e-9) {
      improved++;
      rows.push(`  IMPROVED  ${beforeSong.title}: ${beforeMatch.formId ?? "null"} (${beforeScore.toFixed(2)}) -> ${afterMatch.formId ?? "null"} (${afterScore.toFixed(2)})`);
    } else if (afterScore < beforeScore - 1e-9) {
      regressed++;
      rows.push(`  REGRESSED ${beforeSong.title}: ${beforeMatch.formId ?? "null"} (${beforeScore.toFixed(2)}) -> ${afterMatch.formId ?? "null"} (${afterScore.toFixed(2)})`);
    } else {
      unchanged++;
    }
  }

  console.log(`flagged songs measured: ${flaggedCount}`);
  console.log(`  improved:  ${improved}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  regressed: ${regressed}`);
  console.log(`\nimprovement rate: ${flaggedCount > 0 ? ((improved / flaggedCount) * 100).toFixed(1) : "0.0"}%`);
  console.log("\ndetail:");
  for (const row of rows) console.log(row);
}

main();
