import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { GENRE_CATALOG } from "../../data/genre-catalog";
import { SONG_MAPS } from "../../data/songMaps";
import type { SongMap } from "../../data/songMaps";

/** All templates from both the genre catalog and built-in song maps, deduplicated by id. */
const ALL_TEMPLATES: SongMap[] = (() => {
  const seen = new Set<string>();
  const merged: SongMap[] = [];
  for (const g of GENRE_CATALOG) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      merged.push(g as SongMap);
    }
  }
  for (const m of SONG_MAPS) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
    }
  }
  return merged;
})();

export default function TemplatePicker() {
  const createNewSong = useSongStore((s) => s.createNewSong);
  const navigate = useNavigate();

  function handleCreate(template: SongMap) {
    const song = createNewSong(template.name);
    const defaults = template.defaults;
    if (defaults) {
      useSongStore.getState().updateCurrentSong((s) => ({
        ...s,
        bpm: defaults.bpm ?? s.bpm,
        key: (defaults.key as typeof s.key) ?? s.key,
        scale: (defaults.scale as typeof s.scale) ?? s.scale,
        concept: defaults.concept ?? s.concept,
      }));
    }
    // Navigate directly to Structure so user can immediately see the template slots
    navigate(`/song/${song.id}/structure`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold mb-3">Song Templates</h2>
      <p className="text-xs text-inkMuted mb-4">
        Start a new song from a template — each comes with section slots and genre defaults.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ALL_TEMPLATES.map((template) => (
          <button
            key={template.id}
            className="text-left border border-edge rounded p-3 hover:border-accent/50 hover:bg-panelAlt transition-colors group"
            onClick={() => handleCreate(template)}
          >
            <div className="text-xs font-medium group-hover:text-accent transition-colors mb-1">
              {template.name}
            </div>
            <div className="text-[10px] text-inkMuted line-clamp-2 mb-2">
              {template.description}
            </div>
            {template.defaults && (
              <div className="flex flex-wrap gap-1">
                {template.defaults.bpm && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-panel border border-edge text-inkMuted">
                    {template.defaults.bpm} BPM
                  </span>
                )}
                {template.defaults.key && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-panel border border-edge text-inkMuted">
                    {template.defaults.key} {template.defaults.scale ?? ""}
                  </span>
                )}
              </div>
            )}
            <div className="text-[9px] text-inkMuted mt-2">
              {template.slots.length} section{template.slots.length !== 1 ? "s" : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}