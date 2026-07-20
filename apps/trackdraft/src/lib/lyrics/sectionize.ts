import type { BlueprintSection, BlueprintSong, LyricsTimelineEntry, SectionRole } from "../../types/blueprint";
import { countLineSyllables } from "./syllables";

/**
 * One line of the whole-song lyric document — the flattened, ordered view
 * `LyricsView`'s "Song text" mode renders, line-selectable rather than
 * character-selectable (matching the granularity `lyricsTimeline` and
 * `countLineSyllables` already work at). Every line traces back to the
 * section it currently lives in and its position within that section's own
 * line list, which is exactly what the editing operations below need to
 * trim/split/reassign it.
 */
export interface LyricLine {
  sectionId: string;
  sectionName: string;
  lineIndexInSection: number;
  text: string;
  startBeat?: number;
}

/** Concatenates every section's lyrics (preferring `lyricsTimeline` when
 *  present, since it carries real timing) into one ordered document. */
export function buildLyricDocument(song: BlueprintSong): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const section of song.sections) {
    if (section.lyricsTimeline && section.lyricsTimeline.length > 0) {
      section.lyricsTimeline.forEach((entry, index) => {
        lines.push({
          sectionId: section.id,
          sectionName: section.name,
          lineIndexInSection: index,
          text: entry.text,
          startBeat: entry.startBeat,
        });
      });
    } else if (section.lyrics) {
      section.lyrics.split("\n").forEach((text, index) => {
        lines.push({ sectionId: section.id, sectionName: section.name, lineIndexInSection: index, text });
      });
    }
  }
  return lines;
}

function firstTimedBeat(lines: readonly LyricLine[]): number | undefined {
  return lines.find((line) => line.startBeat !== undefined)?.startBeat;
}

/** Bars implied by real timing: the span from this section's first sung
 *  beat to whatever comes next in the document (also timed), rounded to
 *  whole bars. Undefined when either boundary lacks timing — callers fall
 *  back to an explicit default rather than a fabricated bar count. */
function deriveBars(startBeat: number, nextStartBeat: number, beatsPerBar: number): number | undefined {
  const span = nextStartBeat - startBeat;
  if (span <= 0) return undefined;
  return Math.max(1, Math.round(span / beatsPerBar));
}

function linesToLyrics(lines: readonly LyricLine[]): string {
  return lines.map((l) => l.text).join("\n");
}

function linesToTimeline(lines: readonly LyricLine[]): LyricsTimelineEntry[] | undefined {
  const timed = lines.filter((l) => l.startBeat !== undefined).map((l) => ({ text: l.text, startBeat: l.startBeat! }));
  return timed.length > 0 ? timed : undefined;
}

interface ExtractResult {
  /** The song with the selected lines removed from their donor section(s) — split into a
   *  remainder-after section when the selection was a strict interior sub-range. */
  song: BlueprintSong;
  /** Index in `song.sections` right after the last donor-derived section — where a newly
   *  created section from this selection belongs, so it lands where the user selected it. */
  insertAt: number;
  extractedLyrics: string;
  extractedTimeline: LyricsTimelineEntry[] | undefined;
  derivedBars: number | undefined;
}

/**
 * Shared core of every editing operation below: remove a contiguous range
 * of document lines from whichever section(s) currently own them, without
 * losing anything. A donor section keeps its leading unselected lines (if
 * any); a trailing unselected run becomes a brand-new section with the
 * same role/name — never merged silently into whatever comes next — so a
 * selection from the middle of one big blob still leaves both the head and
 * tail of that blob intact and editable afterward.
 */
