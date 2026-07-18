import { useState } from "react";
import { SONG_MAPS } from "../../data/songMaps";

interface MapPickerProps {
  onApply: (mapId: string) => void;
  hasSections: boolean;
}

export default function MapPicker({ onApply, hasSections }: MapPickerProps) {
  const [selected, setSelected] = useState(SONG_MAPS[0].id);
  const map = SONG_MAPS.find((m) => m.id === selected)!;

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="bg-panelAlt border border-edge rounded text-sm px-2 py-1 flex-1"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {SONG_MAPS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          className="bg-accent text-black text-sm font-medium px-3 py-1 rounded"
          onClick={() => {
            if (hasSections && !confirm(`Replace all sections with the "${map.name}" template?`)) return;
            onApply(selected);
          }}
        >
          Apply template
        </button>
      </div>
      <p className="text-xs text-inkMuted">{map.description}</p>
    </div>
  );
}
