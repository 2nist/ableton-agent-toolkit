import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { SONG_MAPS, type SongMap } from "../../data/songMaps";
import { GENRE_CATALOG } from "../../data/genre-catalog/index";
import { applySongMap } from "../../lib/sections";
import { STYLE_RECIPES } from "../../lib/style/bend";
import { askConfirm } from "../../lib/confirm";

/**
 * The Library — a VIEW now (user decision 2026-09-21: "make the library a
 * view and we can have a narrower tool bar"). The left rail carries only
 * the views list; the browser (songs · maps · recipes) lives here in the
 * center canvas with room to describe what each source actually does.
 *
 * Maps and recipes still act on the OPEN song — the context line names it
 * (maps replace its sections, confirmed + one undo step; recipes seed the
 * mix tint, the ◉ facet shows the result). Picking a song opens its
 * section workspace — the flagship view to start working in.
 */
export default function LibraryView() {
  const songs = useSongStore((s) => s.songs);
  const currentId = useSongStore((s) => s.currentSongId);
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const navigate = useNavigate();
  const [tab, setTab] = useState<"songs" | "maps" | "recipes">("songs");

  async function applyMap(map: SongMap) {
    if (!(await askConfirm({ title: "Replace sections", message: `Replace "${currentSong?.title}"'s sections with the "${map.name}" map?`, confirmLabel: "Replace", danger: true }))) return;
    updateCurrentSong((s) => applySongMap(s, map));
  }

  function applyRecipe(name: string) {
    const recipe = STYLE_RECIPES[name];
    if (!recipe) return;
    const { tempo, ...axes } = recipe;
    updateCurrentSong((s) => ({ ...s, genre: name, bend: axes, bpm: tempo }));
  }

  return (
    <div className="p-4 max-w-4xl">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-sm font-medium text-ink">Library</h1>
        <span className="text-[10px] font-mono text-inkMuted/60 truncate">
          maps &amp; recipes act on “{currentSong?.title}” · undoable
        </span>
        <span className="flex-1" />
        <div className="flex gap-0.5">
          {(["songs", "maps", "recipes"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`text-3xs font-mono uppercase tracking-wider px-2 py-1 rounded ${
                tab === t ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink"
              }`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "songs" && (
        <div className="mt-3 space-y-1">
          {songs.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`w-full text-left px-2.5 py-1.5 rounded border ${
                s.id === currentId ? "border-accent/50 bg-panelAlt" : "border-transparent hover:bg-panelAlt/60"
              }`}
              onClick={() => navigate(`/song/${s.id}/workbench`)}
              title={`Open "${s.title}" — section workspace`}
            >
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-ink truncate">{s.title}</span>
                {s.id === currentId && <span className="text-[9px] font-mono text-accent shrink-0">open</span>}
                <span className="flex-1" />
                <span className="text-3xs font-mono text-inkMuted/60 tabular-nums shrink-0">
                  {s.key} {s.scale} · {s.bpm} BPM · {s.sections.length} sections
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === "maps" && (
        <div className="mt-3 space-y-4">
          {([
            ["Narrative maps", SONG_MAPS],
            ["Genre maps", GENRE_CATALOG],
          ] as const).map(([label, maps]) => (
            <div key={label}>
              <p className="text-3xs font-mono uppercase tracking-widest text-inkMuted/60">{label}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {maps.map((m) => (
                  <div key={m.id} className="border border-edge rounded bg-panel p-2 flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-ink truncate">{m.name}</span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        className="text-[10px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5 shrink-0"
                        onClick={() => applyMap(m)}
                        title={`Replace "${currentSong?.title}"'s sections with this map (undoable)`}
                      >
                        apply
                      </button>
                    </div>
                    <p className="text-[10px] text-inkMuted/70 leading-snug">{m.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "recipes" && (
        <div className="mt-3">
          <p className="text-3xs font-mono uppercase tracking-widest text-inkMuted/60">Genre recipes · the mix tint</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {Object.keys(STYLE_RECIPES).map((name) => {
              const recipe = STYLE_RECIPES[name];
              return (
                <div key={name} className="border border-edge rounded bg-panel px-2 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-ink capitalize truncate">{name}</span>
                  <span className="text-3xs font-mono text-inkMuted/60 tabular-nums shrink-0">{recipe.tempo} BPM</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className="text-[10px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5 shrink-0"
                    onClick={() => applyRecipe(name)}
                    title={`Set genre "${name}" — seeds the Mix / Bend sliders and the tempo`}
                  >
                    apply
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
