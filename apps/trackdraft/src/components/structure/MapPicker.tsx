import { useState, useMemo } from "react";
import { SONG_MAPS } from "../../data/songMaps";
import { GENRE_CATALOG } from "../../data/genre-catalog/index";

type MapSource = "narrative" | "genre";

interface MapPickerProps {
  onApply: (mapId: string) => void;
  hasSections: boolean;
}

export default function MapPicker({ onApply, hasSections }: MapPickerProps) {
  const [source, setSource] = useState<MapSource>("narrative");
  const maps = useMemo(() => (source === "narrative" ? SONG_MAPS : GENRE_CATALOG), [source]);
  const [selected, setSelected] = useState(maps[0]?.id ?? "");

  // Keep selected in sync with the current source
  const map = maps.find((m) => m.id === selected) ?? maps[0];
  const effectiveId = map?.id ?? "";

  function switchSource(newSource: MapSource) {
    setSource(newSource);
    const newMaps = newSource === "narrative" ? SONG_MAPS : GENRE_CATALOG;
    if (newMaps.length > 0) setSelected(newMaps[0].id);
  }

  if (maps.length === 0 && source === "genre") {
    return (
      <div className="border border-edge rounded bg-panel p-3 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <button
            className="text-xs px-2 py-0.5 rounded border border-edge text-inkMuted hover:text-ink"
            onClick={() => switchSource("narrative")}
          >
            Narrative
          </button>
          <button className="text-xs px-2 py-0.5 rounded bg-accent text-black">
            Genre maps
          </button>
        </div>
        <p className="text-xs text-inkMuted">
          No genre maps cataloged yet — visit the Genre Workbench to generate some.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <button
          className={`text-xs px-2 py-0.5 rounded transition-colors ${source === "narrative" ? "bg-accent text-black" : "border border-edge text-inkMuted hover:text-ink"}`}
          onClick={() => switchSource("narrative")}
        >
          Narrative
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded transition-colors ${source === "genre" ? "bg-accent text-black" : "border border-edge text-inkMuted hover:text-ink"}`}
          onClick={() => switchSource("genre")}
        >
          Genre maps
          {GENRE_CATALOG.length > 0 && (
            <span className="ml-1 opacity-60">({GENRE_CATALOG.length})</span>
          )}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="bg-panelAlt border border-edge rounded text-sm px-2 py-1 flex-1"
          value={effectiveId}
          onChange={(e) => setSelected(e.target.value)}
        >
          {maps.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          className="bg-accent text-black text-sm font-medium px-3 py-1 rounded"
          onClick={() => {
            const currentMap = maps.find((m) => m.id === effectiveId);
            if (!currentMap) return;
            if (hasSections && !confirm(`Replace all sections with the "${currentMap.name}" template?`)) return;
            onApply(effectiveId);
          }}
        >
          Apply template
        </button>
      </div>
      {map && <p className="text-xs text-inkMuted">{map.description}</p>}
    </div>
  );
}
