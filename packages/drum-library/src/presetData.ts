import raw from "./presets-data.json" with { type: "json" };
import type { DrumPattern } from "./presets.js";
import type { Limb, SegmentRef } from "./types.js";
import { SYNTH_VARIANTS, SYNTH_FILLS } from "./synthesize.js";

/**
 * Compact wire format for a resolved groove — fewer bytes than a named-key
 * object, which matters because this data gets bundled directly into
 * `trackdraft-bridge`'s extension.js.
 */
export type PackedNote = [beat: number, pitch: number, velocity: number];

/**
 * Where a variant came from. `egmd` variants carry the per-limb take refs
 * the groove was recombined from, so any baked variant can be traced back
 * to specific corpus performances (and re-derived, or audited when a bake
 * goes wrong — the failure mode this library's predecessor shipped
 * silently). `synth` variants name their generator instead.
 */
export interface VariantSource {
  origin: "egmd" | "synth";
  refs?: Partial<Record<Limb, SegmentRef>>;
  generator?: string;
}

export interface PackedVariant {
  /** Quarter-note-beat span of one loop — see `grooveLengthBeats` for why this isn't a bar count. */
  lengthBeats: number;
  /** Quarter-note beats per bar of the *groove's own* meter — what a fill replaces. */
  beatsPerBar: number;
  notes: PackedNote[];
  source: VariantSource;
}

export interface PackedPreset {
  variants: PackedVariant[];
}

export interface PresetLibraryMeta {
  /** Corpus identity, e.g. "e-gmd-v1.0.0". */
  corpus: string;
  /** ISO timestamp of the bake. */
  generatedAt: string;
  /** Files indexed in the extraction the bake drew from. */
  takesIndexed?: number;
}

/** On-disk shape written by `scripts/build-presets.ts` (format 2). */
export interface PresetLibraryFile {
  format: 2;
  meta: PresetLibraryMeta;
  presets: Partial<Record<DrumPattern, PackedPreset>>;
  /** Corpus-sourced one-bar fills (E-GMD `beatType: "fill"`), keyed by beats-per-bar. */
  fills?: Record<string, PackedVariant[]>;
}

/** Pre-format-2 bake: one shared lengthBeats, bare note arrays, no provenance. */
interface LegacyPresetFile {
  [pattern: string]: { lengthBeats: number; variants: PackedNote[][] };
}

/** Bar length of the legacy corpus grooves — only `68`/`54` were non-4/4. */
const LEGACY_BEATS_PER_BAR: Record<string, number> = { "68": 3, "54": 5 };

function migrateLegacy(data: LegacyPresetFile): PresetLibraryFile {
  const presets: Partial<Record<DrumPattern, PackedPreset>> = {};
  for (const [pattern, packed] of Object.entries(data)) {
    presets[pattern as DrumPattern] = {
      variants: packed.variants.map((notes) => ({
        lengthBeats: packed.lengthBeats,
        beatsPerBar: LEGACY_BEATS_PER_BAR[pattern] ?? 4,
        notes,
        // Legacy bakes recorded no per-variant refs; origin is all that's known.
        source: { origin: "egmd" },
      })),
    };
  }
  return {
    format: 2,
    meta: { corpus: "e-gmd-v1.0.0", generatedAt: "unknown (pre-provenance bake)" },
    presets,
  };
}

function isFormat2(data: unknown): data is PresetLibraryFile {
  return typeof data === "object" && data !== null && (data as { format?: number }).format === 2;
}

const baked: PresetLibraryFile = isFormat2(raw) ? raw : migrateLegacy(raw as unknown as LegacyPresetFile);

/**
 * Merge policy between the corpus bake and `synthesize.ts`, per pattern:
 *
 * - Machine idioms (`four_on_floor`, `trap`, `breakbeat`, `dnb`): synth
 *   *replaces* corpus. `dnb` in particular used to ship a corpus
 *   approximation that was honest-but-wrong idiom; programmed two-step is
 *   the real thing, and mixing the two styles across sections of one song
 *   would be worse than either alone.
 * - Thin odd meters (`54`, `68`): synth *supplements* corpus — a jazz 5/4
 *   from a human take and a rock 5/4 from the generator are both valid
 *   picks, and together they stop a 1-variant preset making every 5/4
 *   section identical.
 * - `78`: synth only, because the corpus has none at all.
 * - Everything else: corpus only.
 */
const SYNTH_REPLACES: ReadonlySet<DrumPattern> = new Set(["four_on_floor", "trap", "breakbeat", "dnb"]);

function mergedPresets(): Partial<Record<DrumPattern, PackedPreset>> {
  const merged: Partial<Record<DrumPattern, PackedPreset>> = { ...baked.presets };
  for (const [pattern, synthVariants] of Object.entries(SYNTH_VARIANTS) as [DrumPattern, PackedVariant[]][]) {
    if (SYNTH_REPLACES.has(pattern)) {
      merged[pattern] = { variants: synthVariants };
    } else {
      const corpus = merged[pattern]?.variants ?? [];
      merged[pattern] = { variants: [...corpus, ...synthVariants] };
    }
  }
  return merged;
}

/**
 * Curated, Ableton-safe groove variants per `DrumPattern` — the corpus bake
 * (generated offline by `scripts/build-presets.ts`) merged with the
 * synthesized machine idioms.
 *
 * This is what makes the library usable from inside an Ableton extension at
 * all: the extension has no filesystem access to the E-GMD corpus and has
 * no business resolving segments or scoring feel at runtime, so all of that
 * happens once, ahead of time. `none` is the only pattern that is absent by
 * design; every other engine pattern now resolves to at least one variant,
 * corpus or synthesized.
 */
export const PRESET_DATA: Partial<Record<DrumPattern, PackedPreset>> = mergedPresets();

/** Bake provenance — corpus identity and generation time of the corpus-sourced variants. */
export const PRESET_META: PresetLibraryMeta = baked.meta;

/**
 * Fill variants keyed by beats-per-bar (as a string, e.g. `"4"`, `"3.5"`).
 * Corpus fills (acoustic idiom) and synthesized fills (electronic idiom)
 * are kept separate so a caller can match the fill family to the groove
 * family — a trap section should not get a jazz tom run.
 */
export const FILL_DATA: { acoustic: Record<string, PackedVariant[]>; synth: Record<string, PackedVariant[]> } = {
  acoustic: baked.fills ?? {},
  synth: SYNTH_FILLS,
};
