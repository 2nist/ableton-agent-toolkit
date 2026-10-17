import { useMemo } from "react";
import type { BlueprintSection } from "../../../types/blueprint";
import { FaceFrame, useSectionGrid } from "./LayerGrid";

const HEIGHT = 52;
const PAD = 7;

/** The melody layer's arrangement face: a compact contour/roll on the
 *  shared grid. Read-only overview — the note editor lives in the Melody
 *  row (✎ Notes) and the Melody workspace. */
export default function MelodyFace({
  section,
  onOpen,
}: {
  section: BlueprintSection;
  onOpen: () => void;
}) {
  const { barPx, beatsPerBar, durationBeats, setRange, onSeek } = useSectionGrid();
  const notes = useMemo(
    () => [...(section.melody?.notes ?? [])].sort((a, b) => a.startTime - b.startTime),
    [section.melody?.notes],
  );

  const pitchRange = useMemo(() => {
    if (notes.length === 0) return null;
    const pitches = notes.map((note) => note.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    return { low: low - 2, high: high + 2, span: Math.max(1, high - low + 4) };
  }, [notes]);

  if (notes.length === 0 || !pitchRange) {
    return (
      <FaceFrame height={HEIGHT}>
        <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono italic text-inkMuted/50">
          No melody yet — open ✎ Notes to draw one, or auto-fill.
        </p>
      </FaceFrame>
    );
  }

  return (
    <FaceFrame height={HEIGHT}>
      {notes.map((note, index) => {
        const left = (note.startTime / beatsPerBar) * barPx;
        const width = Math.max(2, (note.duration / beatsPerBar) * barPx - 0.5);
        const top =
          PAD +
          ((pitchRange.high - note.pitch) / pitchRange.span) * (HEIGHT - PAD * 2);
        return (
          <button
            key={index}
            type="button"
            className="absolute z-20 rounded-[2px] bg-accent/80 hover:bg-accent"
            style={{ left, width, top, height: 5 }}
            title={`MIDI ${note.pitch} · beat ${note.startTime.toFixed(2)} · ${note.duration} beats`}
            onClick={() => {
              setRange(note.startTime, note.startTime + note.duration);
              onSeek(note.startTime);
            }}
            onDoubleClick={onOpen}
            aria-label={`Melody note at beat ${note.startTime}`}
          />
        );
      })}
      {durationBeats > 0 && (
        <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-inkMuted/40">
          {notes.length} note{notes.length === 1 ? "" : "s"}
        </span>
      )}
    </FaceFrame>
  );
}
