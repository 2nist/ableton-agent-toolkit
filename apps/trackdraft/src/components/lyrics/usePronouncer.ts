import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { normalizeWord, type Pronouncer } from "../../lib/lyrics/phonetics";
import { pronouncerSource } from "../../lib/lyrics/pronouncer";

/**
 * The app-side bridge to the shared pronunciation cache: subscribes to it
 * (so a lookup completing re-renders the caller) and asks Datamuse for any of
 * `words` it hasn't seen before. Returns the synchronous `Pronouncer` the
 * engine modules take by injection, plus whether a lookup is outstanding.
 *
 * Engines stay pure: this hook is where the I/O enters, not inside them.
 */
export function usePronouncer(words: readonly string[]): { pronouncer: Pronouncer; pending: boolean } {
  // Re-render when the shared cache changes (a prefetch landing, a panel
  // elsewhere learning new words). The snapshot is a monotonically increasing
  // version counter, so React can bail out of no-op updates cheaply.
  useSyncExternalStore(pronouncerSource.subscribe, pronouncerSource.version, () => 0);

  // Callers typically rebuild `words` every render; key the prefetch on its
  // CONTENTS so the effect only runs when the vocabulary actually changes
  // (otherwise the pending true→false cycle would re-render forever).
  const key = words.join(" ");
  const unique = useMemo(
    () => Array.from(new Set(key.split(" ").map(normalizeWord).filter((w) => w !== ""))),
    [key],
  );

  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    setPending(true);
    void pronouncerSource.ensure(unique).finally(() => {
      if (alive) setPending(false);
    });
    return () => {
      alive = false;
    };
  }, [unique]);

  return { pronouncer: pronouncerSource.pronouncer, pending };
}
