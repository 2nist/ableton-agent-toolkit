import { useSongStore } from "../../store/songStore";
import { useFocusedSectionStore } from "../../store/focusedSectionStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import { updateSection } from "../../lib/sections";
import { countBlockSyllables } from "../../lib/lyrics/syllables";
import MicroLabel from "../common/MicroLabel";
import LyricsLookupPanel from "./LyricsLookupPanel";
import LyricsBriefPanel from "./LyricsBriefPanel";
import MetricalTable from "./MetricalTable";
import RhymeSuggestions from "./RhymeSuggestions";
import WritingContext from "./WritingContext";

/**
 * The Lyrics tab's dock content — registered once by the inspector rail,
 * self-sufficient like `HarmonyDockTools`/`SongInfoPanel` (it reads the song
 * and the shared selection directly).
 *
 * **Stacked, not side by side.** These four panels used to sit in one
 * horizontal row of fixed widths (288 + 224 + 320 + 220 = 1052px) inside a
 * 240px rail, so most of the tools were simply off-screen behind a
 * horizontal scrollbar. The rail is exactly as wide as this column: each
 * panel is now full-width and the rail's own vertical scroll carries them,
 * the way the Harmony dock stacks its two panels.
 *
 * The header exists because these tools all act on ONE section and nothing
 * said which — editing a metrical row while the editor showed a different
 * section was a silent way to fill in the wrong table.
 */
export default function LyricsDockTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useFocusedSectionStore((s) => s.selectedSectionId);
  const mode = useLyricsSelectionStore((s) => s.mode);

  if (!currentSong) return null;
  const song = currentSong;
  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;
  if (!activeSection) return null;

  const counted = countBlockSyllables(activeSection.lyrics ?? "");
  const spoken = counted.filter((line) => line.line.trim().length > 0);
  const syllables = spoken.reduce((sum, line) => sum + line.syllables, 0);

  const vocabulary = Array.from(
    new Set(
      song.sections
        .flatMap((s) => (s.lyrics ?? "").split(/\s+/))
        .map((w) => w.replace(/[^a-zA-Z']/g, ""))
        .filter(Boolean),
    ),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded border border-edge bg-panelAlt/40 px-1.5 py-1">
        <MicroLabel>Writing</MicroLabel>
        <span className="truncate text-2xs font-medium text-ink">{activeSection.name}</span>
        <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums text-inkMuted/70">
          {spoken.length} {spoken.length === 1 ? "line" : "lines"} · {syllables} syl
        </span>
        {mode === "song-text" && (
          <span className="w-full font-mono text-3xs italic text-inkMuted/60">
            song text mode — follows the block you last touched
          </span>
        )}
      </div>

      <LyricsLookupPanel />

      <MetricalTable
        rows={activeSection.lyricsMetrical ?? []}
        onChange={(lyricsMetrical) =>
          updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyricsMetrical })))
        }
      />
      <WritingContext song={song} />
      <LyricsBriefPanel />
      <RhymeSuggestions vocabulary={vocabulary} />
    </div>
  );
}
