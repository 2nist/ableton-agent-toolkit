import {
  PRESET_DATA,
  inferDrumPattern,
  tileGrooveVaried,
  voiceOf,
  outlineBeatsPerBar,
  outlineToClickPattern,
  outlineToGroovePattern,
  numerator as outlineNumerator,
  euclidOnsetSteps,
  type DrumPattern,
  type PackedVariant,
  type PackedNote,
  type KitVoice,
} from "@drum/library";
import {
  sectionDurationBeats,
  type BlueprintSection,
  type MeterOutline,
  type EuclidPattern,
  type DrumPattern as SchemaDrumPattern,
} from "../../types/blueprint";

/**
 * A single drum hit resolved from a pattern/variant — the common shape
 * `midiExport.ts`'s drum stem and (previously) `songTransport.ts`'s live
 * playback both consumed. `offsetSec` is a *relative* offset from the
 * loop's own start (already converted from the variant's raw beat position
 * via `secPerBeat` — see `resolveDrumHits`), not an absolute time.
 */
export interface ScheduledDrumHit {
  midi: number;
  offsetSec: number;
  velocity: number;
}

/**
 * Resolves a `(pattern, variantIndex, section)` triple into a list of
 * `ScheduledDrumHit`s, scaled to the section's velocity preset and tiled
 * to fill the section's *own* bar length (`sectionDurationBeats`) — a
 * section longer than one groove loop repeats it, with the same per-tile
 * micro-variation (`tileGrooveVaried`, seeded off the section id) the
 * export path already applies. Returns `null` when the pattern resolves
 * to no playable material (`none`, unmatched preset, etc.).
 *
 * `secPerBeat` (typically `60 / song.bpm`) converts each note's raw beat
 * position — `PackedVariant.notes` are `[beat, pitch, velocity]` tuples,
 * beat-based like every other groove/tiling function in `@drum/library` —
 * into a real seconds offset. Pass `1` to get beat positions back
 * unchanged (`midiExport.ts` does this — MIDI export wants beats, not
 * seconds). `BlueprintSection` doesn't carry `bpm` itself (it's
 * song-level), so callers must pass it in.
 *
 * The variant is clamped modulo `PRESET_DATA[pattern].variants.length`;
 * a missing or out-of-range `variantIndex` falls back to 0. Callers that
 * want the deterministic hash-based variant (the bridge's export path)
 * should pick the variant index themselves — this function is the
 * playback-time projection, not the selection engine.
 */
export function resolveDrumHits(
  pattern: DrumPattern,
  variantIndex: number | undefined,
  section: BlueprintSection,
  secPerBeat: number,
  /** Override the total beat count to tile to — defaults to the section's
   *  full bar count (`sectionDurationBeats`). Pass the chord progression's
   *  beat count when tiling drums to match a specific loop length rather
   *  than the section's full duration. */
  totalBeatsOverride?: number,
): ScheduledDrumHit[] | null {
  const preset = PRESET_DATA[pattern];
  if (!preset || preset.variants.length === 0) return null;

  const index = variantIndex !== undefined
    ? Math.max(0, Math.min(variantIndex, preset.variants.length - 1))
    : 0;

  const variant: PackedVariant = preset.variants[index];
  if (variant.notes.length === 0) return null;

  // Scale peak velocity to the section's velocity preset (same formula as
  // the extension's drumClips.ts scaleToVelocityPreset).
  const peak = Math.max(...variant.notes.map(([, , v]) => v), 1);
  const targetPeak = velocityNumber(section.velocity);
  const scale = targetPeak / peak;
  const scaled = variant.notes.map(([beat, pitch, velocity]) => ({
    beat,
    pitch,
    velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
  }));

  const totalBeats = totalBeatsOverride ?? sectionDurationBeats(section);
  const tiled = tileGrooveVaried(scaled, variant.lengthBeats, totalBeats, { seed: section.id });

  return tiled.map((note) => ({
    midi: note.pitch,
    offsetSec: note.beat * secPerBeat,
    velocity: note.velocity,
  }));
}

