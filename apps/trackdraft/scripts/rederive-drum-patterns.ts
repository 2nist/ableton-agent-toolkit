/**
 * Re-derive the drum pattern slot for an existing catalogue.
 *
 * WHY THIS EXISTS
 * ---------------
 * `drumPattern` is the *user's override*. Ingest used to stamp
 * `"standard"` on every section it produced, which is worse than a default:
 * `resolveSectionVariant` reads `section.drumPattern ?? infer(...)`, so a
 * stamped value permanently wins and the heuristic never runs. The catalogue
 * audit found 653 sections all on `standard`, listening to the same groove,
 * while the inference that knows a chorus is `driving` and an intro is
 * `bridge_sparse` sat unused.
 *
 * This clears that stamp where it is provably ingest-default rather than a
 * human choice: every section in the song on `"standard"`, and no explicit
 * `drumVariantIndex`. It does NOT touch `"none"` — muting is a real decision
 * (a song with no drum source), so those are only reported.
 *
 *   npx tsx scripts/rederive-drum-patterns.ts                 # dry run
 *   npx tsx scripts/rederive-drum-patterns.ts --apply         # write
 *   npx tsx scripts/rederive-drum-patterns.ts --dir <dir>…    # other dirs
 *
 * Idempotent: a second run has nothing to clear.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { BlueprintSong } from "@music-theory/song-blueprint";
import { inferDrumPattern, inferDrumStyle, songSignalsFor } from "@drum/library";
import { deriveSectionVelocities, looksHardcoded } from "./catalog/velocity.js";

const OUTPUT = path.join(import.meta.dirname, "output");

interface Args {
  apply: boolean;
  dirs: string[];
  /**
   * Also clear whole-song mutes (`drumPattern: "none"` on every section).
   *
   * Off by default, and deliberately: mutes usually mean "this song had no
   * drum source", so un-muting hands it the genre heuristic's groove. That is
   * a musical decision, not a repair — but 101 of the 182 catalogue songs are
   * silent, and silence is a poor default in a tool whose whole point is
   * hearing the arrangement.
   */
  unmute: boolean;
  /**
   * Also re-derive section dynamics for songs whose every section sits on one
   * flat value (the `velocity: "mf"` ingest fingerprint). Dynamics gate the
   * heuristic's quiet/loud branches, so a flat song can only ever produce
   * mid-energy grooves.
   */
  velocity: boolean;
  /**
   * Stamp this style family onto songs that declare none. The corpus usually
   * knows its own style (a rock corpus is rock, Billboard is pop) even when
   * no individual file says so — and `styleFamilyFor` is what turns that into
   * drum performances from the matching tradition.
   */
  genre?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, dirs: [], unmute: false, velocity: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--apply":
        args.apply = true;
        break;
      case "--velocity":
        args.velocity = true;
        break;
      case "--unmute":
        args.unmute = true;
        break;
      case "--genre":
        args.genre = argv[++i];
        break;
      case "--dir":
        args.dirs.push(path.resolve(argv[++i]));
        break;
      default:
        throw new Error(`Unknown argument "${argv[i]}"`);
    }
  }
  if (args.dirs.length === 0) args.dirs.push(path.join(OUTPUT, "catalog"));
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const files: string[] = [];
  for (const dir of args.dirs) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".trackdraft.json")) files.push(path.join(dir, f));
    }
  }

  const cleared: string[] = [];
  const alreadyAuto: string[] = [];
  const allMuted: string[] = [];
  const mixed: string[] = [];
  const unmuted: string[] = [];
  const velocitiesDerived: string[] = [];
  const genresStamped: string[] = [];
  const afterByRole = new Map<string, Map<string, number>>();
  let sectionsCleared = 0;

  for (const file of files) {
    let song: BlueprintSong;
    try {
      song = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const sections = song.sections ?? [];
    if (sections.length === 0) continue;
    const id = path.basename(file, ".trackdraft.json");

    if (args.genre && !song.genre) {
      song.genre = args.genre;
      genresStamped.push(id);
      if (args.apply) writeFileSync(file, `${JSON.stringify(song, null, 2)}\n`);
    }

    if (args.velocity && looksHardcoded(sections)) {
      const derived = deriveSectionVelocities(sections);
      sections.forEach((section, i) => {
        section.velocity = derived[i]!;
      });
      velocitiesDerived.push(`${id} (${sections.length})`);
      if (args.apply) writeFileSync(file, `${JSON.stringify(song, null, 2)}\n`);
    }
    const patterns = sections.map((s) => s.drumPattern);

    if (patterns.every((p) => p === "none")) {
      if (!args.unmute) {
        allMuted.push(id);
        continue;
      }
      for (const section of sections) delete section.drumPattern;
      unmuted.push(id);
      sectionsCleared += sections.length;
      if (args.apply) writeFileSync(file, `${JSON.stringify(song, null, 2)}\n`);
      continue;
    }
    if (patterns.every((p) => p === undefined)) {
      alreadyAuto.push(id);
      continue;
    }
    const uniformlyStamped =
      patterns.every((p) => p === "standard") && sections.every((s) => s.drumVariantIndex === undefined);
    if (!uniformlyStamped) {
      mixed.push(id);
      continue;
    }

    for (const section of sections) {
      delete section.drumPattern;
      const inferred = inferDrumPattern(
        {
          role: section.role ?? undefined,
          velocity: section.velocity ?? undefined,
          timeSignatureNumerator: section.timeSignatureNumerator ?? 4,
          timeSignatureDenominator: 2 ** (section.timeSignatureDenPower ?? 2),
          name: section.name,
        },
        songSignalsFor(song),
      );
      if (!afterByRole.has(section.role ?? "(none)")) afterByRole.set(section.role ?? "(none)", new Map());
      const m = afterByRole.get(section.role ?? "(none)")!;
      m.set(inferred, (m.get(inferred) ?? 0) + 1);
    }
    sectionsCleared += sections.length;
    cleared.push(id);
    if (args.apply) writeFileSync(file, `${JSON.stringify(song, null, 2)}\n`);
  }

  console.log(`catalogue: ${files.length} songs across ${args.dirs.length} dir(s)`);
  console.log(`  cleared to auto  : ${cleared.length} songs (${sectionsCleared} sections)`);
  console.log(`  already auto     : ${alreadyAuto.length}`);
  console.log(
    args.unmute
      ? `  fully muted      : ${unmuted.length}  (un-muted → inferred, as asked)`
      : `  fully muted      : ${allMuted.length}  (left alone — "none" is a decision; --unmute to infer them)`,
  );
  console.log(`  hand-authored    : ${mixed.length}  (mixed/other patterns — left alone)`);
  if (args.genre) {
    console.log(`  genre stamped    : ${genresStamped.length} songs → "${args.genre}"`);
  }
  if (args.velocity) {
    console.log(`  flat dynamics    : ${velocitiesDerived.length}  (re-derived from role/arrangement shape)`);
  }

  if (afterByRole.size > 0) {
    console.log(`\npatterns the heuristic will now assign:`);
    for (const [role, m] of [...afterByRole.entries()].sort((a, b) => b[1].size - a[1].size)) {
      const items = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}×${n}`).join(" ");
      console.log(`  ${role.padEnd(12)} ${items}`);
    }
  }
  if (allMuted.length > 0) {
    console.log(`\nmuted songs (no drum source — worth revisiting). First 8:`);
    for (const id of allMuted.slice(0, 8)) console.log(`  ${id}`);
    if (allMuted.length > 8) console.log(`  … ${allMuted.length - 8} more`);
  }

  console.log(
    args.apply
      ? `\napplied.`
      : `\ndry run — nothing written. Add --apply to rewrite these ${cleared.length} songs.`,
  );
  void inferDrumStyle;
}

main();
