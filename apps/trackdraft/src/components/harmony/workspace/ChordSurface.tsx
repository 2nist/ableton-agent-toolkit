import { useCallback, useState } from "react";
import type { Chord } from "../../../types/blueprint";
import { STORAGE_KEYS } from "../../../lib/persistence/keys";
import HoneycombWheel from "../HoneycombWheel";
import ProgressionEditor from "../ProgressionEditor";
import MidiChordPanel from "../MidiChordPanel";
import TapeLabel from "../../common/TapeLabel";
import type { HarmonyDeskProps } from "./types";

/**
 * The three chord views that open OVER the floor, and the one place that
 * knows about them.
 *
 * Before this, they were a `"none" | "map" | "rhythm" | "form" | "midi"` enum
 * inside `ComposeDesk`, a hand-written label ternary, and ~90 lines of
 * conditionally-rendered JSX — so adding a fourth view meant editing four
 * unrelated places, and `form` (which is not a view at all) got one of them
 * wrong. That is how the empty-overlay bug happened.
 *
 * A view is now one entry in `CHORD_VIEWS`. The floor stays behind it: these
 * are lenses on the same progression, never a replacement for the instrument.
 */
export type ChordView = "floor" | "map" | "rhythm" | "midi";

export const CHORD_VIEWS: {
  id: Exclude<ChordView, "floor">;
  /** The chip's word. Short on purpose — it sits in a dense toolbar row. */
  label: string;
  /** The panel title. */
  title: string;
  hint: string;
}[] = [
  {
    id: "map",
    label: "map",
    title: "Map",
    hint: "The hex lens — the same progression as a walk. Where does each chord sit among its neighbours?",
  },
  {
    id: "rhythm",
    label: "rhythm",
    title: "Harmonic rhythm",
    hint: "Each chord's share of the cycle. Drag a boundary to trade beats with its neighbour.",
  },
  {
    id: "midi",
    label: "midi",
    title: "MIDI in",
    hint: "Play it in — a chord at a time, or the whole take over the click. Nothing is written until you say so.",
  },
];

function isChordView(value: string | null): value is Exclude<ChordView, "floor"> {
  return CHORD_VIEWS.some((view) => view.id === value);
}

/**
 * Which view is open, remembered across sessions — the same way the desk is.
 * It used to be `useState`, which made "the desk persists but the lens doesn't"
 * an accident of which component happened to own the state.
 */
export function useChordView(): [ChordView, (view: ChordView) => void] {
  const [view, setViewState] = useState<ChordView>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.harmonyChordView.key);
      return isChordView(stored) ? stored : "floor";
    } catch {
      return "floor";
    }
  });

  const setView = useCallback((next: ChordView) => {
    setViewState(next);
    try {
      localStorage.setItem(
        STORAGE_KEYS.harmonyChordView.key,
        next === "floor" ? "" : next,
      );
    } catch {
      /* a view preference is never worth breaking the floor over */
    }
  }, []);

  return [view, setView];
}

/** The slice of the desk a chord lens is allowed to touch. */
export type ChordSurfaceDesk = Pick<
  HarmonyDeskProps,
  | "song"
  | "section"
  | "keyName"
  | "scale"
  | "regions"
  | "playheadBeat"
  | "selectedChordId"
  | "activeChordId"
  | "onSelectChord"
  | "onChangeChords"
  | "onChangeRhythm"
  | "onPreviewChord"
>;

export interface ChordSurfaceProps {
  view: ChordView;
  onClose: () => void;
  /** Only what a lens actually reads. Narrow on purpose: the views show a
   *  progression and select a chord — they never split, merge, transpose or
   *  rename a section, so they cannot be handed those verbs by accident. */
  desk: ChordSurfaceDesk;
  /** Derived numerals — the views show what the analysis says, never the
   *  stored string. */
  chords: Chord[];
  beatsPerBar: number;
  sectionBeats: number;
  harmonyOutline: HarmonyDeskProps["section"]["harmonyMeterOutline"] | null;
  extension: "triad" | "seventh";
  /** Statistics the panel header prints (borrowed / applied counts). */
  borrowedCount: number;
  appliedCount: number;
}

export default function ChordSurface({
  view,
  onClose,
  desk,
  chords,
  beatsPerBar,
  sectionBeats,
  harmonyOutline,
  extension,
  borrowedCount,
  appliedCount,
}: ChordSurfaceProps) {
  if (view === "floor") return null;
  const meta = CHORD_VIEWS.find((entry) => entry.id === view);
  if (!meta) return null;

  return (
    <div className="absolute left-3 right-3 top-[38px] z-20 max-h-[min(420px,60%)] overflow-auto rounded border border-edge bg-panel shadow-2xl">
      <div className="sticky top-0 flex items-center gap-2 border-b border-edge bg-panel px-2 py-1 font-mono text-[9px] text-inkMuted/70">
        <TapeLabel
          size="md"
          className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
        >
          {meta.title}
        </TapeLabel>
        <span className="text-inkMuted/60">{meta.hint}</span>
        <span className="ml-auto flex items-center gap-2">
          {borrowedCount > 0 && (
            <span className="text-danger">{borrowedCount} borrowed</span>
          )}
          {appliedCount > 0 && (
            <span className="text-accent">{appliedCount} applied</span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-edge px-1 hover:text-ink"
          aria-label="Close tools"
        >
          ✕
        </button>
      </div>

      {view === "map" && (
        <div className="flex min-h-[300px] items-center justify-center overflow-x-auto px-3 py-2">
          <HoneycombWheel
            keyName={desk.keyName}
            scale={desk.scale}
            chords={chords}
            beatsPerChord={desk.section.beatsPerChord}
            selectedChordId={desk.selectedChordId}
            activeChordId={desk.activeChordId}
            onSelectChord={desk.onSelectChord}
            onChangeChords={desk.onChangeChords}
            regions={desk.regions}
            colorFlavor={desk.section.colorFlavor}
            harmonyOutline={harmonyOutline}
            onPreviewChord={desk.onPreviewChord}
            mode="linear"
            initialScale={44}
            newChordExtension={extension}
          />
        </div>
      )}

      {view === "rhythm" && (
        <div className="px-2 py-2">
          <ProgressionEditor
            chords={chords}
            keyName={desk.keyName}
            scale={desk.scale}
            beatsPerBar={beatsPerBar}
            sectionBeats={sectionBeats}
            selectedChordId={desk.selectedChordId}
            activeChordId={desk.activeChordId}
            outlineGoverned={false}
            regions={desk.regions}
            onSelectChord={(id) => desk.onSelectChord(id)}
            onChange={desk.onChangeRhythm}
          />
        </div>
      )}

      {view === "midi" && (
        <MidiChordPanel
          song={desk.song}
          section={desk.section}
          keyName={desk.keyName}
          scale={desk.scale}
          selectedChordId={desk.selectedChordId}
          playheadBeat={desk.playheadBeat}
          onChangeChords={desk.onChangeChords}
          onSelectChord={desk.onSelectChord}
          onPreviewChord={desk.onPreviewChord}
        />
      )}
    </div>
  );
}
