import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { downloadSongJson, readSongFile } from "../../lib/exportImport";
import CatalogBrowser from "./CatalogBrowser";

export default function Dashboard() {
  const songs = useSongStore((s) => s.songs);
  const createNewSong = useSongStore((s) => s.createNewSong);
  const importSong = useSongStore((s) => s.importSong);
  const deleteSong = useSongStore((s) => s.deleteSong);
  const currentSongId = useSongStore((s) => s.currentSongId);
  const navigate = useNavigate();

  const [newTitle, setNewTitle] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImportFile(file: File) {
    try {
      const song = await readSongFile(file);
      importSong(song);
      setImportError(null);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import file.");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">TrackDraft</h1>

      <div className="flex gap-2">
        <form
          className="flex gap-2 flex-1"
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
        <button
          className="border border-edge rounded px-4 py-2 text-sm text-inkMuted hover:text-ink hover:bg-panelAlt"
          onClick={() => fileInputRef.current?.click()}
        >
          Import JSON…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {importError && <p className="text-xs text-red-400">{importError}</p>}

      {import.meta.env.DEV && <CatalogBrowser />}

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
              className="text-xs text-inkMuted hover:text-ink px-2"
              onClick={() => downloadSongJson(song)}
            >
              Export
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
