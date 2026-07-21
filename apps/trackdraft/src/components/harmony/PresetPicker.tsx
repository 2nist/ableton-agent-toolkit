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
 *  replace-with-confirm pattern in Structure. Compact/inline by design —
 *  this is a "set occasionally" toolbar action, meant to sit alongside
 *  key/scale/section controls rather than occupy its own boxed section. */
export default function PresetPicker({ keyName, beatsPerChord, hasChords, sectionName, onApply }: PresetPickerProps) {
  const [selected, setSelected] = useState(PRESET_ENTRIES[0][0]);
  const [key, preset] = PRESET_ENTRIES.find(([k]) => k === selected)!;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <select
        className="bg-panelAlt border border-edge rounded px-1.5 py-1 text-ink"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        title={`${preset.degrees.join(" – ")} in ${SCALE_NAMES[preset.mode]}`}
      >
        {PRESET_ENTRIES.map(([k, p]) => (
          <option key={k} value={k}>{p.name}</option>
        ))}
      </select>
      <button
        className="bg-accent text-black font-medium px-2 py-1 rounded"
        onClick={() => {
          if (hasChords && !confirm(`Replace ${sectionName}'s progression with "${preset.name}"?`)) return;
          onApply(presetToChords(key, keyName, beatsPerChord));
        }}
      >
        Apply preset
      </button>
    </div>
  );
}
