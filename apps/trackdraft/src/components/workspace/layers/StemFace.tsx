import { useMemo } from "react";
import type { MidiNote } from "../../../lib/midiExport";
import { FaceFrame, useSectionGrid } from "./LayerGrid";

const PAD = 7;

/** A note roll for one generated stem (bass, color) on the shared grid.
 *  Read-only: the controls that shape the line live in the row below, so
 *  the face only has to answer "what will actually sound, and when". */
export default function StemFace({
  notes,
  color,
  height = 46,
  empty,
  noteLabel,
  onOpen,
}: {
  notes: MidiNote[];
  color: string;
  height?: number;
  empty: string;
  noteLabel?: (note: MidiNote) => string;
  onOpen: () => void;
}) {
  const { barPx, beatsPerBar, setRange, onSeek } = useSectionGrid();

  const range = useMemo(() => {
    if (notes.length === 0) return null;
    const pitches = notes.map((note) => note.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    return { low, high, span: Math.max(1, high - low) };
  }, [notes]);

  if (!range) {
    return (
      <FaceFrame height={height}>
        <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono italic text-inkMuted/50">
          {empty}
        </p>
      </FaceFrame>
    );
  }

  const inner = height - PAD * 2;
  const low = range.low;
  const high = range.high;

  return (
    <FaceFrame height={height}>
      {notes.map((note, index) => {
        const left = (note.startTime / beatsPerBar) * barPx;
        const width = Math.max(2, (note.duration / beatsPerBar) * barPx - 0.5);
        const top = PAD + ((high - note.pitch) / range.span) * inner;
        return (
          <button
            key={index}
            type="button"
            className="absolute z-20 rounded-[2px] hover:brightness-125"
            style={{ left, width, top, height: 5, backgroundColor: color }}
            title={
              noteLabel?.(note) ??
              `MIDI ${note.pitch} · beat ${note.startTime.toFixed(2)} · ${note.duration} beats`
            }
            onClick={() => {
              setRange(note.startTime, note.startTime + note.duration);
              onSeek(note.startTime);
            }}
            onDoubleClick={onOpen}
            aria-label={`Note at beat ${note.startTime}`}
          />
        );
      })}
      <span className="pointer-events-none absolute bottom-0.5 right-1 text-[8px] font-mono text-inkMuted/40">
        {notes.length} note{notes.length === 1 ? "" : "s"} · {low}–{high}
      </span>
    </FaceFrame>
  );
}
