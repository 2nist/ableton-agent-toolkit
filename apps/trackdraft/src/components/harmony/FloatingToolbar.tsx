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

/** The dock's default tools content for Harmony — song/section key+scale
 *  and progression presets — shown whenever no chord is selected. Used to
 *  float over the hex canvas as a collapsible bar; now a plain horizontal
 *  row filling the dock's tools area (the dock's own Info/Tools tab strip
 *  is what hides/shows this, so the old collapse toggle is gone too). */
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
  return (
    <div className="p-2.5 space-y-3">
      <div>
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Song key</span>
        <KeySelector
          activeKey={songKey}
          activeScale={songScale}
          onChangeKey={onChangeSongKey}
          onChangeScale={onChangeSongScale}
        />
      </div>
      <div>
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
          Section ({sectionName || "this section"})
        </span>
        <div className="space-y-1.5">
          <select
            className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-sm text-ink"
            value={sectionKeyOverride ?? ""}
            onChange={(e) => onRekeySection((e.target.value || undefined) as NoteName | undefined, sectionScaleOverride)}
            title="Override this section's key — modulates it independently of the song key, transposing its chords"
          >
            <option value="">Key: (use {songKey})</option>
            {KEY_ROOTS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-sm text-ink"
            value={sectionScaleOverride ?? ""}
            onChange={(e) => onRekeySection(sectionKeyOverride, (e.target.value || undefined) as ScaleType | undefined)}
            title="Override this section's mode"
          >
            <option value="">Scale: (use {songScale})</option>
            {SCALES.map((sc) => (
              <option key={sc} value={sc}>{sc}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
          Preset
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
  );
}
