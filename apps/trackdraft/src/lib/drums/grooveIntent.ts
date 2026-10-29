/**
 * Re-exported from `grooveModel` — the groove API lives in ONE module.
 *
 * Kept as a path because `withGrooveChoice` reads naturally at call sites
 * that patch extra fields alongside the source (a variant step, an outline
 * build). New code should import from `grooveModel`.
 */
export { survivingBlocks as survivingBlocksFrom, applyGrooveChoice } from "./grooveModel";
import { applyGrooveChoice } from "./grooveModel";
import type { BlueprintSection } from "../../types/blueprint";

/** Apply a groove change AND extra section fields in one write. */
export function withGrooveChoice(
  section: BlueprintSection,
  patch: Partial<BlueprintSection>,
  choice?: Parameters<typeof applyGrooveChoice>[1],
): BlueprintSection {
  const { drumPattern, drumVariantIndex, drumMeterOutline, ...rest } = patch;
  const base = choice
    ? applyGrooveChoice(section, choice)
    : applyGrooveChoice(section, {
        kind: drumMeterOutline ? "outline" : drumPattern === "none" ? "muted" : drumPattern ? "preset" : "auto",
        ...(drumMeterOutline ? { outline: drumMeterOutline } : {}),
        ...(drumPattern && drumPattern !== "none" ? { pattern: drumPattern, variant: drumVariantIndex } : {}),
      } as Parameters<typeof applyGrooveChoice>[1]);
  return { ...base, ...rest };
}
