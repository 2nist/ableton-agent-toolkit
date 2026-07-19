import type { NoteDescription } from "@ableton-extensions/sdk";
import { PRESET_DATA, tileGroove, type DrumPattern, type PackedNote, type PackedPreset } from "@drum/library";
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

/**
 * One clip per section, built from real E-GMD grooves rather than a fixed
 * kick-on-1&3 pattern. `section.drumPattern` and `section.velocity` were
 * already part of the blueprint schema and TrackDraft's own UI — this is
 * what makes them do something: `PRESET_DATA` (curated offline by
 * `@drum/library`'s build-presets script from the full corpus) supplies a
 * handful of real, Ableton-safe groove variants per pattern, one is picked
 * deterministically per section so re-applying a blueprint reproduces the
 * same drums, and it's tiled to the section's length and scaled to its
 * velocity preset.
 *
 * `drumPattern: "none"` and `"78"` have no variants — `"78"` because the
 * source corpus (E-GMD) contains no 7/8 material at all, not because of a
 * gap in this generator — so those sections get an empty clip, same as any
 * preset that happens to have no surviving variants.
 *
 * `presetData` defaults to the real, corpus-derived `PRESET_DATA` and only
 * needs overriding in tests, which use small fixture presets instead of
 * asserting against actual E-GMD content — real preset data can legitimately
 * change shape when the extraction pipeline is re-run with a different seed
 * or pool size, and tests shouldn't be coupled to that.
 */
export function planDrumClips(
  song: BlueprintSong,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): DrumClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const preset = presetData[section.drumPattern as DrumPattern];
    if (!preset || preset.variants.length === 0) {
      return { name: section.name, startBeat, durationBeats, notes: [] };
    }

    const variantIndex = hashSeed(section.id) % preset.variants.length;
    const variant = scaleToVelocityPreset(preset.variants[variantIndex], getVelocity(section.velocity));

    const tiled = tileGroove(
      variant.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      preset.lengthBeats,
      durationBeats,
    );

    const notes: NoteDescription[] = tiled.map(({ beat, pitch, velocity }) => ({
      pitch,
      startTime: beat,
      duration: HIT_DURATION,
      velocity,
    }));

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
