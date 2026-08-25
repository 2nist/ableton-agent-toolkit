import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useSongStore } from "../../store/songStore";
import { useDockStore } from "../../store/dockStore";
import { classifySong } from "../../lib/classification";
import SongInfoPanel from "../details/SongInfoPanel";

const TABS = [
  { to: "studio", label: "Studio" },
  { to: "structure", label: "Structure" },
  { to: "harmony", label: "Harmony" },
  { to: "drums", label: "Drums" },
  { to: "lyrics", label: "Lyrics" },
];

export default function SongEditorLayout() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const openSong = useSongStore((s) => s.openSong);
  const canUndo = useSongStore((s) => s.canUndo());
  const canRedo = useSongStore((s) => s.canRedo());
  const undo = useSongStore((s) => s.undo);
  const redo = useSongStore((s) => s.redo);

  const setInfo = useDockStore((s) => s.setInfo);
  const dockInfo = useDockStore((s) => s.info);
  const dockTools = useDockStore((s) => s.tools);
  const activePanel = useDockStore((s) => s.activePanel);
  const setActivePanel = useDockStore((s) => s.setActivePanel);

  const song = songs.find((s) => s.id === songId);

  useEffect(() => {
    if (songId) openSong(songId);
  }, [songId, openSong]);

  // Song Info is registered once per song-editor mount and never cleared —
  // it's available on every tab, unlike `tools` which each tab owns.
  useEffect(() => {
    setInfo(<SongInfoPanel />);
  }, [setInfo]);

  if (!song) {
    return (
      <div className="p-4">
        <p className="text-inkMuted">Song not found.</p>
        <button className="text-accent text-sm mt-2" onClick={() => navigate("/")}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-edge px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button className="text-inkMuted text-sm hover:text-ink" onClick={() => navigate("/")}>
            ←
          </button>
          <h1 className="font-medium">{song.title}</h1>
          <span className="text-xs text-inkMuted">
            {song.key} {song.scale} · {song.bpm} BPM
            {song.sections.length > 0 && <> · {classifySong(song).label}</>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="px-2 py-1 rounded disabled:opacity-30 hover:bg-panelAlt"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            Undo
          </button>
          <button
            className="px-2 py-1 rounded disabled:opacity-30 hover:bg-panelAlt"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            Redo
          </button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-edge px-4 shrink-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-3 py-2 text-sm border-b-2 -mb-px ${
                isActive ? "border-accent text-ink" : "border-transparent text-inkMuted hover:text-ink"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* Main area: content + right sidebar (formerly bottom dock).
          The sidebar holds Info (song metadata) and Tools (per-tab
          key/scale/editor content), selectable via vertical tab row. */}
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 overflow-y-auto min-w-0">
          <Outlet />
        </main>

        <aside className="w-[272px] shrink-0 border-l border-edge flex flex-col bg-panel">
          <div className="flex gap-1 px-3 pt-2 border-b border-edge shrink-0">
            <button
              className={`text-xs px-2 py-1 border-b-2 -mb-px ${
                activePanel === "info" ? "border-accent text-ink" : "border-transparent text-inkMuted hover:text-ink"
              }`}
              onClick={() => setActivePanel("info")}
            >
              Info
            </button>
            {dockTools && (
              <button
                className={`text-xs px-2 py-1 border-b-2 -mb-px ${
                  activePanel === "tools" ? "border-accent text-ink" : "border-transparent text-inkMuted hover:text-ink"
                }`}
                onClick={() => setActivePanel("tools")}
              >
                Tools
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {activePanel === "tools" && dockTools ? dockTools : dockInfo}
          </div>
        </aside>
      </div>
    </div>
  );
}
