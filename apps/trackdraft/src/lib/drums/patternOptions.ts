import { PRESET_DATA } from "@drum/library";
import type { DrumPattern } from "../../types/blueprint";

/**
 * The one picker vocabulary.
 *
 * This list lived in `playback/drumPreview`, which meant anything that wanted
 * to offer a pattern had to import the whole resolver — and `DrumPatternTools`
 * instead kept two hardcoded copies of it. It now lives in its own leaf module
 * so the model (`grooveModel`) and the UI can depend on the vocabulary without
 * depending on the resolver.
 */
export const DRUM_PATTERN_OPTIONS: DrumPattern[] = [
  "none",
  // the acoustic energy ladder
  "kick_only",
  "standard",
  "half_time",
  "driving",
  "bridge_sparse",
  "intense",
  // machine idioms
  "four_on_floor",
  "trap",
  "breakbeat",
  "dnb",
  // named written grooves
  "motown",
  "boom_bap",
  "train_beat",
  "bossa",
  "reggae",
  "disco",
  "afrobeat",
  "punk",
  "ballad",
  "second_line",
  // odd meters
  "78",
  "68",
  "54",
];

/** How many baked variants a pattern has (0 for "auto"/"none"). */
export function variantCount(pattern: DrumPattern | undefined): number {
  return pattern ? (PRESET_DATA[pattern]?.variants.length ?? 0) : 0;
}
