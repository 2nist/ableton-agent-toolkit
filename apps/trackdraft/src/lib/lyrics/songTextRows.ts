import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import { buildLyricDocument, type LyricLine } from "./sectionize";

/**
 * Song-text view model — the pure shape `LyricDocumentView` renders in the
 * Lyrics view's "Song text" mode, built so the view and the editing
 * operations can never disagree about which lines a selection covers.
 *
 * THE INDEX CONTRACT (why this file exists): every line row's `docIndex` is
 * the line's index into `buildLyricDocument(song)`. Every operation in
 * sectionize.ts (`assignLinesToSection`, `mergeLinesIntoSection`,
 * `splitSectionAt`, `unassignLines`) takes its range in that same document
 * space. The previous view numbered rows in DISPLAY order (`rows.length`
 * over an arrangement-ordered list with instrumental placeholders and a
 * hidden "Unassigned" tray) — so any selection after a placeholder or an
 * unassigned block acted on the WRONG lines, silently. Live repro that
 * confirmed it: unassign a mid-song line, then "Add Section" on the row
 * just below it carved the invisible unassigned line instead.
 *
 * The fix is structural: blocks render in canonical document order
 * (`song.sections` order — exactly `buildLyricDocument`'s order), and
 * placeholders/unassigned blocks are part of the model rather than index
 * shifts. Display order == document order by construction; regression
 * locked in songTextRows.test.ts.
 */

/** How a block reads in the flow: lyric lines · an instrumental gap ·
 *  the parked tray of lines that don't belong anywhere yet. */
export type SongTextBlockKind = "lyric" | "instrumental" | "unassigned";

export interface SongTextLine {
  line: LyricLine;
  /** TRUE index into `buildLyricDocument(song)` — what every editing
   *  operation's range is expressed in. Never a display-row number. */
  docIndex: number;
}

export interface SongTextBlock {
  section: BlueprintSection;
  kind: SongTextBlockKind;
  /** Lines with their document indices, in section order. Empty for
   *  instrumental blocks; never empty for "unassigned" (it exists only
   *  because lines were parked there — but a user could empty it, so the
   *  view must still render the tray when `kind` says so). */
  lines: SongTextLine[];
  /** Arrangement repeats for this section — 0 means deliberately skipped
   *  without deletion, 1 is the default; values are shown, not implied. */
  repeats: number;
}

export interface SongTextModel {
  blocks: SongTextBlock[];
  docLineCount: number;
}

/** The one name `unassignLines` writes (sectionize.ts) — the parked-tray
 *  detector. Matching by name (not role: role is just "custom") keeps
 *  manually created sections of the same name consistent with the op. */
export const UNASSIGNED_NAME = "Unassigned";

export function buildSongTextModel(song: BlueprintSong): SongTextModel {
  const doc = buildLyricDocument(song);

  // Group the document's lines by section, keeping each line's TRUE doc index.
  const bySection = new Map<string, SongTextLine[]>();
  doc.forEach((line, docIndex) => {
    const list = bySection.get(line.sectionId) ?? [];
    list.push({ line, docIndex });
    bySection.set(line.sectionId, list);
  });

  const entryFor = new Map(song.arrangement.map((e) => [e.sectionId, e] as const));

  const blocks = song.sections.map((section): SongTextBlock => {
    const lines = bySection.get(section.id) ?? [];
    const kind: SongTextBlockKind =
      section.name === UNASSIGNED_NAME ? "unassigned" : lines.length > 0 ? "lyric" : "instrumental";
    return {
      section,
      kind,
      lines,
      repeats: entryFor.get(section.id)?.repeats ?? 1,
    };
  });

  return { blocks, docLineCount: doc.length };
}

/** Convenience for the view: every lyric row across the blocks, in document
 *  order — handy for range math (selected text previews, aria labels). */
export function songTextLines(model: SongTextModel): SongTextLine[] {
  return model.blocks.flatMap((b) => (b.kind === "unassigned" || b.kind === "lyric" ? b.lines : []));
}
