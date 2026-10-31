import { useState, type ReactNode } from "react";
import {
  noteName,
  pitchClass,
  type NoteName,
  type ScaleType,
} from "@music-theory/core";
import {
  BARS_PER_VIEW_OPTIONS,
  type BarsPerView,
} from "../../drums/blocks/meterGrid";
import { SectionNameInput } from "./SectionNameInput";
import Segmented from "../../common/Segmented";

export type FloorPreset = "front" | "threeQuarter" | "top";
export type FloorExtension = "triad" | "seventh";

const VIEW_PRESETS = [
  {
    id: "front",
    label: "front",
    hint: "Locked front view — drag chords, the camera stays put",
  },
  {
    id: "threeQuarter",
    label: "tilt",
    hint: "Free camera — drag empty floor to tilt and orbit the plate",
  },
  {
    id: "top",
    label: "top",
    hint: "From above — depth is time, left to right",
  },
] as const;

export interface FloorBandProps {
  /** Rendered before the tonic — the desk switcher. */
  leading?: React.ReactNode;
  keyName: NoteName;
  scale: ScaleType;
  tonicSteps: number;
  /** Semitones the tonic drag would move — the scale step, not a semitone. */
  tonicSemitones: number;
  onTonicPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;

  /** Root of the selected chord, if any: ⌂ rehomes the analysis from its beat. */
  homeRoot: string | null;
  onHome: () => void;
  onFollow: () => void;
  /** Authored tonic regions in the section — "follow" only exists if there are. */
  activeRegions: number;

  sections: { id: string; name: string }[];
  sectionId: string;
  onSectionChange: (sectionId: string) => void;
  /** Glue this section onto the next — the undo of an over-eager split. */
  onMergeWithNext?: (() => void) | null;
  /** Rename this section; absent on read-only surfaces. */
  onRenameSection?: ((name: string) => void) | null;

  barsPerView: BarsPerView;
  onBarsViewChange: (view: BarsPerView) => void;
  bars: number;
  barsShown: number;
  windowFirstBar: number;
  lastFirstBar: number;
  onFirstBar: (bar: number) => void;

  extension: FloorExtension;
  onExtensionChange: (extension: FloorExtension) => void;

  preset: FloorPreset;
  onPresetChange: (preset: FloorPreset) => void;
  locked: boolean;

  chordCount: number;
  cycleBeats: number;

  /** Desk-owned chrome drawn in the band (the form/rhythm tools drawer). */
  tools?: ReactNode;
}

