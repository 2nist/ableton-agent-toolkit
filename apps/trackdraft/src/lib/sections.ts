import type { BlueprintSong, BlueprintSection } from "../types/blueprint";
import type { SongMap } from "../data/songMaps";

function newSection(name: string, role: BlueprintSection["role"]): BlueprintSection {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    bars: 8,
    chords: [],
    beatsPerChord: 4,
    drumPattern: "standard",
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
  };
}

export function addSection(song: BlueprintSong, role: BlueprintSection["role"] = "verse"): BlueprintSong {
  const name = `${role.charAt(0).toUpperCase()}${role.slice(1)} ${song.sections.filter((s) => s.role === role).length + 1}`;
  return { ...song, sections: [...song.sections, newSection(name, role)] };
}

export function removeSection(song: BlueprintSong, sectionId: string): BlueprintSong {
  return { ...song, sections: song.sections.filter((s) => s.id !== sectionId) };
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
  return { ...song, sections };
}

/** Replaces the song's sections wholesale with a MAP template's slots.
 *  Destructive by design (confirmed in the UI before calling this) —
 *  applying a template is meant to set the initial shape of a song, not
 *  merge with whatever's already there. */
export function applySongMap(song: BlueprintSong, map: SongMap): BlueprintSong {
  const sections = map.slots.map((slot) => ({
    ...newSection(slot.label, slot.role),
    transitionNote: slot.purpose,
  }));
  return { ...song, sections };
}
