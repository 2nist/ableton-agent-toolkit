import { useSongStore } from "../../store/songStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import { useFocusedSectionStore } from "../../store/focusedSectionStore";
import { updateSection } from "../../lib/sections";
import { countBlockSyllables } from "../../lib/lyrics/syllables";
import MicroLabel from "../common/MicroLabel";
import TapeLabel from "../common/TapeLabel";
import LyricsEditor from "./LyricsEditor";
import LyricDocumentView from "./LyricDocumentView";

export default function LyricsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useFocusedSectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useFocusedSectionStore((s) => s.setSelectedSectionId);
  const mode = useLyricsSelectionStore((s) => s.mode);
  const setMode = useLyricsSelectionStore((s) => s.setMode);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;
  const lyricLines = countBlockSyllables(activeSection?.lyrics ?? "");

  if (song.sections.length === 0) {
    return (
      <div className="p-4 text-inkMuted text-sm">
        Add sections on the spine above first, then write lyrics here.
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-3 p-4">
      {/* The station bar, in the same grammar as the Harmony page's: a tape
          label, the mode as a segmented control, and a hint that says what
          that mode is for. Below it the section strip scrolls on its own, so
          thirteen sections never squeeze the control onto a second line. */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-edge bg-deep px-2 py-1 font-mono text-2xs">
        <TapeLabel
          size="md"
          className="text-2xs font-mono uppercase tracking-[0.14em] text-inkMuted"
        >
          Lyrics
        </TapeLabel>
        <div className="flex overflow-hidden rounded border border-edge">
          {(
            [
              ["per-section", "Per-section", "one section at a time · the gutter counts each line's syllables"],
              ["song-text", "Song text", "the whole song as one document · touch a block to focus its section"],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              title={hint}
              onClick={() => setMode(id)}
              className={`whitespace-nowrap border-r border-edge px-2 py-0.5 text-3xs uppercase tracking-[0.08em] last:border-r-0 ${
                mode === id ? "bg-accent text-accentInk" : "text-inkMuted hover:bg-panelAlt hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden truncate text-3xs text-inkMuted/60 sm:inline">
          {mode === "per-section"
            ? "one section at a time · the gutter counts each line's syllables"
            : "the whole song as one document · touch a block to focus its section"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <MicroLabel>Sections</MicroLabel>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
          {song.sections.map((section) => (
            <button
              key={section.id}
              className={`hand-value shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-xs ${
                activeSection?.id === section.id
                  ? "nav-on border-accent text-accent"
                  : "border-edge text-inkMuted hover:text-ink"
              }`}
              title={`${section.name} — ${section.lyrics?.trim() ? "has lyrics" : "no lyrics yet"}`}
              onClick={() => setSelectedSectionId(section.id)}
            >
              {section.name}
            </button>
          ))}
        </div>
      </div>

      {mode === "song-text" && <LyricDocumentView song={song} onChange={updateCurrentSong} />}

      {mode === "per-section" && activeSection && (
        <div className="overflow-hidden rounded border border-edge bg-panel">
          <header className="flex items-center gap-2 border-b border-edge/70 px-2 py-1">
            <TapeLabel size="md" className="text-2xs font-mono uppercase tracking-widest text-inkMuted">
              {activeSection.name}
            </TapeLabel>
            <span className="font-mono text-3xs tabular-nums text-inkMuted/60">
              {lyricLines.filter((line) => line.line.trim()).length} lines ·{" "}
              {lyricLines.reduce((sum, line) => sum + (line.line.trim() ? line.syllables : 0), 0)} syl
            </span>
            <span className="ml-auto font-mono text-3xs text-inkMuted/50">
              {activeSection.lyrics?.trim() ? "one line = one phrase" : "no lyrics yet"}
            </span>
          </header>
          <div className="p-2">
            <LyricsEditor
              value={activeSection.lyrics ?? ""}
              onChange={(lyrics) =>
                updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, lyrics })))
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
