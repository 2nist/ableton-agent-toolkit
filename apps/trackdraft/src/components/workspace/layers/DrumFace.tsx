import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import type { DrumLaneId } from "@drum/library";
import type { BlueprintSection, BlueprintSong } from "../../../types/blueprint";
import { resolveSectionLaneHits } from "../../../lib/timeline/drumLaneHits";
import { DRUM_LANES, laneColor } from "../../drums/laneStyle";
import { usePalette } from "../../../theme/palette";
import { FaceFrame, useSectionGrid } from "./LayerGrid";

const LANE_H = 8;
const PAD = 5;

/** The drums layer's arrangement face: one dot per resolved hit, six lane
 *  rows, on the shared grid. This is the broad face; the classic line view
 *  and the Blocks editor stay one click down. */
export default function DrumFace({
  section,
  song,
  occurrenceIndex,
  onOpen,
  onEngage,
}: {
  section: BlueprintSection;
  song: BlueprintSong;
  occurrenceIndex: number;
  onOpen: () => void;
  onEngage?: () => void;
}) {
  const P = usePalette();
  const { width, barPx, beatsPerBar, durationBeats, setRange, onSeek } = useSectionGrid();
  const hits = useMemo(
    () => resolveSectionLaneHits(section, song, occurrenceIndex),
    [section, song, occurrenceIndex],
  );
  const height = PAD * 2 + DRUM_LANES.length * LANE_H;
  const total = useMemo(
    () => Array.from(hits.values()).reduce((sum, lane) => sum + lane.length, 0),
    [hits],
  );

  function handlePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const beat = Math.max(
      0,
      Math.min(durationBeats, ((event.clientX - rect.left) / Math.max(1, barPx)) * beatsPerBar),
    );
    const barStart = Math.floor(beat / beatsPerBar) * beatsPerBar;
    setRange(barStart, Math.min(durationBeats, barStart + beatsPerBar));
    onSeek(beat);
    onEngage?.();
  }

  return (
    <div
      className="cursor-pointer"
      onPointerDown={handlePointer}
      onDoubleClick={onOpen}
      title={`${total} hits — click a bar to select it, double-click for the Blocks editor`}
    >
      <FaceFrame height={height}>
        {total === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono italic text-inkMuted/50">
            {section.drumPattern === "none"
              ? "Muted — no kit on this section."
              : "No resolvable groove yet — author one in the drums editor."}
          </p>
        )}
        <svg
          width={width || undefined}
          height={height}
          className="absolute inset-0 pointer-events-none"
          role="img"
          aria-label={`Drum pattern: ${total} hits`}
        >
          {DRUM_LANES.map((lane, laneIndex) => {
            const y = PAD + laneIndex * LANE_H + LANE_H / 2;
            return (
              <g key={lane.key}>
                <line
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke={P.grid} strokeOpacity={0.25}
                  strokeWidth={1}
                />
                {(hits.get(lane.key as DrumLaneId) ?? []).map((hit, hitIndex) => (
                  <circle
                    key={hitIndex}
                    cx={(hit.beat / beatsPerBar) * barPx}
                    cy={y}
                    r={2.1}
                    fill={laneColor(lane, P)}
                    opacity={0.35 + (hit.velocity / 127) * 0.65}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </FaceFrame>
    </div>
  );
}
