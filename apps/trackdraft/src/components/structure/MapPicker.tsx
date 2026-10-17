import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { SONG_MAPS } from "../../data/songMaps";
import { GENRE_CATALOG } from "../../data/genre-catalog/index";
import type { ApplySongMapOptions } from "../../lib/sections";
import { askConfirm } from "../../lib/confirm";

type MapSource = "narrative" | "genre";

interface MapPickerProps {
  onApply: (mapId: string, options?: ApplySongMapOptions) => void;
  hasSections: boolean;
}

const PRIMARY_FORM = ""; // sentinel for "map.slots" in the variant <select>, vs. a real variant name

export default function MapPicker({ onApply, hasSections }: MapPickerProps) {
  const [source, setSource] = useState<MapSource>("narrative");
  const maps = useMemo(() => (source === "narrative" ? SONG_MAPS : GENRE_CATALOG), [source]);
  const [selected, setSelected] = useState(maps[0]?.id ?? "");
  const [variantName, setVariantName] = useState<string>(PRIMARY_FORM);
  const [excludeOptional, setExcludeOptional] = useState(false);
  const [seedStyleRecipe, setSeedStyleRecipe] = useState(false);

  // Keep selected in sync with the current source
  const map = maps.find((m) => m.id === selected) ?? maps[0];
  const effectiveId = map?.id ?? "";

  // A map's variants (and which of its slots are optional) only make sense
  // for the map currently selected — reset both whenever the selection
  // changes underneath them, so a stale choice from a previous map can't
  // silently carry over (e.g. a variant name that doesn't exist on the
  // newly selected map).
  useEffect(() => {
    setVariantName(PRIMARY_FORM);
    setExcludeOptional(false);
    setSeedStyleRecipe(false);
  }, [effectiveId]);

  const activeSlots = variantName ? (map?.variants?.find((v) => v.name === variantName)?.slots ?? map?.slots) : map?.slots;
  const hasOptionalSlots = (activeSlots ?? []).some((slot) => slot.optional);

  function switchSource(newSource: MapSource) {
    setSource(newSource);
    const newMaps = newSource === "narrative" ? SONG_MAPS : GENRE_CATALOG;
    if (newMaps.length > 0) setSelected(newMaps[0].id);
  }

  const genreWorkbenchLink = (
    <Link
      to="/genre-workbench"
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-accent hover:underline whitespace-nowrap"
    >
      Genre Workbench →
    </Link>
  );

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
          No genre maps cataloged yet — visit the {genreWorkbenchLink} to generate some.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
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
        {/* Only 8 of 119 known genres are cataloged -- this stays useful
           long after the catalog is no longer empty, so it's a persistent
           entry point rather than gated behind the empty-state message. */}
        {source === "genre" && genreWorkbenchLink}
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
          onClick={async () => {
            const currentMap = maps.find((m) => m.id === effectiveId);
            if (!currentMap) return;
            if (hasSections && !(await askConfirm({ title: "Replace sections", message: `Replace all sections with the "${currentMap.name}" template?`, confirmLabel: "Replace", danger: true }))) return;
            onApply(effectiveId, {
              variantName: variantName || undefined,
              excludeOptional,
              seedStyleRecipe,
            });
          }}
        >
          Apply template
        </button>
      </div>
      {map && <p className="text-xs text-inkMuted">{map.description}</p>}
      {/* Engine genre link (theory catch-up): a map whose genre is one of
         the eight drum engine families drives Groove DNA via
         `song.genre` on apply; this checkbox additionally seeds the Bend
         sliders from that family's style recipe. Off by default —
         applying a template sets structure + drum genre; full style
         stays opt-in. */}
      {map?.defaults?.genre && (
        <label className="flex items-center gap-1.5 text-xs text-inkMuted">
          <input
            type="checkbox"
            checked={seedStyleRecipe}
            onChange={(e) => setSeedStyleRecipe(e.target.checked)}
          />
          Seed Bend sliders from the &quot;{map.defaults.genre}&quot; style recipe
          <span className="text-inkMuted/50">· Groove DNA: {map.defaults.genre}</span>
        </label>
      )}
      {/* Variants are alternate full structures a genre map can offer
         (e.g. EBM's instrumental "club loop" vs. a vocal-hook form) —
         only shown when the selected map actually has any. */}
      {map && map.variants && map.variants.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-inkMuted">Form:</label>
          <select
            className="bg-panelAlt border border-edge rounded text-xs px-2 py-1 flex-1"
            value={variantName}
            onChange={(e) => setVariantName(e.target.value)}
          >
            <option value={PRIMARY_FORM}>{map.name} (default)</option>
            {map.variants.map((v) => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
      )}
      {hasOptionalSlots && (
        <label className="flex items-center gap-1.5 text-xs text-inkMuted">
          <input
            type="checkbox"
            checked={excludeOptional}
            onChange={(e) => setExcludeOptional(e.target.checked)}
          />
          Shorter edit — drop sections marked optional
        </label>
      )}
    </div>
  );
}