/**
 * One voice's onsets within a `(pattern, variantIndex)` groove, as
 * fractions (0–1) of the variant's own loop — the shape a "necklace"
 * view (n points around a ring, k of them filled) needs per voice.
 */
export interface VoiceNecklace {
  voice: KitVoice;
  /** Ascending fractions of the loop, one per onset — real E-GMD hits
   *  land at their true (unquantized) microtiming position, not snapped
   *  to a grid, so two takes of "the same" pattern can read as visibly
   *  different constellations. That's real, not a rendering bug. */
  hits: number[];
  count: number;
  /** The grid the necklace is drawn on — `n` in the Euclidean E(k,n)
   *  reading of the loop: the outline's numerator for odd-meter
   *  outlines, the loop's 16th-note step count for named presets. A
   *  necklace view draws `steps` reference points around the ring, with
   *  the `count` onsets sitting at their true (unquantized) positions
   *  among them. Absent for legacy data — callers fall back to a plain
   *  dashed ring. */
  steps?: number;
}

/**
 * The raw baked variant a `(pattern, variantIndex)` pair resolves to, or
 * `null` under the same "nothing to work with" conditions every other
 * resolver here shares (no preset, no notes). Extracted so anything that
 * needs the variant itself — not just its onsets split by voice — has one
 * place to get it from instead of re-deriving the same clamp-and-lookup.
 */
export function resolveVariant(
  pattern: DrumPattern,
  variantIndex: number | undefined,
): PackedVariant | null {
  const preset = PRESET_DATA[pattern];
  if (!preset || preset.variants.length === 0) return null;
  const index = variantIndex !== undefined
    ? Math.max(0, Math.min(variantIndex, preset.variants.length - 1))
    : 0;
  const variant = preset.variants[index];
  return variant.notes.length === 0 || variant.lengthBeats <= 0 ? null : variant;
}

/** Groups a flat `PackedNote[]` + its own loop length into one
 *  `VoiceNecklace` per voice actually present (`voiceOf` — GM pitch →
 *  kick/snare/hat/etc.) — the shared last step both `resolveVoiceNecklaces`
 *  (preset patterns) and `resolveOutlineVoiceNecklaces` (odd-meter
 *  outlines) reduce to, so onset-fraction math exists in exactly one
 *  place regardless of which kind of groove produced the notes. */
function groupNotesByVoice(notes: PackedNote[], loopBeats: number, steps?: number): VoiceNecklace[] | null {
  if (notes.length === 0 || loopBeats <= 0) return null;
  const byVoice = new Map<KitVoice, number[]>();
  for (const [beat, pitch] of notes) {
    const voice = voiceOf(pitch);
    if (!voice) continue; // an unmapped GM pitch — skip rather than guess
    const frac = (((beat % loopBeats) + loopBeats) % loopBeats) / loopBeats;
    const list = byVoice.get(voice) ?? [];
    list.push(frac);
    byVoice.set(voice, list);
  }
  if (byVoice.size === 0) return null;
  return Array.from(byVoice.entries()).map(([voice, hits]) => ({
    voice,
    hits: hits.slice().sort((a, b) => a - b),
    count: hits.length,
    steps,
  }));
}

/**
 * Splits a `(pattern, variantIndex)` groove into one `VoiceNecklace` per
 * drum voice actually present in it, for a read-only per-voice
 * rhythm-necklace preview. Returns `null` under the same conditions
 * `resolveDrumHits` does (no preset, no notes) — never a stale/inferred
 * guess.
 *
 * Unlike `resolveDrumHits`, this doesn't tile to a section length or
 * scale velocity — it's a preview of the *source* groove as baked, one
 * full loop, nothing projected onto a timeline yet.
 */
export function resolveVoiceNecklaces(
  pattern: DrumPattern,
  variantIndex: number | undefined,
): VoiceNecklace[] | null {
  const variant = resolveVariant(pattern, variantIndex);
  if (!variant) return null;
  return groupNotesByVoice(variant.notes, variant.lengthBeats, Math.max(1, Math.round(variant.lengthBeats * 4)));
}

