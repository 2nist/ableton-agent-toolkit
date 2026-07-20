import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { fromMcgill } from "../src/adapters.js";
import { toSkeleton } from "../src/skeleton.js";

/**
 * A regression guard on the skeleton-normalization pipeline, gated on the
 * McGill corpus actually being present on disk (it's local research data,
 * not checked into the repo). If this corpus isn't available, the suite
 * is skipped rather than failed — CI without the corpus stays green.
 *
 * The numbers below are the measured baseline: 739/742 files parse with
 * non-empty sections, and skeleton reduction collapses them to 157
 * distinct signatures. The assertions leave headroom (735/200) so a small,
 * legitimate shift in the corpus or normalization doesn't flake the test,
 * while a real regression (normalizeRole or toSkeleton breaking) would
 * blow well past either bound.
 */
const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const corpusAvailable = existsSync(MCGILL_ROOT);

describe.skipIf(!corpusAvailable)("McGill corpus golden numbers", () => {
  it("parses ~739 of 742 files and reduces to at most 200 distinct skeletons", () => {
    const files = readdirSync(MCGILL_ROOT).filter((f) => f.endsWith(".json"));
    let parsed = 0;
    const skeletons = new Set<string>();

    for (const file of files) {
      let song: { sections?: unknown[] };
      try {
        song = JSON.parse(readFileSync(path.join(MCGILL_ROOT, file), "utf8"));
      } catch {
        continue;
      }
      if (!song.sections || song.sections.length === 0) continue;
      parsed++;

      const { skeleton } = toSkeleton(fromMcgill(song as Parameters<typeof fromMcgill>[0]));
      if (skeleton.length > 0) skeletons.add(skeleton.join("-"));
    }

    expect(parsed).toBeGreaterThanOrEqual(735);
    expect(skeletons.size).toBeLessThanOrEqual(200);
  });
});
