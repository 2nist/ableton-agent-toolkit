/**
 * Audit the auto-assignment engine over the whole catalog: what patterns
 * does `inferDrumPattern` choose per role, how often does the variant
 * picker land on the clean default (variant 0), and how often do sections
 * inside one song end up with literally identical grooves?
 *
 * Run: npx tsx scripts/audit-patterns.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { BlueprintSong } from "@music-theory/song-blueprint";
import {
  PRESET_DATA,
  inferDrumPattern,
  inferDrumStyle,
  songSignalsFor,
  styleAffinity,
  styleFamilyFor,
} from "@drum/library";
import { resolveSectionVariant, seededVariantIndex, variantCount } from "../src/lib/playback/drumPreview";

const CATALOG = path.join(import.meta.dirname, "output", "catalog");
const OUTPUT = path.join(import.meta.dirname, "output");

function auditSong(song: BlueprintSong): {
  entries: Array<{ role: string; pattern: string; variant: number; count: number; velocity: string }>;
} {
  const signals = songSignalsFor(song);
  const entries = song.sections.map((sec) => {
    const pattern = inferDrumPattern(
      {
        role: sec.role ?? undefined,
        velocity: sec.velocity ?? undefined,
        timeSignatureNumerator: sec.timeSignatureNumerator ?? 4,
        timeSignatureDenominator: 2 ** (sec.timeSignatureDenPower ?? 2),
        name: sec.name,
      },
      signals,
    );
    const variant = seededVariantIndex(pattern, sec as never, song as never, 0) ?? 0;
    const count = variantCount(pattern);
    return {
      role: sec.role ?? "(none)",
      pattern,
      variant: count > 0 ? Math.min(variant, count - 1) : 0,
      count,
      velocity: sec.velocity ?? "mf",
    };
  });
  return { entries };
}


/* ── drum health ───────────────────────────────────────────────────────────
 * The sections above audit the HEURISTIC. This audits what actually plays:
 * the pattern each section resolves to (explicit choice or inferred), how
 * much of the baked pool that draws on, and whether the result is a musical
 * groove or a wall of ghost notes.
 *
 * Why it exists: a listener reported "snare hits are often twice as much as
 * the kick" and "we're running a shallow beat pool". Both were true and
 * neither was visible in any report — the snare excess is 30-45% ghost notes
 * from the E-GMD takes, and 36% of sections took variant 0 by design.
 */

const KICK = 36;
const SNARE = 38;
const HATS = new Set([42, 44, 46]);
/** E-GMD ghost notes land here: real hits, but nowhere near the backbeat. */
const GHOST = 45;

interface Density {
  kick: number;
  snare: number;
  ghostSnare: number;
  hat: number;
  bars: number;
}

function emptyDensity(): Density {
  return { kick: 0, snare: 0, ghostSnare: 0, hat: 0, bars: 0 };
}

function addDensity(into: Density, notes: readonly [number, number, number][], lengthBeats: number, barBeats: number): void {
  into.bars += lengthBeats / (barBeats || 4);
  for (const [, pitch, velocity] of notes) {
    if (pitch === KICK) into.kick++;
    else if (pitch === SNARE) {
      into.snare++;
      if (velocity < GHOST) into.ghostSnare++;
    } else if (HATS.has(pitch)) into.hat++;
  }
}

