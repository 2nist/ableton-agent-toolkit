import { useMemo, useState } from "react";
import type { BlueprintSong, SectionRole } from "../../types/blueprint";
import {
  buildLyricDocument,
  assignLinesToSection,
  mergeLinesIntoSection,
  splitSectionAt,
  unassignLines,
  detectRepeatedBlocks,
  type LyricLine,
} from "../../lib/lyrics/sectionize";
import SectionMarker from "./SectionMarker";

const ROLE_COLOR: Partial<Record<SectionRole, string>> = {
  verse: "#60a5fa",
  chorus: "#f87171",
  pre_chorus: "#fb923c",
  bridge: "#a78bfa",
  solo: "#34d399",
  intro: "#8a8a92",
  outro: "#8a8a92",
  breakdown: "#facc15",
};

interface LyricDocumentViewProps {
  song: BlueprintSong;
  onChange: (updater: (song: BlueprintSong) => BlueprintSong) => void;
}

/**
 * The whole-song lyric document — line-selectable (not character-offset
 * selectable, matching the granularity `lyricsTimeline` and syllable
 * counting already work at) so a user can carve missing sections out of a
 * blob of undifferentiated lyrics, or fix a wrongly-drawn boundary,
 * directly from the words rather than only from Structure's abstract
 * section list. See `src/lib/lyrics/sectionize.ts` for the actual editing
 * logic — this component is just the selection UI wired to it.
 */
export default function LyricDocumentView({ song, onChange }: LyricDocumentViewProps) {
  const document = useMemo(() => buildLyricDocument(song), [song]);
  const repeatedBlocks = useMemo(() => detectRepeatedBlocks(document), [document]);

  const [anchor, setAnchor] = useState<number | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  function handleLineClick(index: number, shiftKey: boolean) {
    if (shiftKey && anchor !== null) {
      setRange({ start: Math.min(anchor, index), end: Math.max(anchor, index) });
    } else {
      setAnchor(index);
      setRange({ start: index, end: index });
    }
  }

  function clearSelection() {
    setAnchor(null);
    setRange(null);
  }

  function applyMarkAsSection(target: { role: SectionRole; name: string }) {
    if (!range) return;
    onChange((s) => assignLinesToSection(s, buildLyricDocument(s), range, target));
    clearSelection();
  }

  function applyMergeInto(targetSectionId: string) {
    if (!range) return;
    onChange((s) => mergeLinesIntoSection(s, buildLyricDocument(s), range, targetSectionId));
    clearSelection();
  }

  function applySplitHere() {
    if (!range) return;
    const line = document[range.start];
    onChange((s) => splitSectionAt(s, buildLyricDocument(s), line.sectionId, line.lineIndexInSection));
    clearSelection();
  }

  function applyUnassign() {
    if (!range) return;
    onChange((s) => unassignLines(s, buildLyricDocument(s), range));
    clearSelection();
  }

  function applyBlockAsChorus(occurrences: { start: number; end: number }[], baseName: string) {
    onChange((s) => {
      let current = s;
      occurrences.forEach((occ, i) => {
        // Line order and count never change across these edits — only
        // which section each line belongs to — so the original document's
        // {start, end} index pairs stay valid across the whole batch even
        // though each call needs a document rebuilt from the latest song.
        current = assignLinesToSection(current, buildLyricDocument(current), occ, {
          role: "chorus",
          name: occurrences.length > 1 ? `${baseName} ${i + 1}` : baseName,
        });
      });
      return current;
    });
  }

  const mergeTargets = song.sections
    .filter((s) => s.name !== "Unassigned")
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-3">
      {repeatedBlocks.length > 0 && (
        <div className="border border-edge rounded bg-panel p-2 space-y-1">
          <p className="text-xs text-inkMuted uppercase tracking-wide">Repeated lines detected</p>
          {repeatedBlocks.slice(0, 3).map((block, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-inkMuted truncate">
                "{block.normalizedText.split("\n")[0]}…" × {block.occurrences.length}
              </span>
              <button
                className="text-xs border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt whitespace-nowrap"
                onClick={() => applyBlockAsChorus(block.occurrences, "Chorus")}
              >
                Mark all {block.occurrences.length} as Chorus
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border border-edge rounded bg-panel p-3 font-mono text-sm leading-relaxed max-h-[60vh] overflow-y-auto">
        {document.map((line, index) => {
          const isSelected = range && index >= range.start && index <= range.end;
          const color = ROLE_COLOR[song.sections.find((s) => s.id === line.sectionId)?.role ?? "custom"];
          return (
            <div
              key={index}
              className={`px-2 py-0.5 cursor-pointer rounded ${isSelected ? "bg-accent/20" : "hover:bg-panelAlt"}`}
              onClick={(e) => handleLineClick(index, e.shiftKey)}
            >
              <span
                className="inline-block w-24 shrink-0 text-xs truncate align-top"
                style={{ color: color ?? "#8a8a92" }}
              >
                {line.sectionName}
              </span>
              <span className={line.text.trim().length === 0 ? "text-inkMuted" : "text-ink"}>
                {line.text || " "}
              </span>
            </div>
          );
        })}
      </div>

      {range && (
        <SectionMarker
          lineCount={range.end - range.start + 1}
          mergeTargets={mergeTargets}
          onMarkAsSection={applyMarkAsSection}
          onMergeInto={applyMergeInto}
          onSplitHere={applySplitHere}
          onUnassign={applyUnassign}
          onCancel={clearSelection}
        />
      )}
    </div>
  );
}

// Re-exported so LyricsView can type its toggle state without importing
// from the lib module directly.
export type { LyricLine };