/**
 * Same idea as `resolveVoiceNecklaces`, for a `drumMeterOutline` instead
 * of a named preset — a real kick/snare groove when the outline carries
 * `cellVoices`, a plain accented closed-hat click otherwise. Exactly
 * mirrors `extensions/trackdraft-bridge/src/drumClips.ts`'s
 * `outlineVariant`, so what TrackDraft previews here is what the export
 * actually produces, not an approximation of it.
 */
export function resolveOutlineVoiceNecklaces(outline: MeterOutline): VoiceNecklace[] | null {
  const notes = outline.cellVoices ? outlineToGroovePattern(outline, outline.cellVoices) : outlineToClickPattern(outline);
  return groupNotesByVoice(notes, outlineBeatsPerBar(outline), outlineNumerator(outline));
}

/** Builds a single-voice `VoiceNecklace` from a free-form Euclidean
 *  pattern — `k` onsets spread as evenly as possible across `n` steps,
 *  cyclically shifted by `rotation`. Any k in 1..n is valid (unlike a
 *  `MeterOutline`, which is constrained to 2s/3s cells). The per-voice
 *  authoring path ("edit the drums voice by voice"). */
function euclidToVoiceNecklace(pat: EuclidPattern, voice: KitVoice): VoiceNecklace | null {
  const n = Math.max(1, Math.floor(pat.n));
  const steps = euclidOnsetSteps(pat);
  return { voice, hits: steps.map((s) => s / n), count: steps.length, steps: n };
}

/**
 * The one entry point `DrumsView`/`DrumPatternTools` should call: resolves
 * whichever of a section's two mutually-exclusive drum-authoring modes is
 * active (`drumMeterOutline` takes priority over `drumPattern`, same
 * order `drumClips.ts` uses), or the heuristic pattern when neither is
 * set — then applies any per-voice Euclidean overrides
 * (`drumVoicePatterns`) on top, replacing those voices' necklaces with
 * their own free-form k/n rhythm. Callers never need to know which mode a
 * section is in. */
export function resolveSectionVoiceNecklaces(section: BlueprintSection, concept?: string): VoiceNecklace[] | null {
  let base: VoiceNecklace[] | null;
  if (section.drumMeterOutline) {
    base = resolveOutlineVoiceNecklaces(section.drumMeterOutline);
  } else {
    const pattern = section.drumPattern ?? inferPatternForSection(section, concept);
    base = resolveVoiceNecklaces(pattern, section.drumVariantIndex);
  }
  const overrides = section.drumVoicePatterns;
  if (!overrides) return base;
  const overrideVoices = (Object.keys(overrides) as KitVoice[]).filter((v) => overrides[v]);
  if (overrideVoices.length === 0) return base;
  const kept = base ? base.filter((n) => !overrideVoices.includes(n.voice)) : [];
  const added = overrideVoices
    .map((v) => euclidToVoiceNecklace(overrides[v]!, v))
    .filter((n): n is VoiceNecklace => n !== null);
  const out = [...kept, ...added];
  return out.length > 0 ? out : null;
}

/**
 * A section's own `PackedVariant`, mirroring the same three-way priority
 * as `resolveSectionVoiceNecklaces` and `extensions/trackdraft-bridge/src/
 * drumClips.ts`'s `outlineVariant`/pattern resolution — for anything (like
 * handoff-fill planning) that needs the variant itself, not its onsets
 * already split by voice.
 */
export function resolveSectionVariant(section: BlueprintSection, concept?: string): PackedVariant | null {
  if (section.drumMeterOutline) {
    const outline = section.drumMeterOutline;
    const bpb = outlineBeatsPerBar(outline);
    const notes = outline.cellVoices ? outlineToGroovePattern(outline, outline.cellVoices) : outlineToClickPattern(outline);
    return { lengthBeats: bpb, beatsPerBar: bpb, notes, source: { origin: "synth", generator: outline.cellVoices ? "outline-groove" : "outline-click" } };
  }
  const pattern = section.drumPattern ?? inferPatternForSection(section, concept);
  return resolveVariant(pattern, section.drumVariantIndex);
}