function extractLines(song: BlueprintSong, documentLines: readonly LyricLine[], start: number, end: number): ExtractResult {
  const selected = documentLines.slice(start, end + 1);
  const donorIds = new Set(selected.map((l) => l.sectionId));

  const newSections: BlueprintSection[] = [];
  let insertAt = 0;

  for (const section of song.sections) {
    if (!donorIds.has(section.id)) {
      newSections.push(section);
      continue;
    }

    const allLines = documentLines.filter((l) => l.sectionId === section.id);
    const selectedIndices = new Set(
      selected.filter((l) => l.sectionId === section.id).map((l) => l.lineIndexInSection),
    );
    const selectedNums = [...selectedIndices];
    const minSel = Math.min(...selectedNums);
    const maxSel = Math.max(...selectedNums);

    const before = allLines.filter((l) => l.lineIndexInSection < minSel);
    const after = allLines.filter((l) => l.lineIndexInSection > maxSel);

    if (before.length > 0) {
      newSections.push({ ...section, lyrics: linesToLyrics(before), lyricsTimeline: linesToTimeline(before) });
    }

    insertAt = newSections.length;

    if (after.length > 0) {
      newSections.push({
        ...section,
        id: crypto.randomUUID(),
        lyrics: linesToLyrics(after),
        lyricsTimeline: linesToTimeline(after),
      });
    }
    // If both before and after are empty, the entire donor section was
    // selected — nothing of it survives, and insertAt already points at
    // the correct position for the new/target section to land.
  }

  const derivedBars = (() => {
    const startBeat = firstTimedBeat(selected);
    const nextBeat = firstTimedBeat(documentLines.slice(end + 1));
    if (startBeat === undefined || nextBeat === undefined) return undefined;
    return deriveBars(startBeat, nextBeat, song.timeSignatureNumerator);
  })();

  return {
    song: { ...song, sections: newSections },
    insertAt,
    extractedLyrics: linesToLyrics(selected),
    extractedTimeline: linesToTimeline(selected),
    derivedBars,
  };
}

export interface SectionTarget {
  role: SectionRole;
  name: string;
}

/** "Mark as section": carve the selected line range out into a brand-new
 *  section, inserted where the selection was. Real timing (when available)
 *  sets a real bar count instead of the usual default. */
export function assignLinesToSection(
  song: BlueprintSong,
  documentLines: readonly LyricLine[],
  range: { start: number; end: number },
  target: SectionTarget,
): BlueprintSong {
  const { song: trimmed, insertAt, extractedLyrics, extractedTimeline, derivedBars } = extractLines(
    song,
    documentLines,
    range.start,
    range.end,
  );

  const newSection: BlueprintSection = {
    id: crypto.randomUUID(),
    name: target.name,
    role: target.role,
    bars: derivedBars ?? 8,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: song.timeSignatureNumerator,
    timeSignatureDenPower: 2,
    lyrics: extractedLyrics,
    lyricsTimeline: extractedTimeline,
  };

  const sections = [...trimmed.sections];
  sections.splice(insertAt, 0, newSection);
  return { ...trimmed, sections };
}

/** "Unassign": lines that don't belong anywhere yet still have to live
 *  somewhere in this schema (every line lives inside some section's
 *  lyrics) — so this reuses the same "new section" path, tagged with a
 *  fixed `custom`/"Unassigned" role+name rather than inventing a
 *  schema-level "orphaned text" concept. Nothing is lost; it's just
 *  visibly parked for later re-assignment. */
export function unassignLines(song: BlueprintSong, documentLines: readonly LyricLine[], range: { start: number; end: number }): BlueprintSong {
  return assignLinesToSection(song, documentLines, range, { role: "custom", name: "Unassigned" });
}

/** "Merge into [an existing section]": moves the selected lines out of
 *  their donor(s) and appends them onto `targetSectionId`'s existing
 *  lyrics — used for "merge into previous" and for consolidating detected
 *  chorus repeats into one already-created Chorus section. */
export function mergeLinesIntoSection(
  song: BlueprintSong,
  documentLines: readonly LyricLine[],
  range: { start: number; end: number },
  targetSectionId: string,
): BlueprintSong {
  const { song: trimmed, extractedLyrics, extractedTimeline } = extractLines(song, documentLines, range.start, range.end);

  const sections = trimmed.sections.map((section) => {
    if (section.id !== targetSectionId) return section;
    const mergedLyrics = section.lyrics ? `${section.lyrics}\n${extractedLyrics}` : extractedLyrics;
    const mergedTimeline =
      section.lyricsTimeline || extractedTimeline
        ? [...(section.lyricsTimeline ?? []), ...(extractedTimeline ?? [])]
        : undefined;
    return { ...section, lyrics: mergedLyrics, lyricsTimeline: mergedTimeline };
  });

  return { ...trimmed, sections };
}

/** "Split here": break one section into two at a line boundary, both
 *  keeping the same role — for when a section's content is right but its
 *  boundary is in the wrong place, rather than a mislabeling. */