/** The row above the plate: key, home, section, window, place, view, stats. */
export default function FloorBand({
  keyName,
  scale,
  tonicSteps,
  tonicSemitones,
  onTonicPointerDown,
  homeRoot,
  onHome,
  onFollow,
  activeRegions,
  sections,
  sectionId,
  onSectionChange,
  onMergeWithNext,
  onRenameSection,
  barsPerView,
  onBarsViewChange,
  bars,
  barsShown,
  windowFirstBar,
  lastFirstBar,
  onFirstBar,
  extension,
  onExtensionChange,
  preset,
  onPresetChange,
  locked,
  chordCount,
  cycleBeats,
  tools,
  leading,
}: FloorBandProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[9px] text-inkMuted/70">
      {leading}
      <button
        type="button"
        data-tonic
        title="Drag up or down to transpose · ⌥ for this section only · right-click to rehome the analysis"
        style={{ cursor: "ns-resize" }}
        onPointerDown={onTonicPointerDown}
        className="flex items-baseline gap-1 rounded border border-edge px-1.5 py-0.5 text-ink hover:border-accent"
      >
        <span className="text-[8px] uppercase tracking-wider text-inkMuted/70">
          tonic
        </span>
        <span className="hand-value text-sm leading-none text-accent">
          {tonicSteps === 0
            ? keyName
            : `${keyName} → ${noteName((pitchClass(keyName) + tonicSemitones) % 12, keyName)}`}
        </span>
        <span className="text-[8px] text-inkMuted/60">{scale}</span>
        {tonicSteps !== 0 && (
          <span className="text-[8px] text-track">
            {tonicSemitones > 0 ? "+" : ""}
            {tonicSemitones}
          </span>
        )}
      </button>

      <span className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!homeRoot}
          onClick={onHome}
          title={
            homeRoot
              ? `Make ${homeRoot} the home from this chord on — a modulation, not a borrowed chord`
              : "Select a chord first"
          }
          className="rounded border border-edge px-1 py-0.5 text-[9px] text-inkMuted hover:text-ink disabled:opacity-40"
        >
          ⌂ home
        </button>
        {activeRegions > 0 && (
          <button
            type="button"
            onClick={onFollow}
            title="Drop the authored homes and let the key finder decide again"
            className="rounded border border-edge px-1 py-0.5 text-[9px] text-inkMuted hover:text-ink"
          >
            follow
          </button>
        )}
      </span>

      {sections.length > 1 && renaming === null && (
        <label className="flex items-center gap-1">
          <span className="text-[8px] uppercase tracking-wider text-inkMuted/70">
            section
          </span>
          <select
            value={sectionId}
            onChange={(event) => onSectionChange(event.target.value)}
            className="rounded border border-edge bg-panel px-1 py-0.5 text-[10px] text-ink hover:border-accent"
          >
            {sections.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {onRenameSection && renaming === null && sections.length > 1 && (
        <button
          type="button"
          onClick={() =>
            setRenaming(
              sections.find((entry) => entry.id === sectionId)?.name ?? "",
            )
          }
          title="Rename this section"
          className="rounded border border-edge px-1 py-0.5 text-[9px] text-inkMuted hover:border-accent hover:text-ink"
        >
          rename
        </button>
      )}
      {renaming !== null && (
        <SectionNameInput
          name={renaming}
          onCommit={(name) => {
            onRenameSection?.(name);
            setRenaming(null);
          }}
          onCancel={() => setRenaming(null)}
          className="w-28 rounded border border-accent bg-panel px-1 py-0.5 font-mono text-[10px] text-ink outline-none"
        />
      )}

      {onMergeWithNext && (
        <button
          type="button"
          onClick={onMergeWithNext}
          title="Glue this section onto the next one — their chords become one block, one undo step"
          className="rounded border border-edge px-1 py-0.5 text-[9px] text-inkMuted hover:border-accent hover:text-ink"
        >
          merge →
        </button>
      )}

      <Segmented
        label="bars"
        value={barsPerView}
        onChange={onBarsViewChange}
        options={BARS_PER_VIEW_OPTIONS.map((option) => ({
          id: option,
          label: option === "all" ? "ALL" : option,
          hint:
            option === "all"
              ? "Whole progression per view"
              : `${option} bar${option === 1 ? "" : "s"} per view — the bar arrows walk the section`,
        }))}
      />

      <Segmented
        label="place"
        value={extension}
        onChange={onExtensionChange}
        options={(["triad", "seventh"] as const).map((option) => ({
          id: option,
          label: option === "triad" ? "triad" : "7th",
          hint: `A click on the ladder places the row's ${option === "triad" ? "diatonic triad" : "diatonic seventh"} — a row between two scale steps takes the nearer one's chord`,
        }))}
      />

      <span className="flex items-center gap-1">
        <Segmented
          label="view"
          value={preset}
          onChange={onPresetChange}
          options={VIEW_PRESETS.map((option) => ({
            id: option.id,
            label: option.label,
            hint: option.hint,
          }))}
        />
        {!locked && (
          <span
            className="text-[8px] text-track"
            title="The camera is free — drag empty floor to orbit"
          >
            unlocked
          </span>
        )}
      </span>

      <span className="flex items-center gap-1 tabular-nums text-ink">
        <button
          type="button"
          aria-label="Previous bar"
          disabled={lastFirstBar === 0}
          onClick={() =>
            onFirstBar(Math.max(0, Math.min(windowFirstBar, lastFirstBar) - 1))
          }
          className="px-0.5 text-inkMuted hover:text-ink disabled:opacity-30"
        >
          ◂
        </button>
        <span title="Bars in view">
          {barsPerView === "all"
            ? `${bars} bars`
            : `bar ${windowFirstBar + 1}–${windowFirstBar + barsShown}/${bars}`}
        </span>
        <button
          type="button"
          aria-label="Next bar"
          disabled={lastFirstBar === 0 || windowFirstBar >= lastFirstBar}
          onClick={() => onFirstBar(Math.min(lastFirstBar, windowFirstBar + 1))}
          className="px-0.5 text-inkMuted hover:text-ink disabled:opacity-30"
        >
          ▸
        </button>
      </span>

      {tools}

      <span className="ml-auto flex items-center gap-2">
        {activeRegions > 0 && (
          <span className="text-accent/80">
            {activeRegions} tonic region{activeRegions === 1 ? "" : "s"}
          </span>
        )}
        <span>
          {chordCount} chords · {cycleBeats} beats · {bars} bars
        </span>
      </span>
    </div>
  );
}
