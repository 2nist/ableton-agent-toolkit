import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  PRESET_DATA,
  FILL_DATA,
  CRASH_PITCH,
  inferDrumPattern,
  tileGrooveVaried,
  type DrumPattern,
  type PackedNote,
  type PackedPreset,
  type PackedVariant,
} from "@drum/library";
import { getVelocity } from "@music-theory/song-structure";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";

export interface DrumClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/** A short, un-sustained hit — not a block chord — regardless of how dense the underlying groove is. */
const HIT_DURATION = 0.25;

/** FNV-1a, matching `@drum/library`'s own seeding — kept local so this file has no reason to reach into the library's internals for one hash function. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A section's own id for the first pass through it, `id:occurrenceIndex`
 * for every repeat after that — so a section repeated via `arrangement`
 * gets independently varied drums per pass instead of rendering every
 * repeat byte-identical by accident. Occurrence 0 (a section that plays
 * once, or the first pass of one that repeats) always resolves to the
 * bare section id — the exact seed used before repeats existed, so every
 * song with no explicit repeats keeps producing byte-identical output.
 * Same reasoning `vary.ts` was built on: a repeat that never varies reads
 * as mechanical, not as a human playing the same part twice.
 */
function occurrenceSeed(sectionId: string, occurrenceIndex: number): string {
  return occurrenceIndex === 0 ? sectionId : `${sectionId}:${occurrenceIndex}`;
}

/**
 * Scale a groove's baked-in velocities so its peak lands on the section's
 * chosen `VelocityPreset`, without touching the *shape* of its dynamics.
 *
 * The alternative — replacing every note's velocity with the preset's flat
 * value — is exactly the bug fixed earlier in this library's development:
 * it destroys ghost notes and ends up sounding uniformly hammered. Scaling
 * the peak is what a mixing engineer does with a fader, not a compressor.
 */
function scaleToVelocityPreset(notes: PackedNote[], targetPeak: number): PackedNote[] {
  const peak = Math.max(...notes.map(([, , velocity]) => velocity), 1);
  const scale = targetPeak / peak;
  return notes.map(([beat, pitch, velocity]) => [beat, pitch, Math.max(1, Math.min(127, Math.round(velocity * scale)))]);
}

export interface FillLibrary {
  acoustic: Record<string, PackedVariant[]>;
  synth: Record<string, PackedVariant[]>;
}

/**
 * The fill pool for a groove: matched to the groove's bar length, and to
 * its family first — a trap section gets a programmed roll, an acoustic
 * verse gets a played fill — falling back to the other family rather than
 * to silence when only one has material for this meter.
 */
function fillPool(variant: PackedVariant, fills: FillLibrary): PackedVariant[] {
  const key = String(variant.beatsPerBar);
  const preferred = variant.source.origin === "synth" ? fills.synth : fills.acoustic;
  const fallback = variant.source.origin === "synth" ? fills.acoustic : fills.synth;
  const pool = preferred[key] ?? [];
  return pool.length > 0 ? pool : (fallback[key] ?? []);
}

/**
 * One clip per section. Pattern and variant selection:
 *
 * - When `section.drumPattern` is set (user has chosen a pattern in
 *   TrackDraft's Structure tab), that pattern is used directly — overriding
 *   the heuristic. `section.drumVariantIndex` picks a specific variant
 *   (clamped to the preset's actual variant count); absent or out of range
 *   falls back to the deterministic hash pick.
 * - Otherwise `inferDrumPattern` maps each section's role, dynamics, meter
 *   and the song's tempo/self-description to an engine pattern, and a
 *   variant is picked deterministically per section id — exactly as before
 *   manual control existed.
 *
 * Regardless of how the pattern is chosen, variants are scaled so their
 * peak lands on the section's velocity preset, and tiled with seeded
 * per-bar micro-variation (`tileGrooveVaried`) so long sections don't
 * loop identically. When a section leads into another, its last bar is
 * replaced by a fill from the matching family, scaled toward the *louder*
 * of the two sections when building up and pulled back when settling
 * down — and the following section opens with a crash.
 *
 * `presetData`/`fillData` default to the real library and only need
 * overriding in tests, which use small fixture presets instead of asserting
 * against actual baked content — that content legitimately changes shape
 * when the pipeline is re-run.
 */
