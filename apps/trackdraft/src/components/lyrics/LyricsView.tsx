import { useState } from "react";
import { useSongStore } from "../../store/songStore";
import { updateSection } from "../../lib/sections";
import LyricsEditor from "./LyricsEditor";
import MetricalTable from "./MetricalTable";
import RhymeSuggestions from "./RhymeSuggestions";
import WritingContext from "./WritingContext";
import LyricDocumentView from "./LyricDocumentView";

type ViewMode = "per-section" | "song-text";

export default function LyricsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("per-section");

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  const vocabulary = Array.from(
    new Set(
      song.sections
        .flatMap((s) => (s.lyrics ?? "").split(/\s+/))
        .map((w) => w.replace(/[^a-zA-Z']/g, ""))
        .filter(Boolean),
    ),
  );

  if (song.sections.length === 0) {
    return (
      <div className="p-6 text-inkMuted text-sm">
        Add sections in the Structure tab first, then come back here to write lyrics.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
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
        <div className="grid grid-cols-[1fr_280px] gap-4">
          <div className="space-y-4">
            <LyricsEditor
              value={activeSection.lyrics ?? ""}
              onChange={(lyrics) =>
                updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyrics })))
              }
            />
            <MetricalTable
              rows={activeSection.lyricsMetrical ?? []}
              onChange={(lyricsMetrical) =>
                updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyricsMetrical })))
              }
            />
          </div>
          <div className="space-y-4">
            <WritingContext song={song} />
            <RhymeSuggestions vocabulary={vocabulary} />
          </div>
        </div>
      )}
    </div>
  );
}
