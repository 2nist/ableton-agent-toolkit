/**
 * Shared song-blueprint shapes for the analysis scripts: the flat
 * arrangement timeline both `analyze-drums.ts` (audio) and
 * `midi-to-analysis.ts` (MIDI) need to place sections on the bar grid.
 */

export interface SongLike {
  id?: string;
  title?: string;
  bpm?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenPower?: number;
  sections?: { id: string; name: string; bars: number }[];
  arrangement?: { sectionId: string; repeats?: number }[];
}

export interface Span { sectionId: string; startBar: number; bars: number; name: string }

/** Flat arrangement timeline: one span per section occurrence. */
export function arrangementSpans(song: SongLike): { spans: Span[]; totalBars: number } {
  const byId = new Map((song.sections ?? []).map((s) => [s.id, s]));
  const spans: Span[] = [];
  let bar = 0;
  const entries = song.arrangement && song.arrangement.length > 0
    ? song.arrangement
    : (song.sections ?? []).map((s) => ({ sectionId: s.id, repeats: 1 }));
  for (const entry of entries) {
    const sec = byId.get(entry.sectionId);
    if (!sec) continue;
    const repeats = Math.max(0, Math.round(entry.repeats ?? 1));
    for (let r = 0; r < repeats; r++) {
      spans.push({ sectionId: sec.id, startBar: bar, bars: sec.bars, name: sec.name });
      bar += sec.bars;
    }
  }
  return { spans, totalBars: bar };
}