function reportDrumHealth(files: string[]): void {
  const sourceSplit = { explicit: 0, inferred: 0, muted: 0, outline: 0 };
  const usedCombos = new Map<string, number>();
  const styleMatches = { exact: 0, neighbour: 0, outside: 0, noFamily: 0 };
  const styleByPattern = new Map<string, Set<string>>();
  const variantUse = new Map<string, Set<number>>();
  const density = new Map<string, Density>();
  let sections = 0;

  for (const file of files) {
    let song: BlueprintSong;
    try { song = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (!song.sections?.length) continue;

    song.sections.forEach((sec, index) => {
      sections++;
      const inferred = inferDrumPattern(
        {
          role: sec.role ?? undefined,
          velocity: sec.velocity ?? undefined,
          timeSignatureNumerator: sec.timeSignatureNumerator ?? 4,
          timeSignatureDenominator: 2 ** (sec.timeSignatureDenPower ?? 2),
          name: sec.name,
        },
        songSignalsFor(song),
      );

      if (sec.drumMeterOutline) sourceSplit.outline++;
      else if (sec.drumPattern === "none") sourceSplit.muted++;
      else if (sec.drumPattern) sourceSplit.explicit++;
      else sourceSplit.inferred++;

      // What actually plays — "none" resolves to silence, so skip it.
      if (sec.drumPattern === "none") return;
      const pattern = sec.drumPattern ?? inferred;
      const variant = resolveSectionVariant(sec as never, song as never, 0);
      if (!variant) return;
      const variantIdx = seededVariantIndex(pattern, sec as never, song as never, 0) ?? 0;
      usedCombos.set(`${pattern}·v${variantIdx}`, (usedCombos.get(`${pattern}·v${variantIdx}`) ?? 0) + 1);
      if (!variantUse.has(pattern)) variantUse.set(pattern, new Set());
      variantUse.get(pattern)!.add(variantIdx);

      // Does the performance come from the song's own tradition?
      const family = styleFamilyFor({
        genre: song.genre,
        concept: song.concept,
        title: song.title,
        instrumentation: song.notes?.instrumentation,
      });
      const chosenStyle = (PRESET_DATA[pattern as keyof typeof PRESET_DATA]?.variants[variantIdx] as
        | { style?: string }
        | undefined)?.style;
      if (!family) styleMatches.noFamily++;
      else if (chosenStyle === family) styleMatches.exact++;
      else if (chosenStyle && styleAffinity(family).includes(chosenStyle)) styleMatches.neighbour++;
      else styleMatches.outside++;
      if (chosenStyle) {
        if (!styleByPattern.has(pattern)) styleByPattern.set(pattern, new Set());
        styleByPattern.get(pattern)!.add(chosenStyle);
      }

      if (!density.has(pattern)) density.set(pattern, emptyDensity());
      addDensity(density.get(pattern)!, variant.notes, variant.lengthBeats, variant.beatsPerBar);
      void index;
    });
  }

  const available = Object.entries(PRESET_DATA).reduce((n, [, preset]) => n + preset.variants.length, 0);
  const playing = sections - sourceSplit.muted;

  console.log(`\ndrum health — what plays (${playing} of ${sections} sections; ${sourceSplit.muted} muted)`);
  console.log(`  source      : explicit ${sourceSplit.explicit} · inferred ${sourceSplit.inferred} · outline ${sourceSplit.outline} · muted ${sourceSplit.muted}`);
  console.log(`  beat pool   : ${usedCombos.size} of ${available} baked (pattern·variant) pairs in use`);

  console.log(`\n  ${"pattern".padEnd(14)} ${"sect".padStart(5)} ${"vars".padStart(5)} ${"kick/bar".padStart(9)} ${"snare/bar".padStart(10)} ${"ghost".padStart(6)} ${"snare:kick".padStart(11)}`);
  for (const [pattern, d] of [...density.entries()].sort((a, b) => b[1].bars - a[1].bars)) {
    const bars = Math.max(1, d.bars);
    const snarePerBar = d.snare / bars;
    const kickPerBar = d.kick / bars;
    const ghostShare = d.snare === 0 ? 0 : d.ghostSnare / d.snare;
    const accentSnare = d.snare - d.ghostSnare;
    const ratio = kickPerBar === 0 ? Infinity : snarePerBar / kickPerBar;
    const ratioAccent = kickPerBar === 0 ? Infinity : accentSnare / bars / kickPerBar;
    const ratioText = `${ratio.toFixed(2)}x (${ratioAccent.toFixed(2)}x)`;
    const flag = ratio > 2 && ratioAccent > 1.5 ? "  ← snare-led" : "";
    console.log(
      `  ${pattern.padEnd(14)} ${String(usedCombos.size && [...usedCombos.keys()].filter((k) => k.startsWith(`${pattern}·`)).reduce((n, k) => n + (usedCombos.get(k) ?? 0), 0)).padStart(5)} ` +
      `${String(variantUse.get(pattern)?.size ?? 0).padStart(5)} ${kickPerBar.toFixed(2).padStart(9)} ${snarePerBar.toFixed(2).padStart(10)} ` +
      `${(ghostShare * 100).toFixed(0).padStart(5)}% ${ratioText.padStart(11)}${flag}`,
    );
  }
  console.log(`  (snare:kick counts every snare; the bracketed figure ignores ghosts, which is the backbeat a listener hears)`);

  const styled = styleMatches.exact + styleMatches.neighbour + styleMatches.outside;
  const inFamily = styleMatches.exact + styleMatches.neighbour;
  console.log(
    `\n  style match  : ${inFamily}/${styled} playing sections drew from the song's own family or its neighbours ` +
      `(${styleMatches.exact} exact, ${styleMatches.neighbour} neighbour, ${styleMatches.outside} outside)` +
      (styleMatches.noFamily ? ` · ${styleMatches.noFamily} songs declare no recognisable genre` : ""),
  );
  for (const [pattern, styles] of [...styleByPattern.entries()].sort()) {
    if (styles.size > 1) console.log(`    ${pattern.padEnd(14)} draws from ${styles.size} families: ${[...styles].sort().join(", ")}`);
  }

  const neverPicked = Object.keys(PRESET_DATA).filter((p) => !density.has(p));
  if (neverPicked.length) console.log(`\n  never resolves: ${neverPicked.join(", ")}`);

  // Pool concentration: how much of the used pool carries the load.
  const sorted = [...usedCombos.entries()].sort((a, b) => b[1] - a[1]);
  const top10 = sorted.slice(0, 10).reduce((n, [, c]) => n + c, 0);
  console.log(`\n  pool concentration: top 10 combos cover ${(100 * top10 / Math.max(1, playing)).toFixed(0)}% of playing sections`);
  console.log(`  top 10: ${sorted.slice(0, 10).map(([k, c]) => `${k}×${c}`).join(" ")}`);
}

function main(): void {
  const files = [
    ...readdirSync(CATALOG).filter((f) => f.endsWith(".trackdraft.json")).map((f) => path.join(CATALOG, f)),
    ...readdirSync(OUTPUT).filter((f) => f.endsWith(".trackdraft.json")).map((f) => path.join(OUTPUT, f)),
  ];
  const patternHist = new Map<string, number>();
  const roleHist = new Map<string, Map<string, number>>();
  const velocityByRole = new Map<string, Map<string, number>>();
  let total = 0;
  let variantZero = 0;
  let adjacentIdentical = 0;
  let adjacentPairs = 0;
  const repetitive: string[] = [];
  const styleCount = { acoustic: 0, electronic: 0 };

  for (const file of files) {
    let song: BlueprintSong;
    try { song = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (!song.sections?.length) continue;
    styleCount[inferDrumStyle(songSignalsFor(song))]++;
    const { entries } = auditSong(song);
    total += entries.length;
    for (const e of entries) {
      patternHist.set(e.pattern, (patternHist.get(e.pattern) ?? 0) + 1);
      if (e.variant === 0 && e.count > 1) variantZero++;
      if (!roleHist.has(e.role)) roleHist.set(e.role, new Map());
      const rh = roleHist.get(e.role)!;
      rh.set(e.pattern, (rh.get(e.pattern) ?? 0) + 1);
      if (!velocityByRole.has(e.role)) velocityByRole.set(e.role, new Map());
      const vh = velocityByRole.get(e.role)!;
      vh.set(e.velocity, (vh.get(e.velocity) ?? 0) + 1);
    }
    // adjacency duplicates
    for (let i = 0; i + 1 < entries.length; i++) {
      adjacentPairs++;
      if (entries[i].pattern === entries[i + 1].pattern && entries[i].variant === entries[i + 1].variant) adjacentIdentical++;
    }
    // single combo dominance
    const combos = new Map<string, number>();
    for (const e of entries) combos.set(`${e.pattern}·v${e.variant}`, (combos.get(`${e.pattern}·v${e.variant}`) ?? 0) + 1);
    const top = [...combos.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= Math.max(3, entries.length * 0.4)) repetitive.push(`${path.basename(file, ".trackdraft.json")}: ${top[1]}/${entries.length} × ${top[0]}`);
  }

  console.log(`songs: ${files.length} · sections: ${total} · style: acoustic ${styleCount.acoustic} / electronic ${styleCount.electronic}`);
  console.log(`\npattern histogram:`);
  for (const [p, n] of [...patternHist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(14)} ${String(n).padStart(5)}  ${(100 * n / total).toFixed(1)}%`);
  }
  console.log(`\nvariant-0 (clean default) share among multi-variant picks: ${(100 * variantZero / Math.max(1, total)).toFixed(1)}%`);
  console.log(`adjacent section pairs with IDENTICAL groove: ${adjacentIdentical}/${adjacentPairs} (${(100 * adjacentIdentical / Math.max(1, adjacentPairs)).toFixed(1)}%)`);
  console.log(`\nrole → pattern:`);
  for (const [role, m] of [...roleHist.entries()].sort((a, b) => b[1].size - a[1].size)) {
    const items = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => `${p}×${n}`).join(" ");
    const vel = [...velocityByRole.get(role)!.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, n]) => `${v}×${n}`).join(" ");
    console.log(`  ${role.padEnd(12)} ${items}   [vel: ${vel}]`);
  }
  reportDrumHealth(files);

  console.log(`\nsongs dominated by one combo (≥40% or ≥3 sections): ${repetitive.length}`);
  for (const r of repetitive.slice(0, 12)) console.log(`  ${r}`);
  console.log(`  … ${Math.max(0, repetitive.length - 12)} more`);
}

main();
