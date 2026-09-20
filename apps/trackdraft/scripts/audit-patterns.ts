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
import { inferDrumPattern, inferDrumStyle, songSignalsFor } from "@drum/library";
import { seededVariantIndex, variantCount } from "../src/lib/playback/drumPreview";

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
  console.log(`\nsongs dominated by one combo (≥40% or ≥3 sections): ${repetitive.length}`);
  for (const r of repetitive.slice(0, 12)) console.log(`  ${r}`);
  console.log(`  … ${Math.max(0, repetitive.length - 12)} more`);
}

main();
