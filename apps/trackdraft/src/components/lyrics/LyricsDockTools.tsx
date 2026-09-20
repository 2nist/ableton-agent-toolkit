import { useSongStore } from "../../store/songStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import { updateSection } from "../../lib/sections";
import LyricsBriefPanel from "./LyricsBriefPanel";
import MetricalTable from "./MetricalTable";
import RhymeSuggestions from "./RhymeSuggestions";
import WritingContext from "./WritingContext";

/** The Lyrics tab's dock content in per-section mode — registered once by
 *  LyricsView, self-sufficient like HarmonyDockTools/SongInfoPanel (reads
 *  useSongStore + the shared lyricsSelectionStore directly). Formerly a
 *  fixed 280px right sidebar next to the editor; moving it into the dock
 *  frees the editor to use the full width. Song-text mode has no active
 *  section to scope these to, so LyricsView simply doesn't register this
 *  content there — it falls back to the dock's Info panel instead.
 *
 *  LyricsBriefPanel sits with the other writing tools: the section brief,
 *  side-specific nudge, and pronunciation-backed line scan. */
export default function LyricsDockTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useLyricsSelectionStore((s) => s.selectedSectionId);

  if (!currentSong) return null;
  const song = currentSong;
  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;
  if (!activeSection) return null;

  const vocabulary = Array.from(
    new Set(
      song.sections
        .flatMap((s) => (s.lyrics ?? "").split(/\s+/))
        .map((w) => w.replace(/[^a-zA-Z']/g, ""))
        .filter(Boolean),
    ),
  );

  return (
    <div className="p-2 flex gap-3 h-full overflow-x-auto">
      <div className="w-72 shrink-0 overflow-y-auto">
        <MetricalTable
          rows={activeSection.lyricsMetrical ?? []}
          onChange={(lyricsMetrical) =>
            updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyricsMetrical })))
          }
        />
      </div>
      <div className="w-56 shrink-0 overflow-y-auto">
        <WritingContext song={song} />
      </div>
      <div className="w-80 shrink-0 overflow-y-auto">
        <LyricsBriefPanel />
      </div>
      <div className="flex-1 min-w-[220px] overflow-y-auto">
        <RhymeSuggestions vocabulary={vocabulary} />
      </div>
    </div>
  );
}