export function splitSectionAt(song: BlueprintSong, documentLines: readonly LyricLine[], sectionId: string, lineIndexInSection: number): BlueprintSong {
  const sectionLines = documentLines.filter((l) => l.sectionId === sectionId);
  const docIndexAtSplit = documentLines.findIndex((l) => l.sectionId === sectionId && l.lineIndexInSection === lineIndexInSection);
  if (docIndexAtSplit === -1 || sectionLines.length === 0) return song;

  const section = song.sections.find((s) => s.id === sectionId);
  if (!section) return song;

  // Reuse extractLines by treating "everything from the split point to the
  // end of this section" as the selection to carve out into a same-role
  // continuation section.
  const lastLineOfSection = sectionLines[sectionLines.length - 1];
  const docEndIndex = documentLines.findIndex(
    (l) => l.sectionId === sectionId && l.lineIndexInSection === lastLineOfSection.lineIndexInSection,
  );

  return assignLinesToSection(song, documentLines, { start: docIndexAtSplit, end: docEndIndex }, { role: section.role, name: `${section.name} (cont.)` });
}

export interface RepeatedBlock {
  normalizedText: string;
  /** Document line-index ranges (inclusive) of each occurrence, in document order. */
  occurrences: { start: number; end: number }[];
}

function normalizeLine(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

/**
 * Chorus-detection assist: finds the longest line-sequences that recur
 * verbatim (after normalizing case/punctuation) elsewhere in the document.
 *
 * This does NOT rely on blank lines as stanza separators — an earlier
 * version did, and it silently detected nothing on any section built from
 * `lyricsTimeline`, because `parseLrc` (the LRCLIB ingestion path; see
 * `scripts/catalog/lrc.ts`) drops blank timestamped lines entirely, so
 * real timestamped lyrics never contain a blank-line boundary to split on.
 * Sliding-window matching works on both shapes: plain-text blobs (which do
 * keep blank lines) and timeline-derived documents (which don't).
 *
 * Algorithm: for decreasing window sizes, group same-length line windows
 * by normalized joined text; any group with 2+ non-overlapping occurrences
 * is a candidate, greedily extended forward line-by-line as long as every
 * occurrence keeps matching and doesn't collide with the next one. Trying
 * the largest window first means a long chorus is captured as one block
 * rather than fragmenting into several smaller matches; matched lines are
 * "claimed" so smaller window sizes don't re-report a sub-span of it.
 */
export function detectRepeatedBlocks(documentLines: readonly LyricLine[]): RepeatedBlock[] {
  const nonBlank = documentLines.map((line, index) => ({ index, text: normalizeLine(line.text) })).filter((l) => l.text.length > 0);
  const n = nonBlank.length;
  const claimed = new Array(n).fill(false);
  const results: RepeatedBlock[] = [];

  for (const windowSize of [6, 5, 4, 3, 2]) {
    const groups = new Map<string, number[]>();
    for (let start = 0; start + windowSize <= n; start++) {
      let anyClaimed = false;
      for (let k = 0; k < windowSize; k++) if (claimed[start + k]) anyClaimed = true;
      if (anyClaimed) continue;
      const key = Array.from({ length: windowSize }, (_, k) => nonBlank[start + k].text).join("\n");
      const list = groups.get(key) ?? [];
      list.push(start);
      groups.set(key, list);
    }

    for (const starts of groups.values()) {
      const nonOverlapping: number[] = [];
      for (const s of starts) {
        if (nonOverlapping.every((prev) => s >= prev + windowSize)) nonOverlapping.push(s);
      }
      if (nonOverlapping.length < 2) continue;

      let length = windowSize;
      while (true) {
        const nextPositions = nonOverlapping.map((s) => s + length);
        if (nextPositions.some((p) => p >= n || claimed[p])) break;
        const nextTexts = new Set(nextPositions.map((p) => nonBlank[p].text));
        if (nextTexts.size !== 1) break;
        const sorted = [...nonOverlapping].sort((a, b) => a - b);
        if (sorted.some((s, i) => i > 0 && s < sorted[i - 1] + length + 1)) break;
        length++;
      }

      for (const s of nonOverlapping) for (let k = 0; k < length; k++) claimed[s + k] = true;

      const normalizedText = Array.from({ length }, (_, k) => nonBlank[nonOverlapping[0] + k].text).join("\n");
      const occurrences = nonOverlapping
        .map((s) => ({ start: nonBlank[s].index, end: nonBlank[s + length - 1].index }))
        .sort((a, b) => a.start - b.start);
      results.push({ normalizedText, occurrences });
    }
  }

  return results.sort((a, b) => b.occurrences.length - a.occurrences.length || b.normalizedText.length - a.normalizedText.length);
}

export { countLineSyllables };
