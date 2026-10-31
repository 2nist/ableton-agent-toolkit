/**
 * Content signatures for the Study caches.
 *
 * The first cut keyed the library index on counts and total bars, so editing a
 * chord's root or renaming a section left the cached rows in place — the board
 * kept showing the old reading. A signature has to cover the fields the rows
 * actually carry. FNV-1a over ~30k chords is a few milliseconds; hashing the
 * JSON would be hundreds.
 */

import type { BlueprintSong } from "../../types/blueprint";

const OFFSET = 0x811c9dc5;

function fnv1a(hash: number, text: string): number {
  let h = hash;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(hash: number, value: string | number | boolean | null | undefined): number {
  return fnv1a(hash, value === null || value === undefined ? "" : String(value));
}

/** Everything `songRows()` reads, nothing it does not. */
export function songSignature(song: BlueprintSong): string {
  let hash = fnv1a(OFFSET, song.id);
  hash = mix(hash, song.title);
  hash = mix(hash, song.artist ?? "");
  hash = mix(hash, song.key);
  hash = mix(hash, song.scale);
  hash = mix(hash, song.genre ?? "");
  hash = mix(hash, song.bpm);
  hash = mix(hash, song.timeSignatureNumerator);
  hash = mix(hash, song.timeSignatureDenominator);

  for (const section of song.sections) {
    hash = mix(hash, section.id);
    hash = mix(hash, section.name);
    hash = mix(hash, section.role);
    hash = mix(hash, section.bars);
    hash = mix(hash, section.velocity);
    hash = mix(hash, section.beatsPerChord);
    hash = mix(hash, section.timeSignatureNumerator);
    hash = mix(hash, section.timeSignatureDenPower);
    hash = mix(hash, section.key ?? "");
    hash = mix(hash, section.scale ?? "");
    hash = mix(hash, section.lyrics?.length ?? 0);
    hash = mix(hash, section.lyricsTimeline?.length ?? 0);
    hash = mix(hash, section.melody?.notes?.length ?? 0);
    hash = mix(hash, section.drumBlocks?.length ?? 0);
    hash = mix(hash, section.tonicRegions?.length ?? 0);
    for (const chord of section.chords) {
      hash = mix(hash, chord.id);
      hash = mix(hash, chord.root);
      hash = mix(hash, chord.quality);
      hash = mix(hash, chord.romanNumeral);
      hash = mix(hash, chord.beats);
      hash = mix(hash, chord.restAfter ?? 0);
      hash = mix(hash, chord.restBefore ?? 0);
    }
  }
  return hash.toString(36);
}

/** One string for the whole library; rebuild the index when it changes. */
export function librarySignature(songs: readonly BlueprintSong[]): string {
  let hash = fnv1a(OFFSET, String(songs.length));
  for (const song of songs) {
    hash = fnv1a(hash, songSignature(song));
  }
  return hash.toString(36);
}
