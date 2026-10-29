import raw from "./presets-data.json" with { type: "json" };
import type { DrumPattern } from "./presets.js";
import type { Limb, SegmentRef } from "./types.js";
import { SYNTH_VARIANTS, SYNTH_FILLS, CURATED_PATTERNS } from "./synthesize.js";
import { applyGroove, extractGroove } from "./groove.js";
import type { GrooveMap } from "./groove.js";
import { voiceOf } from "./kit.js";

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
  /**
   * `curated` = an authored pattern (see `synthesize.ts`) carrying a corpus
   * take's feel. `egmd`/`zappa` are mined note content, `synth` is a
   * programmed idiom. Only `synth` changes which fill family is used.
   */
  origin: "egmd" | "synth" | "zappa" | "curated";
  refs?: Partial<Record<Limb, SegmentRef>>;
  generator?: string;
}

export interface PackedVariant {
  /**
   * The corpus style family this performance came from ("rock", "funk",
   * "latin"…). Absent on synthesised idioms and on Zappa-mined odd meters.
   *
   * Selection uses it to prefer variants from the song's own tradition: the
   * pattern vocabulary is feel-only, so without this a funk song and a rock
   * song of equal energy draw from the same undifferentiated pool.
   */
  style?: string;
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
  /** Curated material minted on top of the corpus bake (scripts/mint-zappa.ts).
   *  A fresh corpus re-bake rewrites this file from scratch and drops it —
   *  re-run the miner afterwards. */
  mined?: {
    zappa?: {
      grooves: number;
      fills: number;
      mintedAt: string;
      scan: string;
      source: string;
    };
  };
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

/** How many corpus takes donate feel to one curated pattern. Coprime with
 *  the curated variant counts (3 and 4) so every structure pairs with every
 *  feel exactly once. */
const FEEL_DONORS = 5;

/** How much of a donor's timing/velocity contour is imposed. Full strength
 *  re-creates the take's (sometimes wild) dynamics; this keeps the authored
 *  accent hierarchy while still sounding played. */
const FEEL_STRENGTH = 0.6;

/**
 * Corpus takes worth borrowing FEEL from — a whole phrase in the pattern's
 * own meter, at a density somebody could actually play as a groove. Their
 * note content is discarded; only the groove map (per-slot timing offset +
 * velocity factor, see `groove.ts`) is used. Filtering out the fills is the
 * point: a fill's contour is a fill.
 */
function feelDonors(mined: PackedVariant[], beatsPerBar: number, count: number): { groove: GrooveMap; style?: string }[] {
  const usable = mined.filter((variant) => {
    if (Math.abs(variant.beatsPerBar - beatsPerBar) > 1e-6 || variant.notes.length === 0) return false;
    const bars = variant.lengthBeats / beatsPerBar;
    const perBar = variant.notes.length / Math.max(bars, 1e-9);
    return perBar >= 4 && perBar <= 24;
  });
  if (usable.length === 0) return [];
  return Array.from({ length: count }, (_, n) => {
    // Spread across the pool instead of taking its head — the bake is sorted
    // by feel score, so the head is all one character.
    const donor = usable[Math.floor(((n + 0.5) * usable.length) / count)];
    return {
      groove: extractGroove(
        donor.notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
        beatsPerBar,
        0.25,
      ),
      style: donor.style,
    };
  });
}

/**
 * A curated pattern crossed with corpus feel: authored structure, borrowed
 * timing and dynamics. The result sounds like a take without inheriting the
 * take's loop length, density or (for fills) its tom runs.
 */
/**
 * Where an idiom gets its FEEL from when it has no corpus bake of its own.
 *
 * `motown` is written, not mined — but a written pattern with no donor plays
 * dead straight, and the whole point of the authored banks is that they sound
 * played. Each idiom borrows the donors of the pattern whose human takes share
 * its character: a boom-bap hat grid and a `standard` backbeat are both 4/4
 * e-kit performances, so the timing transfers even though the notes do not.
 */
const DONOR_PATTERN: Partial<Record<DrumPattern, DrumPattern>> = {
  motown: "standard",
  boom_bap: "half_time",
  train_beat: "driving",
  bossa: "half_time",
  reggae: "bridge_sparse",
  disco: "four_on_floor",
  afrobeat: "driving",
  punk: "intense",
  ballad: "bridge_sparse",
  second_line: "standard",
};

function curatedWithFeel(pattern: DrumPattern, curated: PackedVariant[]): PackedVariant[] {
  const mined = baked.presets[DONOR_PATTERN[pattern] ?? pattern]?.variants ?? [];
  const donors = feelDonors(mined, curated[0].beatsPerBar, FEEL_DONORS);
  if (donors.length === 0) return curated;
  const out: PackedVariant[] = [];
  for (let n = 0; n < curated.length * donors.length; n++) {
    const base = curated[n % curated.length];
    const donor = donors[n % donors.length];
    const felt = applyGroove(
      base.notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      donor.groove,
      { strength: FEEL_STRENGTH },
    );
    out.push({
      ...base,
      // NO `style`. That field exists so selection can prefer a take from the
      // song's own tradition, and it earns its keep only when the pool holds
      // different *performances*. The performance is now the feel layer; the
      // structure is written, and every written variant is equally valid for
      // every tradition. Carrying the donor's style here made
      // `pickVariantIndexFor` filter a 20-variant pool down to the handful of
      // rock-take variants, which silently cost most of the variety (and made
      // a changed seed pick the same groove). The donor stays traceable:
      notes: felt.map((note): PackedNote => [note.beat, note.pitch, note.velocity]),
      source: {
        origin: "curated",
        generator: `${base.source.generator ?? pattern}·feel:${donor.style ?? "unknown"}`,
      },
    });
  }
  return out;
}

/**
 * Acceptable hits-per-bar range per pattern — the pool's density contract.
 *
 * Wide enough for a programming style, narrow enough that a fill or a bare
 * pulse cannot masquerade as a groove. The bands do not overlap, which is what
 * keeps the energy ladder ordered: a `standard` take can never be busier than a
 * `driving` one. `selectableMined` gates corpus takes with this table and
 * `drumMusicality.test.ts` asserts the whole pool against the same numbers, so
 * widening a band is one edit that cannot drift out of step with the tests.
 */
export const PATTERN_DENSITY: Record<string, [number, number]> = {
  kick_only: [1, 6],
  bridge_sparse: [4, 9],
  half_time: [8, 14],
  standard: [11, 18],
  driving: [17, 26],
  intense: [23, 30],
  "78": [6, 16],
  "68": [6, 14],
  "54": [8, 18],
  four_on_floor: [8, 28],
  // The idiom shelf. Bands are what the written banks measure; they are not
  // part of the energy ladder, so they may overlap each other.
  motown: [12, 20],
  boom_bap: [9, 17],
  train_beat: [14, 22],
  bossa: [8, 15],
  reggae: [6, 13],
  disco: [13, 24],
  afrobeat: [17, 27],
  punk: [19, 30],
  ballad: [4, 10],
  second_line: [11, 19],
  trap: [14, 28],
  breakbeat: [10, 22],
  dnb: [12, 24],
};

/** Toms are an accent, not a groove: above this share of a take's notes it is a
 *  tom RUN — a fill — and fills are a separate vocabulary (`FILL_DATA`). */
export const MAX_TOM_SHARE = 0.15;

/**
 * How many corpus takes join a pattern's pool. Enough that the pool roughly
 * doubles, few enough that the authored variants still set the character.
 */
const MAX_CORPUS_VARIANTS = 96;

const signature = (variant: PackedVariant): string =>
  `${variant.lengthBeats}|${variant.notes.map(([beat, pitch, velocity]) => `${beat}:${pitch}:${velocity}`).join(",")}`;

/**
 * Corpus takes that are ALSO selectable patterns, not just feel donors.
 *
 * The authored banks replace the mined note content because the raw pool was
 * arbitrary: fills posed as grooves, 1-to-8-bar loops, and a 6-to-64 hit/bar
 * spread inside one pattern. That was a *filtering* failure, not a reason to
 * throw the corpus away — so the takes that pass the same contract the authored
 * ones do are appended to the pool and become pickable:
 *
 *  - same meter, and a whole 1 or 2 bars, so a groove can repeat in its section
 *  - density inside the AUTHORED bank's own band, so the energy ladder holds
 *  - toms only as an accent (<= MAX_TOM_SHARE): a tom run is a fill, and fills
 *    are a separate vocabulary. An all-or-nothing tom rule threw away every
 *    loud take in the corpus, which is most of `intense`.
 *
 * `drumMusicality.test.ts` asserts every one of those over the whole pool, so
 * this filter and the contract cannot drift apart.
 */
function selectableMined(pattern: DrumPattern, authored: PackedVariant[]): PackedVariant[] {
  const mined = baked.presets[pattern]?.variants ?? [];
  if (mined.length === 0 || authored.length === 0) return [];
  const beatsPerBar = authored[0]!.beatsPerBar;
  // The pattern's CONTRACT band, not the authored bank's own narrow range: the
  // contract is what a take has to satisfy to be a usable groove, and using the
  // authored range instead starved every pattern that happened to be written
  // tightly (intense, the odd meters).
  const densities = authored.map((variant) => variant.notes.length / Math.max(variant.lengthBeats / beatsPerBar, 1e-9));
  const [min, max] = PATTERN_DENSITY[pattern] ?? [Math.min(...densities), Math.max(...densities)];
  const seen = new Set(authored.map(signature));

  const usable = mined.filter((variant) => {
    if (variant.notes.length === 0) return false;
    if (Math.abs(variant.beatsPerBar - beatsPerBar) > 1e-6) return false;
    const bars = variant.lengthBeats / beatsPerBar;
    if (bars < 1 - 1e-6 || bars > 2 + 1e-6) return false;
    if (Math.abs(bars - Math.round(bars)) > 1e-6) return false;
    const density = variant.notes.length / bars;
    if (density < min || density > max) return false;
    const toms = variant.notes.filter(([, pitch]) => (voiceOf(pitch) ?? "").startsWith("tom")).length;
    if (toms / variant.notes.length > MAX_TOM_SHARE) return false;
    const sig = signature(variant);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  if (usable.length <= MAX_CORPUS_VARIANTS) return usable;
  // Spread across the pool rather than taking its head: the bake is sorted by
  // feel score, so the head is all one character.
  return Array.from({ length: MAX_CORPUS_VARIANTS }, (_, n) =>
    usable[Math.floor(((n + 0.5) * usable.length) / MAX_CORPUS_VARIANTS)],
  ).filter((variant): variant is PackedVariant => variant !== undefined);
}

function mergedPresets(): Partial<Record<DrumPattern, PackedPreset>> {
  const merged: Partial<Record<DrumPattern, PackedPreset>> = { ...baked.presets };

  // Authored patterns replace the mined note content outright; the mined
  // takes stay on as FEEL donors. This is the fix for "the patterns are
  // random" — a pattern is now one or two bars of written material at a
  // fixed density, not an arbitrary 1-to-8-bar performance that might be a
  // fill.
  for (const [pattern, curated] of Object.entries(CURATED_PATTERNS) as [DrumPattern, PackedVariant[]][]) {
    const authored = curatedWithFeel(pattern, curated);
    // Authored first, then the corpus takes that pass the same contract — so the
    // picker offers the library's own performances as well as the written ones.
    merged[pattern] = { variants: [...authored, ...selectableMined(pattern, authored)] };
  }

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

/**
 * The corpus bake exactly as written to disk — mined NOTE content, before the
 * curated patterns replace it. The mined takes are now feel donors, so
 * anything that audits them (provenance, the Zappa mint, meter coverage) has
 * to read here rather than from `PRESET_DATA`.
 */
export const BAKED_PRESETS: Partial<Record<DrumPattern, PackedPreset>> = baked.presets;

/** Bake provenance — corpus identity and generation time of the corpus-sourced variants. */
export const PRESET_META: PresetLibraryMeta = baked.meta;

/**
 * Fill variants keyed by beats-per-bar (as a string, e.g. `"4"`, `"3.5"`).
 * Corpus fills (acoustic idiom) and synthesized fills (electronic idiom)
 * are kept separate so a caller can match the fill family to the groove
 * family — a trap section should not get a jazz tom run.
 */
/**
 * A one-bar fill is a gesture. Anything past ~10 hits per beat is a
 * transcription artefact (the bake carried a 70-hits-per-bar "fill" in 4/4 —
 * 17.5 hits per beat), and putting one after an 8th-note groove is a
 * different song arriving early.
 */
const MAX_FILL_HITS_PER_BEAT = 10;

function musicalFills(pool: Record<string, PackedVariant[]> | undefined): Record<string, PackedVariant[]> {
  const out: Record<string, PackedVariant[]> = {};
  for (const [meter, fills] of Object.entries(pool ?? {})) {
    const usable = fills.filter(
      (fill) => fill.lengthBeats > 0 && fill.notes.length / Math.max(fill.lengthBeats, 1e-9) <= MAX_FILL_HITS_PER_BEAT,
    );
    if (usable.length > 0) out[meter] = usable;
  }
  return out;
}

export const FILL_DATA: { acoustic: Record<string, PackedVariant[]>; synth: Record<string, PackedVariant[]> } = {
  acoustic: musicalFills(baked.fills),
  synth: musicalFills(SYNTH_FILLS),
};
