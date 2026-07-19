import { useState } from "react";
import { PRESET_PROGRESSIONS, SCALE_NAMES } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { presetToChords } from "../../lib/harmony/chordBuilder";
import type { Chord } from "../../types/blueprint";

interface PresetPickerProps {
  keyName: NoteName;
  beatsPerChord: number;
  hasChords: boolean;
  sectionName: string;
  onApply: (chords: Chord[]) => void;
}

const PRESET_ENTRIES = Object.entries(PRESET_PROGRESSIONS);

/** Insert one of the 10 named preset progressions into the active
 *  section, replacing whatever's there — mirrors MapPicker's
 *  replace-with-confirm pattern in Structure. */
export default function PresetPicker({ keyName, beatsPerChord, hasChords, sectionName, onApply }: PresetPickerProps) {
  const [selected, setSelected] = useState(PRESET_ENTRIES[0][0]);
  const [key, preset] = PRESET_ENTRIES.find(([k]) => k === selected)!;

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="bg-panelAlt border border-edge rounded text-sm px-2 py-1 flex-1"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {PRESET_ENTRIES.map(([k, p]) => (
            <option key={k} value={k}>{p.name}</option>
          ))}
        </select>
        <button
          className="bg-accent text-black text-sm font-medium px-3 py-1 rounded"
          onClick={() => {
            if (hasChords && !confirm(`Replace ${sectionName}'s progression with "${preset.name}"?`)) return;
            onApply(presetToChords(key, keyName, beatsPerChord));
          }}
        >
          Apply preset
        </button>
      </div>
      <p className="text-xs text-inkMuted">
        {preset.degrees.join(" – ")} in {SCALE_NAMES[preset.mode]}
      </p>
    </div>
  );
}
