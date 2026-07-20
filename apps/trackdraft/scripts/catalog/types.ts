/**
 * Intermediate shape every catalog-corpus parser (Beatles, McGill,
 * Rock Corpus) converts into, before the shared merge step turns it into
 * a BlueprintSong. Real schema differences between corpora (seconds vs.
 * milliseconds, absolute chord names vs. root:quality vs. roman
 * numerals, section labels present or absent) are resolved here — the
 * merge step only ever has to deal with one shape.
 */
export interface RawChordEvent {
  startSec: number;
  endSec: number;
  /** null for a rest/no-chord event (e.g. Beatles' "N"). */
  root: string | null;
  quality: string | null;
}

export interface RawSection {
  /** undefined when the source corpus has no structural labels (e.g. Rock Corpus). */
  name?: string;
  startSec: number;
  endSec: number;
  chords: RawChordEvent[];
}

export interface RawCatalogSong {
  title: string;
  artist?: string;
  /** Bare note name, e.g. "A" — never "Key A" or "A:minor" (mode is separate). */
  key?: string;
  mode?: "ionian" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "aeolian" | "locrian";
  bpm?: number;
  sections: RawSection[];
  sourceFormat: "beatles-jcrd" | "mcgill-jcrd" | "rock-corpus-tdc";
  /** Anything the parser couldn't confidently resolve (e.g. an unrecognized chord suffix, an ambiguous mode tag). */
  warnings: string[];
}
