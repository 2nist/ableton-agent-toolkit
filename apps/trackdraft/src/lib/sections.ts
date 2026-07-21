import { syncArrangementToSections, type BlueprintSong, type BlueprintSection } from "../types/blueprint";
import type { SongMap } from "../data/songMaps";

function newSection(name: string, role: BlueprintSection["role"]): BlueprintSection {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    bars: 8,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
  };
}

/** Every function here that changes *which* sections exist or *what order*
 *  they're in ends with `syncArrangementToSections` — it rebuilds
 *  `arrangement` to match `sections` 1:1 (same length, same order),
 *  preserving each section's existing repeat count/overrides and
 *  defaulting anything new to `repeats: 1`. Without this, `arrangement`
 *  would silently drift out of sync with the section list the moment a
 *  user added, removed, or drag-reordered a section — exactly the kind
 *  of divergence this field exists to prevent. `updateSection` is the one
 *  exception: it only ever changes a section's own fields, never the
 *  list's shape or order, so there's nothing to re-sync. */

export function addSection(song: BlueprintSong, role: BlueprintSection["role"] = "verse"): BlueprintSong {
  const name = `${role.charAt(0).toUpperCase()}${role.slice(1)} ${song.sections.filter((s) => s.role === role).length + 1}`;
  return syncArrangementToSections({ ...song, sections: [...song.sections, newSection(name, role)] });
}

export function removeSection(song: BlueprintSong, sectionId: string): BlueprintSong {
  return syncArrangementToSections({ ...song, sections: song.sections.filter((s) => s.id !== sectionId) });
}

export function updateSection(
  song: BlueprintSong,
  sectionId: string,
  updater: (section: BlueprintSection) => BlueprintSection,
): BlueprintSong {
  return {
    ...song,
    sections: song.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
  };
}

export function reorderSections(song: BlueprintSong, fromIndex: number, toIndex: number): BlueprintSong {
  const sections = [...song.sections];
  const [moved] = sections.splice(fromIndex, 1);
  sections.splice(toIndex, 0, moved);
  return syncArrangementToSections({ ...song, sections });
}

/** Sets how many times a section plays in a row at its point in the
 *  timeline — 1 is "plays once" (today's only behavior before this
 *  existed), 0 deliberately skips it without deleting it, anything higher
 *  repeats it without duplicating the section itself. Self-normalizing:
 *  runs `syncArrangementToSections` first, so this works even on a song
 *  whose `arrangement` doesn't fully cover its sections yet (real
 *  catalog data can be in this state — an earlier ingestion pass only
 *  partially populated it). */
export function updateRepeats(song: BlueprintSong, sectionId: string, repeats: number): BlueprintSong {
  const synced = syncArrangementToSections(song);
  const clamped = Math.max(0, Math.floor(repeats) || 0);
  return {
    ...synced,
    arrangement: synced.arrangement.map((entry) =>
      entry.sectionId === sectionId ? { ...entry, repeats: clamped } : entry,
    ),
  };
}

/** Reads a section's current repeat count for display — 1 when the song
 *  hasn't explicitly set one (an un-synced `arrangement`, or a section
 *  with no entry at all), matching `sectionSpans`' own fallback. */
export function repeatsFor(song: BlueprintSong, sectionId: string): number {
  const entry = song.arrangement.find((e) => e.sectionId === sectionId);
  return entry?.repeats ?? 1;
}

/** Replaces the song's sections wholesale with a MAP template's slots.
 *  Destructive by design (confirmed in the UI before calling this) —
 *  applying a template is meant to set the initial shape of a song, not
 *  merge with whatever's already there.
 *
 *  Slot musical fields (bars/velocity/meter/beatsPerChord) override the
 *  blank-section defaults; ids are always minted fresh (they seed
 *  deterministic generation in the Ableton extension, so a template must
 *  never ship them). Song-level defaults apply only where the map sets
 *  them — a map with no `concept` leaves the song's own concept alone. */
export function applySongMap(song: BlueprintSong, map: SongMap): BlueprintSong {
  const sections = map.slots.map((slot) => {
    const section = newSection(slot.label, slot.role);
    return {
      ...section,
      bars: slot.bars ?? section.bars,
      velocity: slot.velocity ?? section.velocity,
      beatsPerChord: slot.beatsPerChord ?? section.beatsPerChord,
      timeSignatureNumerator: slot.timeSignatureNumerator ?? section.timeSignatureNumerator,
      timeSignatureDenPower: slot.timeSignatureDenPower ?? section.timeSignatureDenPower,
      transitionNote: slot.purpose,
    };
  });
  const defaults = map.defaults ?? {};
  // Every slot mints a fresh section id (see the comment above), so
  // syncArrangementToSections finds nothing to preserve and simply gives
  // the new song a clean, fully-populated arrangement — one repeats:1
  // entry per section, in the template's order.
  return syncArrangementToSections({
    ...song,
    bpm: defaults.bpm ?? song.bpm,
    key: defaults.key ?? song.key,
    scale: defaults.scale ?? song.scale,
    concept: defaults.concept ?? song.concept,
    sections,
  });
}
