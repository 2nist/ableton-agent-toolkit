import { useRef } from "react";
import { useSectionGrid } from "./LayerGrid";

/**
 * The shared section ruler. Pointer-only by design: click a bar to seek and
 * select it, drag to select a beat range, double-click to clear. No keyboard
 * modifier is required for any of it.
 */
export default function SectionTimeRuler() {
  const {
    bars,
    barPx,
    beatsPerBar,
    durationBeats,
    selection,
    playheadBeat,
    setRange,
    clearRange,
    onSeek,
  } = useSectionGrid();
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null);

  const beatAt = (clientX: number): number => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const beat = ((clientX - rect.left) / Math.max(1, barPx)) * beatsPerBar;
    return Math.max(0, Math.min(durationBeats, beat));
  };

  const labelEvery = barPx >= 30 ? 1 : barPx >= 16 ? 2 : barPx >= 8 ? 4 : 8;

  return (
    <div
      ref={ref}
      aria-label="Section time ruler — click a bar or drag a range"
      className="relative h-7 w-full cursor-crosshair touch-none select-none border border-edge/60 rounded bg-panelAlt/40"
      style={{ minWidth: 0 }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const beat = beatAt(event.clientX);
        dragRef.current = { anchor: beat, moved: false };
        setRange(beat, beat);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const beat = beatAt(event.clientX);
        if (Math.abs(beat - drag.anchor) > 0.01) drag.moved = true;
        if (drag.moved) setRange(drag.anchor, beat);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        if (drag.moved) return;
        const beat = beatAt(event.clientX);
        const barStart = Math.floor(beat / beatsPerBar) * beatsPerBar;
        setRange(barStart, Math.min(durationBeats, barStart + beatsPerBar));
        onSeek(beat);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onDoubleClick={clearRange}
    >
      {Array.from({ length: bars }, (_, bar) => {
        if (bar % labelEvery !== 0) return null;
        return (
          <div
            key={bar}
            className="absolute top-0 bottom-0 z-10 border-l border-edge/60 pl-1 text-[9px] font-mono text-inkMuted/70"
            style={{ left: bar * barPx }}
          >
            {bar + 1}
          </div>
        );
      })}
      {/* Beat ticks, only when they fit without noise. */}
      {barPx / beatsPerBar >= 9 &&
        Array.from({ length: Math.round(bars * beatsPerBar) }, (_, i) => (
          <div
            key={`beat-${i}`}
            className="absolute bottom-0 h-1.5 w-px bg-edge/70"
            style={{ left: (i * barPx) / beatsPerBar }}
          />
        ))}
      {selection && (
        <div
          className="absolute inset-y-0 z-0 border-x border-accent bg-accent/20 pointer-events-none"
          style={{
            left: (selection.startBeat / beatsPerBar) * barPx,
            width: Math.max(1, ((selection.endBeat - selection.startBeat) / beatsPerBar) * barPx),
          }}
        />
      )}
      {playheadBeat != null && (
        <div
          className="absolute inset-y-0 w-px bg-accent pointer-events-none"
          style={{ left: (playheadBeat / beatsPerBar) * barPx }}
        />
      )}
    </div>
  );
}

