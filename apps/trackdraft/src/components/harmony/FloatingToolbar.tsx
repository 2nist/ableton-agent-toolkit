import { useState } from "react";
import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import KeySelector from "./KeySelector";
import PresetPicker from "./PresetPicker";

const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

interface FloatingToolbarProps {
  songKey: string;
  songScale: ScaleType;
  onChangeSongKey: (key: string) => void;
  onChangeSongScale: (scale: ScaleType) => void;
  presetKeyName: NoteName;
  beatsPerChord: number;
  hasChords: boolean;
  sectionName: string;
  onApplyPreset: (chords: Chord[]) => void;
  /** The active section's raw key/scale override (undefined = inherits the
   *  song default above) — modulation lives here now, as a real selector,
   *  not a popover hanging off the hex's root cell. */
  sectionKeyOverride: NoteName | undefined;
  sectionScaleOverride: ScaleType | undefined;
  onRekeySection: (key: NoteName | undefined, scale: ScaleType | undefined) => void;
}

/** The set-occasionally, glance-often controls — song-default key/scale and
 *  progression presets — floated over the hex canvas as one collapsible bar,
 *  so the honeycomb keeps full room to wander. Per-chord editing lives in the
 *  anchored popover instead; nothing chord-specific belongs here. */
export default function FloatingToolbar({
  songKey,
  songScale,
  onChangeSongKey,
  onChangeSongScale,
  presetKeyName,
  beatsPerChord,
  hasChords,
  sectionName,
  onApplyPreset,
  sectionKeyOverride,
  sectionScaleOverride,
  onRekeySection,
}: FloatingToolbarProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute top-3 left-3 z-20 w-[236px] bg-panel/95 backdrop-blur border border-edge rounded-lg shadow-xl overflow-hidden">
      <button
        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-panelAlt"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
          Song&nbsp;·&nbsp;<span className="text-ink normal-case">{songKey} {songScale}</span>
        </span>
        <span className={`text-inkMuted text-xs transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 flex flex-col gap-3 border-t border-edge">
          <KeySelector
            activeKey={songKey}
            activeScale={songScale}
            onChangeKey={onChangeSongKey}
            onChangeScale={onChangeSongScale}
          />
          <div>
            <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted block mb-1.5">
              Section key ({sectionName || "this section"})
            </span>
            <div className="flex items-center gap-1.5 text-sm">
              <select
                className="bg-panelAlt border border-edge rounded px-2 py-1 text-ink flex-1 min-w-0"
                value={sectionKeyOverride ?? ""}
                onChange={(e) => onRekeySection((e.target.value || undefined) as NoteName | undefined, sectionScaleOverride)}
                title="Override this section's key — modulates it independently of the song key, transposing its chords"
              >
                <option value="">(song: {songKey})</option>
                {KEY_ROOTS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <select
                className="bg-panelAlt border border-edge rounded px-2 py-1 text-ink flex-1 min-w-0"
                value={sectionScaleOverride ?? ""}
                onChange={(e) => onRekeySection(sectionKeyOverride, (e.target.value || undefined) as ScaleType | undefined)}
                title="Override this section's mode"
              >
                <option value="">(song: {songScale})</option>
                {SCALES.map((sc) => (
                  <option key={sc} value={sc}>{sc}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted block mb-1.5">
              Progression preset
            </span>
            <PresetPicker
              keyName={presetKeyName}
              beatsPerChord={beatsPerChord}
              hasChords={hasChords}
              sectionName={sectionName}
              onApply={onApplyPreset}
            />
          </div>
        </div>
      )}
    </div>
  );
}
