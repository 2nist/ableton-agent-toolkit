export interface LrcLine {
  text: string;
  startSec: number;
}

/**
 * Parses LRCLIB's LRC-format syncedLyrics ("[mm:ss.xx] line text", one
 * per line) into timestamped lines. Generic — not Beatles-specific, any
 * corpus's LRCLIB match uses this same format.
 */
export function parseLrc(syncedLyrics: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const rawLine of syncedLyrics.split("\n")) {
    const match = rawLine.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!match) continue;
    const [, minutes, seconds, text] = match;
    if (!text.trim()) continue; // skip blank timestamped lines (common in LRC for musical gaps)
    lines.push({ text: text.trim(), startSec: Number(minutes) * 60 + Number(seconds) });
  }
  return lines;
}