export function planDrumClips(
  song: BlueprintSong,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
  fillData: FillLibrary = FILL_DATA,
): DrumClipPlan[] {
  const spans = sectionSpans(song);
  const songSignals = { bpm: song.bpm, title: song.title, concept: song.concept, notes: song.notes };

  // First pass: choose pattern + variant per section, so fill/crash
  // decisions can look at the *next* section's resolved target too.
  const resolved = spans.map(({ section, occurrenceIndex }) => {
    const pattern = section.drumPattern ?? inferDrumPattern(
      {
        role: section.role,
        velocity: section.velocity,
        name: section.name,
        timeSignatureNumerator: section.timeSignatureNumerator,
        timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
      },
      songSignals,
    );
    const preset = presetData[pattern];
    if (!preset || preset.variants.length === 0) return null;

    // Explicit variant index when the user chose one (clamped to valid range);
    // otherwise the deterministic hash pick that's been the default since day one.
    const variantIndex = section.drumVariantIndex !== undefined
      ? Math.max(0, Math.min(section.drumVariantIndex, preset.variants.length - 1))
      : hashSeed(occurrenceSeed(section.id, occurrenceIndex)) % preset.variants.length;
    return preset.variants[variantIndex];
  });

  let previousEndedWithFill = false;

  return spans.map(({ section, startBeat, durationBeats, occurrenceIndex }, i) => {
    const variant = resolved[i];
    if (!variant) {
      previousEndedWithFill = false;
      return { name: section.name, startBeat, durationBeats, notes: [] };
    }

    const velocityTarget = getVelocity(section.velocity);
    const scaled = scaleToVelocityPreset(variant.notes, velocityTarget);

    let tiled = tileGrooveVaried(
      scaled.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      variant.lengthBeats,
      durationBeats,
      { seed: occurrenceSeed(section.id, occurrenceIndex) },
    );

    // Section transition: swap the final bar for a fill when this section
    // hands off to another one and is long enough that losing a groove bar
    // reads as a fill rather than as the whole section.
    const next = i + 1 < spans.length ? spans[i + 1] : null;
    let endsWithFill = false;
    if (next && resolved[i + 1] && durationBeats >= 2 * variant.beatsPerBar) {
      const pool = fillPool(variant, fillData);
      if (pool.length > 0) {
        const fill = pool[hashSeed(`${occurrenceSeed(section.id, occurrenceIndex)}:fill`) % pool.length];
        const nextTarget = getVelocity(next.section.velocity);
        // Build toward a louder section; ease into a quieter one.
        const fillTarget = nextTarget >= velocityTarget ? Math.max(velocityTarget, nextTarget) : Math.round(velocityTarget * 0.85);
        const fillNotes = scaleToVelocityPreset(fill.notes, fillTarget);
        const fillStart = durationBeats - fill.lengthBeats;
        tiled = tiled.filter((note) => note.beat < fillStart);
        for (const [beat, pitch, velocity] of fillNotes) {
          const at = fillStart + beat;
          if (at < durationBeats) tiled.push({ beat: at, pitch, velocity });
        }
        endsWithFill = true;
      }
    }

    // A fill resolves onto a crash — put it on this section's downbeat when
    // the previous section built into it, unless the groove already opens
    // with one.
    if (previousEndedWithFill && !tiled.some((n) => n.pitch === CRASH_PITCH && n.beat < 0.25)) {
      tiled.push({ beat: 0, pitch: CRASH_PITCH, velocity: Math.min(127, velocityTarget + 4) });
    }
    previousEndedWithFill = endsWithFill;

    const notes: NoteDescription[] = tiled
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
      .map(({ beat, pitch, velocity }) => ({
        pitch,
        startTime: beat,
        duration: HIT_DURATION,
        velocity,
      }));

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
