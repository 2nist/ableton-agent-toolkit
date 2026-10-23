import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTimeSelectionStore, type TimeSelection } from "../../../store/timeSelectionStore";
import { useTimeViewportStore } from "../../../store/timeViewportStore";
import { usePalette } from "../../../theme/palette";

interface SectionGridValue {
  /** Pixel width of the whole section grid (bars × barPx). */
  width: number;
  barPx: number;
  bars: number;
  beatsPerBar: number;
  durationBeats: number;
  selection: TimeSelection | null;
  playheadBeat: number | null;
  setRange: (startBeat: number, endBeat: number) => void;
  clearRange: () => void;
  onSeek: (beat: number) => void;
}

const SectionGridContext = createContext<SectionGridValue | null>(null);

export function useSectionGrid(): SectionGridValue {
  const value = useContext(SectionGridContext);
  if (!value) throw new Error("useSectionGrid must be used inside SectionGridProvider");
  return value;
}

interface SectionGridProviderProps {
  sectionId: string;
  bars: number;
  beatsPerBar: number;
  durationBeats: number;
  playheadBeat: number | null;
  onSeek: (beat: number) => void;
  children: ReactNode;
}

/**
 * A fit-to-width view of one section, shared by every layer row. The stack
 * is an overview: it always shows the whole section, so `barPx` is derived
 * from the measured width rather than the detail editors' zoom. Selection
 * is still the shared, section-relative range, and `snap` comes from the
 * shared time viewport.
 */
export function SectionGridProvider({
  sectionId,
  bars,
  beatsPerBar,
  durationBeats,
  playheadBeat,
  onSeek,
  children,
}: SectionGridProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const snap = useTimeViewportStore((s) => s.snap);
  const selection = useTimeSelectionStore((s) =>
    s.selection && s.selection.sectionId === sectionId ? s.selection : null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setMeasuredWidth(el.clientWidth));
    observer.observe(el);
    setMeasuredWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const barPx = measuredWidth > 0 && bars > 0 ? measuredWidth / bars : 40;
  const width = bars * barPx;

  const setRange = useCallback(
    (startBeat: number, endBeat: number) => {
      const grid = snap > 0 ? snap : 0.25;
      const snapBeat = (value: number) =>
        Math.round(Math.max(0, Math.min(durationBeats, value)) / grid) * grid;
      const a = snapBeat(Math.min(startBeat, endBeat));
      const b = snapBeat(Math.max(startBeat, endBeat));
      useTimeSelectionStore.getState().setSelection({
        sectionId,
        startBeat: a,
        endBeat: Math.max(a, b),
        lanes: [],
      });
    },
    [durationBeats, sectionId, snap],
  );

  const clearRange = useCallback(() => useTimeSelectionStore.getState().clearSelection(), []);

  return (
    <SectionGridContext.Provider
      value={{
        width,
        barPx,
        bars,
        beatsPerBar,
        durationBeats,
        selection,
        playheadBeat,
        setRange,
        clearRange,
        onSeek,
      }}
    >
      <div ref={containerRef} className="w-full">
        {children}
      </div>
    </SectionGridContext.Provider>
  );
}

/** The shared face frame: bar grid, beat ticks at useful zoom, selection
 *  band and playhead. Every layer face draws inside one, so rows line up. */
export function FaceFrame({
  height,
  children,
  className = "",
}: {
  height: number;
  children?: ReactNode;
  className?: string;
}) {
  const { barPx, beatsPerBar } = useSectionGrid();
  const beatPx = barPx / Math.max(1, beatsPerBar);
  return (
    <div
      className={`relative w-full overflow-hidden rounded border border-edge/60 bg-deep ${className}`}
      style={{ height }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, color-mix(in srgb, currentColor 8%, transparent) 0 1px, transparent 1px ${barPx}px)`,
        }}
      />
      {beatPx >= 9 && (
        <div
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, color-mix(in srgb, currentColor 4%, transparent) 0 1px, transparent 1px ${beatPx}px)`,
          }}
        />
      )}
      <SelectionBand />
      {children}
      <PlayheadLine />
    </div>
  );
}

export function SelectionBand() {
  const { selection, barPx, beatsPerBar } = useSectionGrid();
  if (!selection) return null;
  const left = (selection.startBeat / beatsPerBar) * barPx;
  const width = Math.max(1, ((selection.endBeat - selection.startBeat) / beatsPerBar) * barPx);
  return (
    <div
      className="absolute inset-y-0 z-10 border-x border-accent/70 bg-accent/15 pointer-events-none"
      style={{ left, width }}
      aria-hidden
    />
  );
}

export function PlayheadLine() {
  const P = usePalette();
  const { playheadBeat, barPx, beatsPerBar } = useSectionGrid();
  if (playheadBeat == null) return null;
  return (
    <div
      className="absolute inset-y-0 z-20 w-px bg-accent pointer-events-none"
      style={{ left: (playheadBeat / beatsPerBar) * barPx, boxShadow: `0 0 4px 1px ${P.track}` }}
      aria-hidden
    />
  );
}
