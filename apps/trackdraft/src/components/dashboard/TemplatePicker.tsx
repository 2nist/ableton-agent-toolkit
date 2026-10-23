import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { GENRE_CATALOG } from "../../data/genre-catalog";
import { SONG_MAPS } from "../../data/songMaps";
import type { SongMap } from "../../data/songMaps";
import { applySongMap } from "../../lib/sections";
import { ArcSparkline } from "../structure/mapPreview";

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
    // Apply the map immediately — the card copy promises "section slots and
    // genre defaults", and applySongMap is what actually delivers them:
    // slots (progressions/groove/harmony rhythm) plus defaults (bpm/key/
    // scale/concept, and for engine-family maps the Groove DNA `genre`).
    // Before this, create wrote the four defaults only and left sections
    // empty, so users had to re-pick the same template in Structure's map
    // picker to get the slots the card advertised.
    // …including the arc. The archetypes' whole identity is their shape, so a
    // card that builds their sections without it would deliver a different
    // song from the one it drew. Genre maps carry no arc, so this is a no-op
    // for them.
    useSongStore.getState().updateCurrentSong((s) =>
      applySongMap(s, template, { seedNarrative: template.slots.some((slot) => slot.narrative) }),
    );
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
            {template.slots.some((slot) => slot.narrative) && (
              <div className="-mx-0.5 mb-1.5">
                <ArcSparkline slots={template.slots} />
              </div>
            )}
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
                {template.defaults.genre && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent"
                    title="Engine genre — Groove DNA family lean drives the drum engine"
                  >
                    🎛 {template.defaults.genre}
                  </span>
                )}
              </div>
            )}
            {template.variants && template.variants.length > 0 && (
              <div className="text-[9px] text-inkMuted mt-1">
                {template.variants.length} alternate form{template.variants.length !== 1 ? "s" : ""}
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