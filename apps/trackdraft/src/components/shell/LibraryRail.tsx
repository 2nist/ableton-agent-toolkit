import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { SONG_MAPS, type SongMap } from "../../data/songMaps";
import { GENRE_CATALOG } from "../../data/genre-catalog/index";
import { applySongMap } from "../../lib/sections";
import { STYLE_RECIPES } from "../../lib/style/bend";

/**
 * The Library — the LEFT zone of the layout grammar (docs/design/workspace.md
 * §2). Shell chrome on EVERY song route since slice C (2026-09-21): the
 * layout mounts it once, next to the spine and the inspector, so every view
 * carries the same three zones. An Ableton-style browser, closed until you
 * need it (w-9 strip ↔ w-56 panel); the open state lives here and, because
 * the layout stays mounted across tab changes, it persists while you move
 * around the song.
 *
 * Songs · Maps (narrative + genre) · Recipes. Picking a song KEEPS the tab
 * you're on (`/song/X/harmony` → `/song/Y/harmony`) — the library is a
 * browser of sources, not a navigator that resets your place. Maps mint a
 * section skeleton for the whole song (destructive — confirmed, undoable);
 * recipes set the mix tint in one click (the ◉ Mix/Bend facet shows the
 * result). Both act on the open song, wherever you are.
 */
export default function LibraryRail() {
  const songs = useSongStore((s) => s.songs);
  const currentId = useSongStore((s) => s.currentSongId);
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"songs" | "maps" | "recipes">("songs");

  /** Song switches stay on the current tab — the tab is the third path
   *  segment (`/song/<id>/<tab>`); the index route redirects to studio. */
  function pickSong(id: string) {
    const tabSegment = location.pathname.split("/")[3] || "studio";
    navigate(`/song/${id}/${tabSegment}`);
  }

  function applyMap(map: SongMap) {
    if (!window.confirm(`Replace this song's sections with the "${map.name}" map?`)) return;
    updateCurrentSong((s) => applySongMap(s, map));
  }

  function applyRecipe(name: string) {
    const recipe = STYLE_RECIPES[name];
    if (!recipe) return;
    const { tempo, ...axes } = recipe;
    updateCurrentSong((s) => ({ ...s, genre: name, bend: axes, bpm: tempo }));
  }

  return (
    <aside className={`shrink-0 border-r border-edge bg-panel flex flex-col min-h-0 ${open ? "w-56" : "w-9"}`} aria-label="Library">
      <button
        type="button"
        className="h-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink text-xs"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Close the library" : "Library — songs · maps · recipes (closed until you need it)"}
      >
        {open ? "◂" : "▸"}
      </button>
      {open ? (
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          {/* Tabs: Songs · Maps · Recipes */}
          <div className="flex gap-0.5 px-1.5 pt-0.5">
            {(["songs", "maps", "recipes"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`text-3xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  tab === t ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink"
                }`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "songs" && (
            <div className="px-2">
              <div className="mt-1 space-y-0.5">
                {songs.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`w-full text-left px-1.5 py-1 rounded ${
                      s.id === currentId ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink hover:bg-panelAlt/60"
                    }`}
                    onClick={() => pickSong(s.id)}
                    title={`Open "${s.title}" — stays on this tab`}
                  >
                    <span className="block text-xs truncate">{s.title}</span>
                    <span className="block text-3xs font-mono text-inkMuted/60 tabular-nums">
                      {s.key} {s.scale} · {s.bpm} BPM
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "maps" && (
            <div className="px-2 mt-1 space-y-3">
              {([
                ["Narrative maps", SONG_MAPS],
                ["Genre maps", GENRE_CATALOG],
              ] as const).map(([label, maps]) => (
                <div key={label}>
                  <p className="text-3xs font-mono uppercase tracking-widest text-inkMuted px-1">{label}</p>
                  <div className="mt-1 space-y-0.5">
                    {maps.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="w-full text-left px-1.5 py-1 rounded text-inkMuted hover:text-ink hover:bg-panelAlt/60"
                        onClick={() => applyMap(m)}
                        title={`${m.description} — replaces the current sections (undoable)`}
                      >
                        <span className="block text-xs truncate">{m.name}</span>
                        <span className="block text-3xs font-mono text-inkMuted/50 truncate">{m.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[9px] font-mono text-inkMuted/40 px-1">applies to the whole song · replaces sections</p>
            </div>
          )}

          {tab === "recipes" && (
            <div className="px-2 mt-1">
              <p className="text-3xs font-mono uppercase tracking-widest text-inkMuted px-1">Genre recipes · the mix tint</p>
              <div className="mt-1 space-y-0.5">
                {Object.keys(STYLE_RECIPES).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="w-full text-left px-1.5 py-1 rounded text-xs text-inkMuted hover:text-ink hover:bg-panelAlt/60 truncate"
                    onClick={() => applyRecipe(name)}
                    title={`Set genre "${name}" — seeds the Mix / Bend sliders and the tempo`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <span className="flex-1" />
      )}
    </aside>
  );
}
