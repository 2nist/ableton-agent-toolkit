import { useMemo } from "react";
import type { BlueprintSection } from "../../../types/blueprint";
import { FaceFrame, useSectionGrid } from "./LayerGrid";

const HEIGHT = 44;

/** The lyrics layer's arrangement face. When the section carries timed
 *  lyric entries they render as blocks on the shared grid; otherwise the
 *  pad's text is summarized honestly (no invented timing). */
export default function LyricsFace({
  section,
  onOpen,
}: {
  section: BlueprintSection;
  onOpen: () => void;
}) {
  const { durationBeats, beatsPerBar, barPx, setRange } = useSectionGrid();
  const entries = useMemo(
    () =>
      (section.lyricsTimeline ?? [])
        .filter((entry) => entry.text.trim().length > 0)
        .sort((a, b) => a.startBeat - b.startBeat),
    [section.lyricsTimeline],
  );
  const lines = useMemo(
    () => (section.lyrics ?? "").split("\n").filter((line) => line.trim().length > 0),
    [section.lyrics],
  );

  if (entries.length === 0) {
    return (
      <FaceFrame height={HEIGHT}>
        <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-2xs font-mono italic text-inkMuted/50">
          {lines.length > 0
            ? `${lines.length} line${lines.length === 1 ? "" : "s"} — no time anchors yet (the pad below is the editor).`
            : "No lyrics yet — write them in the pad below."}
        </p>
      </FaceFrame>
    );
  }

  return (
    <FaceFrame height={HEIGHT}>
      {entries.map((entry, index) => {
        const end = Math.min(durationBeats, entry.endBeat ?? entry.startBeat + beatsPerBar);
        const left = (entry.startBeat / beatsPerBar) * barPx;
        const width = Math.max(3, ((end - entry.startBeat) / beatsPerBar) * barPx - 1);
        return (
          <button
            key={index}
            type="button"
            className="absolute top-1 bottom-1 z-20 overflow-hidden rounded-sm border border-edge/70 bg-panelAlt px-1 text-left hover:border-inkMuted"
            style={{ left, width }}
            title={entry.text}
            onClick={() => setRange(entry.startBeat, end)}
            onDoubleClick={onOpen}
          >
            {width >= 30 && (
              <span className="block truncate text-[10px] leading-tight text-ink/90">{entry.text}</span>
            )}
          </button>
        );
      })}
    </FaceFrame>
  );
}