/** Every selectable named pattern — "auto" (`undefined`, deferring to
 *  `inferPatternForSection`) is a separate, third option a picker adds on
 *  top of this list, distinct from `"none"` here (an explicit "no drums"
 *  choice). Canonical list `SectionCard`'s picker and `DrumPatternTools`'
 *  picker both read from, so adding a preset means updating one place. */
export const DRUM_PATTERN_OPTIONS: DrumPattern[] = [
  "none", "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "dnb", "78", "68", "54",
];

/** How many baked variants a pattern has — 0 for "auto"/undefined, so a
 *  stepper can safely disable itself without a separate null check. */
export function variantCount(pattern: DrumPattern | undefined): number {
  return pattern ? (PRESET_DATA[pattern]?.variants.length ?? 0) : 0;
}

/**
 * Heuristic pattern for a section — the same fallback `planDrumClips`
 * uses, exported so both `midiExport.ts` and (previously) live playback
 * can choose between explicit and inferred patterns consistently.
 *
 * `concept` is the *song's* concept text (electronic-vs-acoustic style
 * detection reads it, same as `extensions/trackdraft-bridge/src/
 * drumClips.ts`'s `songSignals` already does for the real Ableton export)
 * — optional and omittable so every existing caller keeps compiling, but
 * every caller that has a `song` in scope should pass `song.concept`.
 * Callers that don't pass it silently fall back to "acoustic" for every
 * song regardless of what it actually describes, which is exactly the gap
 * this parameter closes. */
export function inferPatternForSection(section: BlueprintSection, concept?: string): DrumPattern {
  return inferDrumPattern(
    {
      role: section.role,
      velocity: section.velocity,
      name: section.name,
      timeSignatureNumerator: section.timeSignatureNumerator,
      timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
    },
    { concept },
  );
}

/**
 * A small, deliberately conservative keyword table from a genre map slot's
 * free-text `groove` description to an explicit, legacy-representable
 * `DrumPattern` override — only for phrases specific enough that a wrong
 * guess is unlikely. Returns `undefined` (no override) far more often than
 * not; most groove intent either isn't representable as an explicit
 * per-section choice (`four_on_floor`/`trap`/`breakbeat` aren't in the
 * schema's `DrumPattern` union at all — see `presets.ts` in `@drum/library`
 * for why) or is already well served by the concept-aware heuristic once
 * `inferPatternForSection` actually receives the song's concept. Checked
 * in order; first match wins. */
export function inferGrooveOverride(groove: string | undefined): SchemaDrumPattern | undefined {
  if (!groove) return undefined;
  const table: [RegExp, SchemaDrumPattern][] = [
    [/\bno (kit|drums?)\b[^.]*\byet\b|\bkick[- ]only\b|\bkick pulse\b/i, "kick_only"],
    [/\bhalf[- ]time\b/i, "half_time"],
    [/\bblast beat\b|\bwall of\b/i, "intense"],
    [/\bdrum\s*(?:'n'|and|&)\s*bass\b|\bjungle\b/i, "dnb"],
  ];
  for (const [pattern, drumPattern] of table) {
    if (pattern.test(groove)) return drumPattern;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Velocity preset → MIDI peak (same table as song-structure's VELOCITY_MAP,
// kept local so this module has zero dependency on the DSL layer).
// ---------------------------------------------------------------------------

const VELOCITY_TO_PEAK: Record<string, number> = {
  ppp: 32, pp: 48, p: 64, mp: 80, mf: 96, f: 112, ff: 120, fff: 127,
};

export function velocityNumber(velocity: string): number {
  return VELOCITY_TO_PEAK[velocity] ?? 96;
}
