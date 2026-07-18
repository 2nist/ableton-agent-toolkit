import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";

export default function Dashboard() {
  const songs = useSongStore((s) => s.songs);
  const createNewSong = useSongStore((s) => s.createNewSong);
  const deleteSong = useSongStore((s) => s.deleteSong);
  const currentSongId = useSongStore((s) => s.currentSongId);
  const navigate = useNavigate();

  const [newTitle, setNewTitle] = useState("");

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">TrackDraft</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          const song = createNewSong(title);
          setNewTitle("");
          navigate(`/song/${song.id}`);
        }}
      >
        <input
          className="flex-1 bg-panel border border-edge rounded px-3 py-2 text-sm"
          placeholder="New song title…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button
          type="submit"
          className="bg-accent text-black font-medium px-4 py-2 rounded text-sm"
        >
          Create
        </button>
      </form>

      <ul className="divide-y divide-edge border border-edge rounded">
        {songs.length === 0 && (
          <li className="p-4 text-inkMuted text-sm">No songs yet.</li>
        )}
        {songs.map((song) => (
          <li
            key={song.id}
            className={`flex items-center justify-between p-3 ${
              song.id === currentSongId ? "bg-panelAlt" : "bg-panel"
            }`}
          >
            <button
              className="text-left flex-1"
              onClick={() => navigate(`/song/${song.id}`)}
            >
              <div className="font-medium">{song.title}</div>
              <div className="text-xs text-inkMuted">
                {song.key} {song.scale} · {song.bpm} BPM · {song.sections.length} sections
              </div>
            </button>
            <button
              className="text-xs text-inkMuted hover:text-red-400 px-2"
              onClick={() => deleteSong(song.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
