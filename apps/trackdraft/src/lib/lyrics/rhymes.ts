export interface RhymeSuggestion {
  word: string;
  score?: number;
}

/** Datamuse's rhyme endpoint — free, no API key, matches the original
 *  TrackDraft's own documented design. */
export async function fetchRhymes(word: string, signal?: AbortSignal): Promise<RhymeSuggestion[]> {
  const url = `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=25`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Datamuse request failed: ${res.status}`);
  const data = (await res.json()) as { word: string; score?: number }[];
  return data.map((d) => ({ word: d.word, score: d.score }));
}

/** Naive offline fallback for when Datamuse is unreachable: groups words
 *  by their last two letters as a rough stand-in for a shared rhyme
 *  ending. This is a crude heuristic, not real phonetic matching (no
 *  pronouncing-dictionary lookup) -- good enough to keep the Lyrics view
 *  usable offline, not a substitute for the API when it's available. */
export function localRhymeGuess(word: string, vocabulary: string[]): RhymeSuggestion[] {
  const ending = word.toLowerCase().slice(-2);
  if (ending.length < 2) return [];
  return vocabulary
    .filter((w) => w.toLowerCase() !== word.toLowerCase() && w.toLowerCase().endsWith(ending))
    .map((w) => ({ word: w }));
}
