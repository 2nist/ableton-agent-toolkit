import { syncArrangementToSections, type BlueprintSong, type BlueprintSection } from "../types/blueprint";
import { buildEuclideanOutline, twoThreeCellCounts } from "@drum/library";
import type { SongMap, MapSlot } from "../data/songMaps";
import { honeycombTextToChords } from "./harmony/chordBuilder";
import { inferGrooveOverride } from "./playback/drumPreview";

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

export interface ApplySongMapOptions {
  /** Apply one of `map.variants` instead of the map's primary `slots` —
   *  match by `SongMapVariant.name`. Falls back to `slots` if the name
   *  doesn't match anything (e.g. a stale selection after the map's
   *  variants changed underneath it). */
  variantName?: string;
  /** Drop every slot marked `optional: true` before applying — for a
   *  shorter arrangement. Slots with no `optional` field are always kept. */
  excludeOptional?: boolean;
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
 *  them — a map with no `concept` leaves the song's own concept alone.
 *
 *  Three slot fields get real generation, not just storage:
 *  - `progression` (roman-numeral chord cycle) is resolved into actual
 *    `Chord`s via the same parser the Harmony tab's honeycomb-text import
 *    uses (`honeycombTextToChords`), against the *map's* key/scale (a
 *    genre's harmonic identity, not whatever the song happened to have
 *    before) — a slot with no `progression` keeps today's behavior
 *    (`chords: []`, built manually afterward).
 *  - `groove` (free-text rhythm description) only ever *narrows* the
 *    section's drum pattern when it names something the legacy
 *    `drumPattern` dropdown can actually represent (`inferGrooveOverride`,
 *    a small high-confidence keyword table) — e.g. "half-time" or
 *    "no kit yet". Most groove intent (four-on-the-floor, trap, breakbeat)
 *    isn't representable as an explicit per-section choice at all — the
 *    engine treats those as heuristic-only outcomes — so those slots are
 *    deliberately left on "auto" and rely on the song's `concept` reaching
 *    the live heuristic correctly instead (see `inferPatternForSection`).
 *  - `harmonyRhythm` also gets real generation when `"euclid"`: the 2s/3s
 *    outline is built from the slot's own meter (`harmonyCellCount` /
 *    `harmonyRotation` shape it), and `"follow drums"` sets
 *    `harmonyFollowsDrums` while `syncopationOffset` passes straight
 *    through — a template programs the harmony arrangement exactly like
 *    it already programs the drums. */
export function applySongMap(song: BlueprintSong, map: SongMap, options?: ApplySongMapOptions): BlueprintSong {
  const variant = options?.variantName ? map.variants?.find((v) => v.name === options.variantName) : undefined;
  const slots: MapSlot[] = options?.excludeOptional
    ? (variant?.slots ?? map.slots).filter((slot) => !slot.optional)
    : (variant?.slots ?? map.slots);

  const defaults = map.defaults ?? {};
  const resolvedKey = defaults.key ?? song.key;
  const resolvedScale = defaults.scale ?? song.scale;

  const sections = slots.map((slot) => {
    const section = newSection(slot.label, slot.role);
    const beatsPerChord = slot.beatsPerChord ?? section.beatsPerChord;
    const numerator = slot.timeSignatureNumerator ?? section.timeSignatureNumerator;
    const denominator = 2 ** (slot.timeSignatureDenPower ?? section.timeSignatureDenPower);
    // "euclid" builds the 2s/3s outline from the slot's own meter (the
    // same shape the Harmony tab's euclid default produces); a 1-beat
    // meter has no valid 2/3 decomposition, so it falls back to no
    // outline rather than throwing. No harmonyRhythm → undefined, which
    // now means "follow the drums" whenever the section has a drum
    // outline (the closest sync) — only an explicit "beats" opts out.
    const harmonyRhythm = slot.harmonyRhythm;
    let harmonyMeterOutline: BlueprintSection["harmonyMeterOutline"];
    if (harmonyRhythm === "euclid") {
      const cellCount = slot.harmonyCellCount ?? twoThreeCellCounts(numerator)[0];
      if (cellCount !== undefined) {
        harmonyMeterOutline = buildEuclideanOutline(numerator, denominator, cellCount, slot.harmonyRotation ?? 0);
      }
    }
    return {
      ...section,
      bars: slot.bars ?? section.bars,
      velocity: slot.velocity ?? section.velocity,
      beatsPerChord,
      timeSignatureNumerator: numerator,
      timeSignatureDenPower: slot.timeSignatureDenPower ?? section.timeSignatureDenPower,
      transitionNote: slot.purpose,
      chords: slot.progression?.length
        ? honeycombTextToChords(slot.progression.join(" "), resolvedKey, beatsPerChord, resolvedScale)
        : section.chords,
      drumPattern: inferGrooveOverride(slot.groove) ?? section.drumPattern,
      harmonyMeterOutline,
      harmonyFollowsDrums: harmonyRhythm === "follow drums" ? true : harmonyRhythm === "beats" ? false : undefined,
      syncopationOffset: slot.syncopationOffset,
    };
  });
  // Every slot mints a fresh section id (see the comment above), so
  // syncArrangementToSections finds nothing to preserve and simply gives
  // the new song a clean, fully-populated arrangement — one repeats:1
  // entry per section, in the template's order.
  return syncArrangementToSections({
    ...song,
    bpm: defaults.bpm ?? song.bpm,
    key: resolvedKey,
    scale: resolvedScale,
    concept: defaults.concept ?? song.concept,
    sections,
  });
}
