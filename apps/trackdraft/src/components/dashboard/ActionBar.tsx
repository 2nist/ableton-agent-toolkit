import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { readSongFile } from "../../lib/exportImport";
import { extractVideoId, fetchYoutubeMetadata, searchLrclib, buildYoutubeBlueprintSong } from "../../lib/youtube";

export default function ActionBar() {
  const createNewSong = useSongStore((s) => s.createNewSong);
  const importSong = useSongStore((s) => s.importSong);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newTitle, setNewTitle] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeLoading, setYoutubeLoading] = useState(false);

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

  async function handleYoutubeImport() {
    const input = youtubeUrl.trim();
    if (!input) return;

    const videoId = extractVideoId(input);
    if (!videoId) {
      setImportError("Not a valid YouTube URL or video ID.");
      return;
    }

    setYoutubeLoading(true);
    setImportError(null);

    try {
      // Fetch metadata from YouTube oEmbed (via Vite proxy)
      const metadata = await fetchYoutubeMetadata(videoId);
      if (!metadata) {
        setImportError("Could not fetch YouTube video metadata. Video may be unavailable.");
        setYoutubeLoading(false);
        return;
      }

      // Search LRCLIB for synced lyrics
      const lrclib = await searchLrclib(metadata.title, metadata.artist);

      // Build blueprint song
      const song = buildYoutubeBlueprintSong(metadata, lrclib);
      importSong(song);
      setYoutubeUrl("");
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import from YouTube.");
    } finally {
      setYoutubeLoading(false);
    }
  }

  return (
    <div className="px-3 py-2 border-b border-edge shrink-0 space-y-2">
      {/* Row 1: New song + Import JSON */}
      <div className="flex items-center gap-2">
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
            className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
            placeholder="New song title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button
            type="submit"
            className="bg-accent text-black font-medium px-3 py-1 rounded text-xs"
          >
            Create
          </button>
        </form>
        <button
          className="border border-edge rounded px-3 py-1 text-xs text-inkMuted hover:text-ink hover:bg-panelAlt"
          onClick={() => fileInputRef.current?.click()}
        >
          Import .json
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

      {/* Row 2: YouTube import */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
          placeholder="YouTube URL or video ID…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleYoutubeImport()}
        />
        <button
          className="border border-accent/50 text-accent rounded px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-40"
          onClick={handleYoutubeImport}
          disabled={youtubeLoading || !youtubeUrl.trim()}
        >
          {youtubeLoading ? "…" : "▶ YT Import"}
        </button>
      </div>

      {importError && <p className="text-[10px] text-red-400">{importError}</p>}
    </div>
  );
}