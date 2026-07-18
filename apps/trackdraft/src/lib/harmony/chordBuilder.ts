import { MODE_DATA, chordName, noteName } from "@music-theory/core";
import type { ScaleType, NoteName, ChordQuality } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

export interface DiatonicOption {
  degree: string;
  root: number;
  quality: ChordQuality;
  isBorrowed: boolean;
  func: string;
}

/** All diatonic (and, for Ionian, the classic hardcoded borrowed) chord
 *  options for a key/scale, using triads. Source of the Harmony view's
 *  "quick add" palette and the hex wheel's cell contents. */
export function getDiatonicOptions(scale: ScaleType): DiatonicOption[] {
  return Object.entries(MODE_DATA[scale].map).map(([degree, entry]) => ({
    degree,
    root: entry.pc,
    quality: entry.triad,
    isBorrowed: entry.isBorrowed ?? false,
    func: entry.func,
  }));
}

export function chordDisplayName(root: number, quality: ChordQuality, key: NoteName): string {
  return chordName(root, quality, key);
}

export function chordFromDegree(
  keyPc: number,
  keyName: NoteName,
  degree: string,
  quality: ChordQuality,
  rootPc: number,
  beats: number,
): Chord {
  return {
    id: crypto.randomUUID(),
    romanNumeral: degree,
    root: noteName((keyPc + rootPc) % 12, keyName),
    quality,
    beats,
  };
}
