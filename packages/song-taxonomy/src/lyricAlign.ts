export interface LrcLine {
  text: string;
  startSec: number;
}

/**
 * Parses LRCLIB's LRC-format `syncedLyrics` ("[mm:ss.xx] line text", one
 * per line) into timestamped lines. Mirrors `apps/trackdraft/scripts/catalog/lrc.ts`'s
 * `parseLrc` (same format, same behavior) — reimplemented locally rather
 * than imported across the app/package boundary, since this package has
 * zero dependencies and must not reach into an app's script directory.
 */
export function parseLrc(syncedLyrics: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const rawLine of syncedLyrics.split("\n")) {
    const match = rawLine.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!match) continue;
    const [, minutes, seconds, text] = match;
    if (!text.trim()) continue;
    lines.push({ text: text.trim(), startSec: Number(minutes) * 60 + Number(seconds) });
  }
  return lines;
}

export interface LyricCandidate {
  title: string;
  artist: string;
  syncedLyrics: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Fuzzy-match a song to one of several LRCLIB candidates by normalized
 * title, disambiguating same-title matches by artist and falling back to
 * substring containment when nothing matches exactly. Returns null rather
 * than guessing when nothing is close — a wrong lyric match would corrupt
 * the intro-repair heuristic downstream, which is worse than having no
 * lyric evidence at all.
 */
export function matchLyrics(title: string, artist: string, candidates: readonly LyricCandidate[]): LyricCandidate | null {
  const normTitle = normalize(title);
  if (!normTitle) return null;

  const exact = candidates.filter((c) => normalize(c.title) === normTitle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const normArtist = normalize(artist);
    const byArtist = exact.find((c) => {
      const ca = normalize(c.artist);
      return normArtist.length > 0 && (ca.includes(normArtist) || normArtist.includes(ca));
    });
    return byArtist ?? exact[0];
  }

  return (
    candidates.find((c) => {
      const ct = normalize(c.title);
      return ct.length > 0 && (ct.includes(normTitle) || normTitle.includes(ct));
    }) ?? null
  );
}

/**
 * Count sung lyric lines landing inside each section's [startMs,
 * startMs+durationMs) window, attaching the count as `lyricLineCount` —
 * the evidence `skeleton.ts`'s intro repair reads. Tokens without timing
 * (hand-authored BlueprintSong sections) pass through unchanged.
 */
export function attachLyricCounts<T extends { startMs?: number; durationMs?: number }>(
  tokens: readonly T[],
  lines: readonly LrcLine[],
): (T & { lyricLineCount?: number })[] {
  return tokens.map((token) => {
    if (token.startMs === undefined || token.durationMs === undefined) return token;
    const startSec = token.startMs / 1000;
    const endSec = (token.startMs + token.durationMs) / 1000;
    const count = lines.filter((line) => line.startSec >= startSec && line.startSec < endSec).length;
    return { ...token, lyricLineCount: count };
  });
}
