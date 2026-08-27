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
import FitStatus from "./FitStatus";
import { HarmonyMainMenu, HarmonyTools } from "./HarmonyDockTools";
import { previewChord } from "../../lib/playback/previewMidi";

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
  const setPrimary = useDockStore((s) => s.setPrimary);
  const setTools = useDockStore((s) => s.setTools);

  // The dock's panels are registered once and read the shared selection
  // store directly — they re-render themselves on selection/song changes,
  // so this effect never needs to re-run (and never risks the update-loop
  // a content-recomputing effect here would create). The main menu is the
  // dock's primary panel; Tools holds the settings toolbox (MIDI/color/key,
  // the progression preview, the Linear/Loop toggle, and the chord editor).
  useEffect(() => {
    setPrimary(<HarmonyMainMenu />);
    setTools(<HarmonyTools />);
    return () => {
      setPrimary(null);
      setTools(null);
    };
  }, [setPrimary, setTools]);

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

  // Snap the section's `bars` to one clean pass of its progression — wired
  // to the fit status in the hex workspace's bottom-right corner.
  function setSectionBars(bars: number) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, bars })));
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
      {/* Hex canvas — full room to wander now that the preview controls,
         Linear/Loop toggle, and settings live in the dock's Tools panel.
         The progression-fit status lives in this workspace's bottom-right. */}
      <div className="border border-edge rounded-lg bg-[#0e1218] overflow-hidden min-h-[420px] flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4 pt-6">
          {activeSection && (
            <HoneycombWheel
              keyName={effectiveKey}
              scale={effectiveScale}
              chords={activeSection.chords}
              beatsPerChord={activeSection.beatsPerChord}
              selectedChordId={selectedChordId}
              onSelectChord={setSelectedChordId}
              onChangeChords={updateChords}
              colorFlavor={activeSection.colorFlavor}
              harmonyOutline={
                activeSection.harmonyMeterOutline ??
                (activeSection.harmonyFollowsDrums ? (activeSection.drumMeterOutline ?? null) : null)
              }
              onPreviewChord={(chord) => void previewChord(chord)}
            />
          )}
        </div>
        {activeSection && (
          <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-edge/60 bg-[#0a0d12]">
            <FitStatus section={activeSection} onSetBars={setSectionBars} />
          </div>
        )}
      </div>
    </div>
  );
}
