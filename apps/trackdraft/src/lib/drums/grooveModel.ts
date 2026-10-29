import type { GrooveChoice as EngineGrooveChoice } from "@drum/library";
import { DRUM_PATTERN_OPTIONS } from "./patternOptions";
import type { BlueprintSection, DrumBlock, DrumPattern } from "../../types/blueprint";

/**
 * The groove, as ONE value.
 *
 * On disk a section carries five overlapping fields — `drumPattern`,
 * `drumVariantIndex`, `drumMeterOutline`, `drumBlocks`, and the lane mutes —
 * and the precedence between them used to live in prose. That is the bug
 * class this module removes: everything that asks "what plays here?" asks
 * `grooveOf`, and everything that changes it calls `applyGrooveChoice`.
 *
 * The five fields stay exactly as they are (the schema is shared with the
 * Ableton bridge and with every stored song), so this is an API, not a
 * migration. When the storage is next touched it can become a real
 * discriminated union without any caller changing.
 *
 * The READING half of this module (the union + `grooveOf`) now lives in
 * `@drum/library` so the browser and the Ableton bridge resolve the five
 * fields the same way; this file keeps the writing half (`applyGrooveChoice`,
 * which needs `drumBlocks` and the app's narrower pattern vocabulary) and
 * re-exports the reading half so existing call sites are unchanged.
 */

/** The engine's groove union with the pattern narrowed to what a section can
 *  actually STORE: `DRUM_PATTERN_OPTIONS` is a subset of the engine's union
 *  (synth-only idioms like `trap` are reachable by the heuristic but have no
 *  schema field), so this is the adapter, not a second list. */
export type GrooveChoice =
  | Exclude<EngineGrooveChoice, { kind: "preset" }>
  | { kind: "preset"; pattern: DrumPattern; variant?: number };

/** What this section's groove source currently is — a re-export of the
 *  engine's reading, so the app and the Ableton bridge can never disagree
 *  about which of the five fields wins. */
export { grooveOf } from "@drum/library";

/** Modes that write notes for a range, and so mask a newly chosen source. */
const RHYTHM_MODES: ReadonlySet<DrumBlock["mode"]> = new Set<DrumBlock["mode"]>([
  "steps",
  "euclid",
  "outline",
  "motion",
]);

/** FX-only blocks survive a groove change; they shape whatever plays. */
export function survivingBlocks(blocks: readonly DrumBlock[] | null | undefined): DrumBlock[] {
  return (blocks ?? []).filter((b) => !RHYTHM_MODES.has(b.mode));
}

/**
 * Change the whole-section groove.
 *
 * Clears the rhythm blocks authored against the previous groove: they splice
 * their notes over the new one, so leaving them would make the choice
 * inaudible exactly where the user had edited. Undo restores them — every
 * caller writes through the song store.
 */
export function applyGrooveChoice(section: BlueprintSection, choice: GrooveChoice): BlueprintSection {
  const kept = survivingBlocks(section.drumBlocks);
  const drumBlocks = kept.length > 0 ? kept : undefined;

  switch (choice.kind) {
    case "outline":
      return { ...section, drumBlocks, drumMeterOutline: choice.outline, drumPattern: undefined, drumVariantIndex: undefined };
    case "auto":
      return { ...section, drumBlocks, drumMeterOutline: undefined, drumPattern: undefined, drumVariantIndex: undefined };
    case "muted":
      return { ...section, drumBlocks, drumMeterOutline: undefined, drumPattern: "none", drumVariantIndex: undefined };
    case "preset":
      return {
        ...section,
        drumBlocks,
        drumMeterOutline: undefined,
        drumPattern: choice.pattern,
        drumVariantIndex: choice.variant ?? 0,
      };
  }
}

/**
 * The pattern vocabulary, grouped for a picker — derived from the canonical
 * list so a picker can never offer a pattern the resolver doesn't know (two
 * hardcoded copies of this existed in `DrumPatternTools`).
 */
export const ODD_METER_PATTERNS: readonly DrumPattern[] = ["78", "68", "54"];

/**
 * `DRUM_PATTERN_OPTIONS` is the canonical picker list (the engine's union is a
 * superset — it also carries synth-only idioms a section can't store), so the
 * one cast here is the adapter, not a second list.
 */
const IDIOMS: readonly DrumPattern[] = [
  "motown", "boom_bap", "train_beat", "bossa", "reggae",
  "disco", "afrobeat", "punk", "ballad", "second_line",
];

export const PATTERN_GROUPS: ReadonlyArray<{ label: string; patterns: DrumPattern[] }> = [
  {
    label: "Common",
    patterns: DRUM_PATTERN_OPTIONS.filter(
      (p) => !ODD_METER_PATTERNS.includes(p) && !IDIOMS.includes(p),
    ),
  },
  {
    label: "Grooves",
    patterns: DRUM_PATTERN_OPTIONS.filter((p) => IDIOMS.includes(p)),
  },
  {
    label: "Odd meter",
    patterns: DRUM_PATTERN_OPTIONS.filter((p) => ODD_METER_PATTERNS.includes(p)),
  },
];
