import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { readSongFile, downloadLibraryBackup, readLibraryBackupFile } from "../../lib/exportImport";
import { extractVideoId } from "../../lib/youtube";
import { assembleBlueprint } from "../../lib/youtubeFullImport";
import type { ChordMiniAppResult, LrclibData } from "../../lib/youtubeFullImport";
import { syncLibraryToFolder } from "../../lib/exportImport";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ProgressStep = { step: string; message: string } | null;

export default function ActionBar() {
  const createNewSong = useSongStore((s) => s.createNewSong);
  const importSong = useSongStore((s) => s.importSong);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [newTitle, setNewTitle] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStep, setProgressStep] = useState<ProgressStep>(null);

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

  /** Restores a whole-library backup (or a bare array of songs). Import is
   *  upsert-by-id, so restoring a backup never duplicates existing songs. */
  async function handleRestoreBackup(file: File) {
    try {
      const songs = await readLibraryBackupFile(file);
      for (const song of songs) importSong(song);
      setImportError(null);
      alert(`Restored ${songs.length} song(s).`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to restore backup.");
    }
  }

  /** One-click YouTube full import: download → ChordMiniApp → LRCLIB → assemble */
  async function handleYoutubeFullImport() {
    const input = youtubeUrl.trim();
    if (!input) return;

    const videoId = extractVideoId(input);
    if (!videoId) {
      setImportError("Not a valid YouTube URL or video ID.");
      return;
    }

    setYoutubeLoading(true);
    setImportError(null);
    setProgressStep({ step: "start", message: "Starting…" });

    try {
      const res = await fetch("/__youtube-full-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }

      // Read SSE stream for progress updates
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let resultData: {
        title?: string;
        artist?: string;
        chordMiniData?: ChordMiniAppResult;
        lrclibData?: Record<string, unknown>;
      } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "progress") {
                setProgressStep({ step: data.step as string, message: data.message as string });
                if (data.step === "analyze") {
                  resultData.chordMiniData = data as unknown as ChordMiniAppResult;
                }
              } else if (currentEvent === "error") {
                throw new Error(data.error as string);
              } else if (currentEvent === "result") {
                resultData = { ...resultData, ...data };
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
            }
          }
        }
      }

      if (!resultData.title || !resultData.chordMiniData) {
        throw new Error("Import completed but returned no data");
      }

      const lrclib = resultData.lrclibData as LrclibData | undefined;
      const song = assembleBlueprint(
        resultData.chordMiniData,
        resultData.title,
        { lrclibData: lrclib, maxSections: 16, minSectionDuration: 8 },
      );

      importSong(song);
      setYoutubeUrl("");
      setProgressStep(null);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "YouTube import failed.");
      setProgressStep(null);
    } finally {
      setYoutubeLoading(false);
    }
  }

  async function handleAudioAnalyze(file: File) {
    setAnalyzing(true);
    setImportError(null);
    try {
      const res = await fetch("/__chordmini-analyze", {
        method: "POST",
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const json = await res.json() as ChordMiniAppResult;
      if (!json.chords || json.chords.length === 0) {
        setImportError("ChordMiniApp returned no chords — the audio may be too quiet or silent.");
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const song = assembleBlueprint(json, title, { maxSections: 16, minSectionDuration: 8 });
      importSong(song);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Audio analysis failed.");
    } finally {
      setAnalyzing(false);
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
          <button
            className="border border-edge rounded px-3 py-1 text-xs text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => syncLibraryToFolder(useSongStore.getState().songs)}
            title="Export all songs to a directory as .blueprint.json files (overwrite by id, no deletion — for MCP server / external tool consumption)"
          >
            Sync library to folder
          </button>
          <button
            className="border border-edge rounded px-3 py-1 text-xs text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => downloadLibraryBackup(useSongStore.getState().songs)}
            title="Download the entire library as one JSON backup (restorable below) — the safety net for localStorage"
          >
            Backup all songs
          </button>
          <button
            className="border border-edge rounded px-3 py-1 text-xs text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => backupInputRef.current?.click()}
            title="Restore a library backup or a bare array of song files (upsert by song id)"
          >
            Restore backup
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRestoreBackup(file);
              e.target.value = "";
            }}
          />
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

      {/* Row 2: YouTube one-click full import */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
          placeholder="YouTube URL or video ID…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleYoutubeFullImport()}
        />
        <button
          className="border border-accent text-accent rounded px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-40 font-medium"
          onClick={handleYoutubeFullImport}
          disabled={youtubeLoading || !youtubeUrl.trim()}
        >
          {youtubeLoading ? "…" : "▶ One-Click Import"}
        </button>
      </div>

      {/* Progress indicator */}
      {progressStep && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-emerald-400 font-mono">
            {progressStep.step === "start" && "⬇ Starting…"}
            {progressStep.step === "metadata" && "🔍 " + progressStep.message}
            {progressStep.step === "download" && "⬇ " + progressStep.message}
            {progressStep.step === "analyze" && "🎵 " + progressStep.message}
            {progressStep.step === "lyrics" && "📝 " + progressStep.message}
            {progressStep.step === "assemble" && "📦 " + progressStep.message}
          </span>
        </div>
      )}

      {/* Row 3: ChordMiniApp audio analysis (standalone file picker) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-inkMuted/60 flex-1">
          {analyzing ? "Analyzing audio with ChordMiniApp…" : "Analyze audio file (chords + key + BPM + structure)"}
        </span>
        <button
          className="border border-purple-400/50 text-purple-300 rounded px-3 py-1 text-xs hover:bg-purple-400/10 disabled:opacity-40"
          onClick={() => audioInputRef.current?.click()}
          disabled={analyzing}
        >
          {analyzing ? "Analyzing…" : "🎵 Analyze Audio"}
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.aif,.aiff,.flac,.ogg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAudioAnalyze(file);
            e.target.value = "";
          }}
        />
      </div>

      {importError && <p className="text-[10px] text-red-400">{importError}</p>}
    </div>
  );
}