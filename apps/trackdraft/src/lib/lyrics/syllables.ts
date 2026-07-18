import { syllable } from "syllable";

/** Syllable count for a full line, summing each word's count via the
 *  `syllable` package rather than hand-rolling English syllable
 *  heuristics. */
export function countLineSyllables(line: string): number {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return words.reduce((sum, word) => sum + syllable(word), 0);
}

export function countBlockSyllables(text: string): { line: string; syllables: number }[] {
  return text
    .split("\n")
    .map((line) => ({ line, syllables: countLineSyllables(line) }));
}
