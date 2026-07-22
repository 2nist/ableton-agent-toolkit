import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { useDockStore } from "../../store/dockStore";
import { updateSection } from "../../lib/sections";
import HoneycombWheel from "./HoneycombWheel";
import ProgressionTrack from "./ProgressionTrack";
import HarmonyDockTools from "./HarmonyDockTools";

/** The Harmony tab's canvas: the hex wheel and the linear progression
 *  track. Song/section settings (key, scale, presets) and the selected
 *  chord's editor live in the bottom dock now (`HarmonyDockTools`,
 *  registered once below) instead of a floating overlay + anchored
 *  popover — this view only owns section/chord *selection*, shared via
 *  `harmonySelectionStore` with the dock content that reacts to it. */
export default function HarmonyView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const [searchParams] = useSearchParams();
  const selectedSectionId = useHarmonySelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useHarmonySelectionStore((s) => s.setSelectedSectionId);
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);
  const setTools = useDockStore((s) => s.setTools);

  // The dock's tools panel is registered once and reads the shared
  // selection store directly — it re-renders itself on selection/song
  // changes, so this effect never needs to re-run (and never risks the
  // update-loop a content-recomputing effect here would create).
  useEffect(() => {
    setTools(<HarmonyDockTools />);
    return () => setTools(null);
  }, [setTools]);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  useEffect(() => {
    setSelectedChordId(null);
  }, [activeSection?.id, setSelectedChordId]);

  // Lets the Studio tab's arrangement timeline deep-link into a specific
  // section (?section=<id>) — falls back to today's "first section"
  // default whenever the param is absent or stale (e.g. a section since
  // deleted), never overriding a manual section-chip click afterward
  // since this only re-runs when the URL's search params actually change.
  useEffect(() => {
    const sectionParam = searchParams.get("section");
    if (sectionParam && song.sections.some((s) => s.id === sectionParam)) {
      setSelectedSectionId(sectionParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // A section can override the song's key/scale (modulation) — everything
  // downstream reads/writes against this effective value, never
  // song.key/song.scale directly, so a modulated section is edited correctly
  // without touching the song-wide default.
  //
  // Validated here rather than trusted, because this is the actual
  // boundary where malformed data (e.g. a pre-`parseImportedSong` song with
  // key="E major" still sitting in localStorage — `loadFromStorage()` never
  // re-validates) meets rendering. `pitchClass()` throws on anything not a
  // bare note name, which used to crash the whole tree here with no way to
  // reach the key selector to fix it. Falling back to "C" keeps the tab
  // usable so the bad value can be corrected through the dock instead.
  const rawKey = activeSection?.key ?? song.key;
  const effectiveKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effectiveScale = activeSection?.scale ?? song.scale;

  function updateChords(chords: Chord[]) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })));
  }

  function setSectionBars(bars: number) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, bars })));
  }

  function updateSingleChord(chordId: string, update: Partial<Chord>) {
    if (!activeSection) return;
    const next = activeSection.chords.map((c) => (c.id === chordId ? { ...c, ...update } : c));
    updateChords(next);
  }

  if (song.sections.length === 0) {
    return (
      <div className="p-4 max-w-5xl">
        <p className="text-inkMuted text-sm">
          Add sections in the Structure tab first, then come back here to build chord progressions.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl space-y-3">
      {/* Hex canvas — full room to wander now that song/section settings
         live in the dock instead of an overlay on top of it. */}
      <div className="border border-edge rounded-lg bg-[#0e1218] overflow-hidden min-h-[420px]">
        <div className="flex justify-center p-4 pt-6">
          {activeSection && (
            <HoneycombWheel
              keyName={effectiveKey}
              scale={effectiveScale}
              chords={activeSection.chords}
              beatsPerChord={activeSection.beatsPerChord}
              selectedChordId={selectedChordId}
              onSelectChord={setSelectedChordId}
              onChangeChords={updateChords}
            />
          )}
        </div>
      </div>

      {/* One framed panel: three aligned tracks — sections / progression / effects */}
      {activeSection && (
        <div className="border border-edge rounded-lg bg-panel overflow-hidden">
          <div className="grid grid-cols-[96px_1fr] items-stretch">
            <div className="flex flex-col items-end justify-center gap-0.5 px-3 border-r border-edge">
              <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted">Sections</span>
              <span className="font-mono text-[8.5px] text-inkMuted/70">{song.sections.length}</span>
            </div>
            <div className="px-3 py-2 overflow-x-auto">
              <div className="flex gap-1 flex-wrap">
                {song.sections.map((section) => (
                  <button
                    key={section.id}
                    className={`font-mono text-[11px] whitespace-nowrap rounded-[5px] border px-2.5 py-1 ${
                      activeSection.id === section.id
                        ? "border-accent text-accent bg-accent/10"
                        : "border-edge text-inkMuted hover:text-ink hover:border-inkMuted"
                    }`}
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    {section.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ProgressionTrack
            key={activeSection.id}
            section={activeSection}
            keyName={effectiveKey}
            scale={effectiveScale}
            bpm={song.bpm}
            selectedChordId={selectedChordId}
            onSelectChord={setSelectedChordId}
            onChangeChords={updateChords}
            onUpdateChord={updateSingleChord}
            onSetBars={setSectionBars}
          />
        </div>
      )}
    </div>
  );
}
