/**
 * Common song structure templates.
 *
 * Based on lalo-chezia S() format and standard pop/rock song forms.
 * Each preset defines sections + arrangement, consumable by buildSong().
 */

import { S, chord } from "./song-builder";
import type { SongSection, ArrangementEntry } from "./types";

/** Standard pop song: Verse-Chorus-Verse-Chorus-Bridge-Chorus-Chorus */
export const POP_SONG = {
  sections: [
    S("Verse 1", 8, [
      chord("I", "maj", 4),
      chord("IV", "maj", 4),
      chord("I", "maj", 4),
      chord("V", "maj", 4),
    ], 4, "standard", "mf", 4, 2, "verse"),
    S("Chorus", 8, [
      chord("I", "maj", 2),
      chord("V", "maj", 2),
      chord("vi", "min", 2),
      chord("IV", "maj", 2),
    ], 2, "driving", "f", 4, 2, "chorus"),
    S("Bridge", 4, [
      chord("vi", "min", 4),
      chord("IV", "maj", 4),
    ], 4, "bridge_sparse", "mp", 4, 2, "bridge"),
  ],
  arrangement: [
    { sectionName: "Verse 1", repeats: 1 },
    { sectionName: "Chorus", repeats: 1 },
    { sectionName: "Verse 1", repeats: 1 },
    { sectionName: "Chorus", repeats: 1 },
    { sectionName: "Bridge", repeats: 1 },
    { sectionName: "Chorus", repeats: 2 },
  ],
};

/** 12-Bar Blues */
export const BLUES_SONG = {
  sections: [
    S("Blues", 12, [
      chord("I", "maj", 4),
      chord("I", "maj", 4),
      chord("I", "maj", 4),
      chord("I", "maj", 4),
      chord("IV", "maj", 4),
      chord("IV", "maj", 4),
      chord("I", "maj", 4),
      chord("I", "maj", 4),
      chord("V", "maj", 4),
      chord("IV", "maj", 4),
      chord("I", "maj", 2),
      chord("V", "maj", 2),
    ], 4, "standard", "mf", 4, 2, "verse"),
  ],
  arrangement: [
    { sectionName: "Blues", repeats: 4 },
  ],
};

/** Intro-Verse-Chorus-Verse-Chorus-Solo-Chorus-Chorus-Outro (rock) */
export const ROCK_SONG = {
  sections: [
    S("Intro", 4, [
      chord("I", "maj", 4),
    ], 4, "driving", "f", 4, 2, "intro"),
    S("Verse", 8, [
      chord("I", "maj", 4),
      chord("IV", "maj", 4),
      chord("I", "maj", 4),
      chord("V", "maj", 4),
    ], 4, "standard", "mf", 4, 2, "verse"),
    S("Chorus", 8, [
      chord("IV", "maj", 2),
      chord("I", "maj", 2),
      chord("V", "maj", 2),
      chord("vi", "min", 2),
    ], 2, "driving", "ff", 4, 2, "chorus"),
    S("Solo", 8, [
      chord("I", "maj", 4),
      chord("IV", "maj", 4),
      chord("I", "maj", 4),
      chord("V", "maj", 4),
    ], 4, "intense", "ff", 4, 2, "solo"),
    S("Outro", 4, [
      chord("I", "maj", 4),
    ], 4, "none", "p", 4, 2, "outro"),
  ],
  arrangement: [
    { sectionName: "Intro", repeats: 1 },
    { sectionName: "Verse", repeats: 2 },
    { sectionName: "Chorus", repeats: 1 },
    { sectionName: "Verse", repeats: 1 },
    { sectionName: "Chorus", repeats: 1 },
    { sectionName: "Solo", repeats: 1 },
    { sectionName: "Chorus", repeats: 2 },
    { sectionName: "Outro", repeats: 1 },
  ],
};

/** Dorian groove — verse/chorus with modal interchange */
export const DORIAN_GROOVE = {
  sections: [
    S("Verse", 8, [
      chord("i", "min", 4),
      chord("IV", "maj", 4),
    ], 4, "standard", "mf", 4, 2, "verse"),
    S("Chorus", 8, [
      chord("i", "min", 2),
      chord("VII", "maj", 2),
      chord("IV", "maj", 2),
      chord("i", "min", 2),
    ], 2, "driving", "f", 4, 2, "chorus"),
  ],
  arrangement: [
    { sectionName: "Verse", repeats: 2 },
    { sectionName: "Chorus", repeats: 1 },
    { sectionName: "Verse", repeats: 1 },
    { sectionName: "Chorus", repeats: 2 },
  ],
};

/** Electronic / ambient — long evolving sections */
export const AMBIENT_SONG = {
  sections: [
    S("Ambient A", 16, [
      chord("I", "maj7", 8),
      chord("vi", "min7", 8),
    ], 8, "none", "pp", 4, 2, "verse"),
    S("Ambient B", 16, [
      chord("IV", "maj7", 8),
      chord("I", "maj7", 8),
    ], 8, "half_time", "p", 4, 2, "chorus"),
  ],
  arrangement: [
    { sectionName: "Ambient A", repeats: 2 },
    { sectionName: "Ambient B", repeats: 1 },
    { sectionName: "Ambient A", repeats: 1 },
    { sectionName: "Ambient B", repeats: 2 },
  ],
};

/** All preset song templates */
export const SONG_PRESETS: Record<string, { sections: SongSection[]; arrangement: ArrangementEntry[] }> = {
  pop: POP_SONG,
  blues: BLUES_SONG,
  rock: ROCK_SONG,
  "dorian-groove": DORIAN_GROOVE,
  ambient: AMBIENT_SONG,
};

/** Get preset names */
export function getPresetNames(): string[] {
  return Object.keys(SONG_PRESETS);
}

/** Get a preset by name */
export function getPreset(name: string): { sections: SongSection[]; arrangement: ArrangementEntry[] } | undefined {
  return SONG_PRESETS[name];
}