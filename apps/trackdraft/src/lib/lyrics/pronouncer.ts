/**
 * Datamuse-backed pronunciation source — the app-boundary `Pronouncer` the
 * pure engine receives by injection.
 *
 * IMPORTANT: this module is deliberately NOT part of the pure engine. It is
 * the one place in the lyric stack that touches the network and localStorage;
 * the engine modules never import it (they only know the `Pronouncer`
 * function type). Keeping the I/O quarantined here is what lets every analysis
 * remain a pure function of (input, pronouncer).
 *
 * The engine's `Pronouncer` is synchronous, so lookups can't happen inside it.
 * Instead `ensure()` prefetches words asynchronously and the sync `pronouncer`
 * reads only the cache:
 *
 *  - cached ARPAbet string → the real pronunciation (CMU notation via
 *    Datamuse's `md=r`, e.g. "G IH0 T AA1 R");
 *  - cached `null` → the dictionary answered "no such word" (negative cache:
 *    never asked again);
 *  - nothing cached → `null`, which the engine reports as an unknown word —
 *    the UI shows it as guessed, and the next `ensure()` asks again.
 *
 * Network failures are NOT negative-cached, so a word that couldn't be fetched
 * stays uncached and a later attempt (once back online) can still succeed.
 */
import { normalizeWord, type Pronouncer } from "./phonetics";
import { readStorage, writeStorage } from "../../store/storage";

/** word → ARPAbet string, or `null` for a dictionary-confirmed miss. */
type PronCache = Record<string, string | null>;

interface DatamuseEntry {
  word: string;
  score?: number;
  tags?: string[];
}

const DATAMUSE_URL = "https://api.datamuse.com/words";
/** How many lookups are in flight at once — a section adds a few dozen words
 *  at most, and Datamuse has no key to rate-limit us against. */
const LOOKUP_CONCURRENCY = 6;

export interface DatamusePronouncer {
  /** Sync, cache-only — the function injected into the engine. */
  pronouncer: Pronouncer;
  /** Ask Datamuse for every word not yet in the cache. Never rejects. */
  ensure: (words: readonly string[]) => Promise<void>;
  /** For `useSyncExternalStore`: cache-version subscription. */
  subscribe: (listener: () => void) => () => void;
  /** Current cache version — a number that changes whenever the cache does. */
  version: () => number;
}

/** First pronunciation tag of a Datamuse entry (`pron:N AY1 T` → `N AY1 T`). */
export function extractPronunciation(entry: DatamuseEntry): string | null {
  const tag = entry.tags?.find((t) => t.startsWith("pron:"));
  const pron = tag?.slice("pron:".length).trim();
  return pron ? pron : null;
}

export function createDatamusePronouncer(options: {
  /** localStorage key; `null` keeps the cache in memory only (tests). */
  storageKey?: string | null;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
} = {}): DatamusePronouncer {
  const storageKey = options.storageKey ?? null;
  const fetchImpl = options.fetchImpl ?? fetch;

  let cache: PronCache = storageKey ? readStorage<PronCache>(storageKey, {}) : {};
  let version = 0;
  const listeners = new Set<() => void>();
  /** Words currently being fetched — dedupes overlapping `ensure()` calls. */
  const inFlight = new Map<string, Promise<void>>();

  function notify(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function save(): void {
    if (storageKey) writeStorage(storageKey, cache);
  }

  async function fetchWord(word: string): Promise<void> {
    const url = `${DATAMUSE_URL}?sp=${encodeURIComponent(word)}&md=r&max=8`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Datamuse request failed: ${res.status}`);
    const data = (await res.json()) as DatamuseEntry[];
    // The exact word sorts first; the prefix-matches behind it are ignored.
    const entry = data.find((d) => d.word === word);
    if (!entry) {
      cache[word] = null; // the lexicon answered: not a known word
      return;
    }
    cache[word] = extractPronunciation(entry);
  }

  function ensureOne(word: string): Promise<void> {
    const existing = inFlight.get(word);
    if (existing) return existing;
    const p = fetchWord(word)
      .catch(() => {
        // Network failure — leave the word uncached so a later ensure retries.
      })
      .finally(() => inFlight.delete(word));
    inFlight.set(word, p);
    return p;
  }

  const pronouncer: Pronouncer = (raw) => {
    const hit = cache[normalizeWord(raw)];
    return hit === undefined ? null : hit;
  };

  async function ensure(words: readonly string[]): Promise<void> {
    const wanted = Array.from(new Set(words.map(normalizeWord))).filter((w) => w !== "");
    const missing = wanted.filter((w) => !(w in cache) && !inFlight.has(w));
    if (missing.length === 0) return;

    let added = false;
    const queue = missing.slice();
    const worker = async (): Promise<void> => {
      for (;;) {
        const word = queue.shift();
        if (word === undefined) return;
        await ensureOne(word);
        if (word in cache) added = true;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, () => worker()),
    );
    if (added) {
      save();
      notify();
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { pronouncer, ensure, subscribe, version: () => version };
}

/** The app's shared source — one cache (persisted in localStorage) for every
 *  panel, so a word is only ever looked up once per browser profile. */
export const pronouncerSource = createDatamusePronouncer({
  storageKey: "trackdraft-pronunciation-cache",
});
