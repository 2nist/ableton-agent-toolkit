import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useSongStore } from "../../store/songStore";

const TABS = [
  { to: "details", label: "Details" },
  { to: "structure", label: "Structure" },
  { to: "harmony", label: "Harmony" },
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

  const song = songs.find((s) => s.id === songId);

  useEffect(() => {
    if (songId) openSong(songId);
  }, [songId, openSong]);

  if (!song) {
    return (
      <div className="p-6">
        <p className="text-inkMuted">Song not found.</p>
        <button className="text-accent text-sm mt-2" onClick={() => navigate("/")}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3">
          <button className="text-inkMuted text-sm hover:text-ink" onClick={() => navigate("/")}>
            ←
          </button>
          <h1 className="font-medium">{song.title}</h1>
          <span className="text-xs text-inkMuted">
            {song.key} {song.scale} · {song.bpm} BPM
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

      <nav className="flex gap-1 border-b border-edge px-4">
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

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
