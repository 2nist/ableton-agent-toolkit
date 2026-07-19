import type { BlueprintSong, BlueprintSection, BlueprintChord } from "../src/blueprint.js";

let chordCounter = 0;

/** Fills in the fields these tests don't care about with sensible
 *  defaults, so each test only states what's actually relevant to it —
 *  the real schema (shared with TrackDraft) requires more fields than
 *  this extension's own logic ever reads. */
export function makeChord(
  overrides: Pick<BlueprintChord, "romanNumeral" | "root" | "quality" | "beats"> & Partial<BlueprintChord>,
): BlueprintChord {
  chordCounter += 1;
  return { id: `chord-${chordCounter}`, ...overrides };
}

export function makeSection(
  overrides: Pick<BlueprintSection, "id" | "name" | "bars" | "timeSignatureNumerator"> & Partial<BlueprintSection>,
): BlueprintSection {
  return {
    role: "custom",
    chords: [],
    beatsPerChord: 4,
    drumPattern: "standard",
    velocity: "mf",
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

export function makeSong(
  overrides: Pick<BlueprintSong, "id" | "title" | "bpm" | "sections"> & Partial<BlueprintSong>,
): BlueprintSong {
  const now = new Date().toISOString();
  return {
    key: "C",
    scale: "ionian",
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    arrangement: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
