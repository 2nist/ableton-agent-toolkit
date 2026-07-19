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
 * One clip per section. Everything about the drums is decided here, behind
 * the scenes — there is no drum control anywhere in TrackDraft by design:
 *
 * - `inferDrumPattern` maps each section's role, dynamics, meter and the
 *   song's tempo/self-description to an engine pattern (the old
 *   `section.drumPattern` field is legacy and no longer consulted).
 * - A variant is picked deterministically per section id, scaled so its
 *   peak lands on the section's velocity preset, and tiled with seeded
 *   per-bar micro-variation (`tileGrooveVaried`) so long sections don't
 *   loop identically.
 * - When a section leads into another, its last bar is replaced by a fill
 *   from the matching family, scaled toward the *louder* of the two
 *   sections when building up and pulled back when settling down — and the
 *   following section opens with a crash.
 *
 * Anyone who wants different drums edits the generated clip in Live, which
 * is the right tool for that job anyway.
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
  const resolved = spans.map(({ section }) => {
    const pattern = inferDrumPattern(
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
    return preset.variants[hashSeed(section.id) % preset.variants.length];
  });

  let previousEndedWithFill = false;

  return spans.map(({ section, startBeat, durationBeats }, i) => {
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
      { seed: section.id },
    );

    // Section transition: swap the final bar for a fill when this section
    // hands off to another one and is long enough that losing a groove bar
    // reads as a fill rather than as the whole section.
    const next = i + 1 < spans.length ? spans[i + 1] : null;
    let endsWithFill = false;
    if (next && resolved[i + 1] && durationBeats >= 2 * variant.beatsPerBar) {
      const pool = fillPool(variant, fillData);
      if (pool.length > 0) {
        const fill = pool[hashSeed(`${section.id}:fill`) % pool.length];
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
