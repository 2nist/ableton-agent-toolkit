import raw from "./presets-data.json" with { type: "json" };
import type { DrumPattern } from "./presets.js";

/**
 * Compact wire format for a resolved groove — fewer bytes than a named-key
 * object, which matters because this data gets bundled directly into
 * `trackdraft-bridge`'s extension.js.
 */
export type PackedNote = [beat: number, pitch: number, velocity: number];

export interface PackedPreset {
  /** Quarter-note-beat span of one loop — see `grooveLengthBeats` for why this isn't a bar count. */
  lengthBeats: number;
  variants: PackedNote[][];
}

/**
 * Curated, Ableton-safe groove variants per `DrumPattern`, generated offline
 * by `scripts/build-presets.ts` from a full E-GMD extraction.
 *
 * This is what makes the library usable from inside an Ableton extension at
 * all: the extension has no filesystem access to the E-GMD corpus and has
 * no business resolving segments or scoring feel at runtime, so all of that
 * happens once, here, ahead of time. A preset is absent from this object
 * for one of two reasons — `none` and `78` have no target by design (see
 * `presets.ts`), or the corpus genuinely had no matching material for a
 * preset that does have a target (which `build-presets.ts` reports at
 * generation time, so this shouldn't happen silently).
 */
export const PRESET_DATA: Partial<Record<DrumPattern, PackedPreset>> = raw as Partial<
  Record<DrumPattern, PackedPreset>
>;
