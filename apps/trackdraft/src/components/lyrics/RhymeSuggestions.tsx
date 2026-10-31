import { useState } from "react";
import { fetchRhymes, localRhymeGuess, type RhymeSuggestion } from "../../lib/lyrics/rhymes";
import TapeLabel from "../common/TapeLabel";

interface RhymeSuggestionsProps {
  vocabulary: string[];
}

export default function RhymeSuggestions({ vocabulary }: RhymeSuggestionsProps) {
  const [word, setWord] = useState("");
  const [results, setResults] = useState<RhymeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  async function search(w: string) {
    if (!w.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    setOffline(false);
    try {
      const rhymes = await fetchRhymes(w.trim());
      setResults(rhymes);
    } catch {
      setOffline(true);
      setResults(localRhymeGuess(w.trim(), vocabulary));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <TapeLabel as="p" size="md" className="text-xs text-inkMuted uppercase tracking-wide">Rhyme suggestions</TapeLabel>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(word);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-edge bg-panelAlt px-2 py-1 text-2xs"
          placeholder="Word to rhyme…"
          value={word}
          onChange={(e) => setWord(e.target.value)}
        />
        <button type="submit" className="shrink-0 rounded border border-edge px-2 py-1 text-2xs hover:bg-panelAlt">
          {loading ? "…" : "Find"}
        </button>
      </form>
      {offline && (
        <p className="text-2xs text-inkMuted">
          Datamuse unreachable — showing a rough local guess (matching endings, not real phonetics) from this song's lyrics only.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {results.map((r) => (
          <span key={r.word} className="rounded bg-panelAlt px-1.5 py-0.5 text-2xs">
            {r.word}
          </span>
        ))}
        {results.length === 0 && !loading && (
          <p className="text-2xs text-inkMuted">No suggestions yet.</p>
        )}
      </div>
    </div>
  );
}
