/**
 * Turns an `ImportedSection` into the drum fields to merge onto a section.
 *
 * Merge onto a section made by the app's own constructors (addSection /
 * createEmptySong) rather than building BlueprintSection by hand — that way
 * every non-drum required field keeps its default:
 *
 *   updateSection(song, id, (s) => ({ ...s, ...toSectionPatch(imported) }))
 *
 * Structural copies of the schema types keep this file import-free.
 */
import type { DrumBlock, ImportedSection } from "./gridToBlocks.js";
import type { DrumPattern as EngineDrumPattern } from "../presets.js";

/** types.ts:30 / VELOCITY_MAP types.ts:34. */
export type VelocityPreset = "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff";
export const VELOCITY_MAP: Record<VelocityPreset, number> = {
  ppp: 32, pp: 48, p: 64, mp: 80, mf: 96, f: 112, ff: 120, fff: 127,
};
/** The presets a base pattern can be — re-exported from the engine's own union
 *  so an import can carry any pattern the app can store. */
export type DrumPattern = EngineDrumPattern;

export function nearestVelocityPreset(v: number): VelocityPreset {
  let best: VelocityPreset = "mf";
  let bestD = Infinity;
  for (const [preset, n] of Object.entries(VELOCITY_MAP) as [VelocityPreset, number][]) {
    const d = Math.abs(n - v);
    if (d < bestD) { best = preset; bestD = d; }
  }
  return best;
}

export interface SectionDrumPatch {
  /**
   * Defaults to `"none"`: a muted base + the imported blocks is the pure
   * path. Since the null-base fix in `planSectionDrumNotes`
   * (packages/drum-library/src/section.ts — the blocks-only branch), blocks
   * compile over a null base exactly like they preview, with no automatic
   * fills/transitions/crash layered underneath. Pass a real pattern (e.g.
   * "standard", or "68"/"78"/"54" for those meters) to opt into the legacy
   * arrangement, where the converter's clear blocks are what keep that base
   * silent.
   */
  drumPattern: DrumPattern;
  velocity: VelocityPreset;
  drumBlocks: DrumBlock[];
}

export function toSectionPatch(
  imp: ImportedSection, opts: { basePattern?: DrumPattern } = {},
): SectionDrumPatch {
  return {
    drumPattern: opts.basePattern ?? "none",
    velocity: nearestVelocityPreset(imp.velocity),
    drumBlocks: imp.blocks,
  };
}
