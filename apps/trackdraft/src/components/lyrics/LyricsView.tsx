import { useEffect, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import { useDockStore } from "../../store/dockStore";
import { updateSection } from "../../lib/sections";
import LyricsEditor from "./LyricsEditor";
import LyricDocumentView from "./LyricDocumentView";
import LyricsDockTools from "./LyricsDockTools";

type ViewMode = "per-section" | "song-text";

export default function LyricsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useLyricsSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useLyricsSelectionStore((s) => s.setSelectedSectionId);
  const setTools = useDockStore((s) => s.setTools);
  const [mode, setMode] = useState<ViewMode>("per-section");

  // MetricalTable/WritingContext/RhymeSuggestions (formerly a fixed 280px
  // sidebar) are scoped to one section, so they only make sense in
  // per-section mode — song-text mode has no single active section, and
  // simply doesn't register dock content, falling back to Info.
  useEffect(() => {
    setTools(mode === "per-section" ? <LyricsDockTools /> : null);
    return () => setTools(null);
  }, [mode, setTools]);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  if (song.sections.length === 0) {
    return (
      <div className="p-4 text-inkMuted text-sm">
        Add sections in the Structure tab first, then come back here to write lyrics.
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {song.sections.map((section) => (
            <button
              key={section.id}
              className={`text-sm px-3 py-1 rounded border ${
                activeSection?.id === section.id
                  ? "border-accent text-accent"
                  : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => setSelectedSectionId(section.id)}
            >
              {section.name}
            </button>
          ))}
        </div>
        <div className="flex gap-1 border border-edge rounded p-0.5">
          <button
            className={`text-xs px-2 py-1 rounded ${mode === "per-section" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
            onClick={() => setMode("per-section")}
          >
            Per-section
          </button>
          <button
            className={`text-xs px-2 py-1 rounded ${mode === "song-text" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
            onClick={() => setMode("song-text")}
            title="See the whole song's lyrics as one document and define or fix sections directly from the words"
          >
            Song text
          </button>
        </div>
      </div>

      {mode === "song-text" && <LyricDocumentView song={song} onChange={updateCurrentSong} />}

      {mode === "per-section" && activeSection && (
        <LyricsEditor
          value={activeSection.lyrics ?? ""}
          onChange={(lyrics) =>
            updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyrics })))
          }
        />
      )}
    </div>
  );
}
