import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { meanBeatsPerBar, sectionDurationBeats, type Chord } from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import TonicStrip from "./TonicStrip";
import { effectiveTonicRegions } from "../../lib/harmony/tonic";
import { resolveChordOccurrences } from "@drum/library";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { updateSection } from "../../lib/sections";
import { sectionSpans } from "../../lib/arrangement";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { useActiveChord } from "../../hooks/useActiveChord";
import HoneycombWheel from "./HoneycombWheel";
import ProgressionEditor from "./ProgressionEditor";
import HarmonyScene from "./HarmonyScene";
import FitStatus from "./FitStatus";
import ModeInferenceCard from "./ModeInferenceCard";
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
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const honeycombMode = useHarmonySelectionStore((s) => s.honeycombMode);
  const setHoneycombMode = useHarmonySelectionStore((s) => s.setHoneycombMode);
  const [tick, setTick] = useState<TransportTick | null>(null);

  // The canvas follows the transport: the chord under the playhead is
  // highlighted in every mode, so the view "moves with the timeline" while
  // the song plays instead of being a static map.
  useEffect(() => {
    const transport = getSongTransport();
    return transport.onTick(setTick);
  }, []);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);

  const song = currentSong;
  const activeSection = song?.sections.find((s) => s.id === selectedSectionId) ?? song?.sections[0] ?? null;

  useEffect(() => {
    setSelectedChordId(null);
  }, [activeSection?.id, setSelectedChordId]);

  // Lets the Studio tab's arrangement timeline deep-link into a specific
  // section (?section=<id>) — falls back to today's "first section"
  // default whenever the param is absent or stale (e.g. a section since
  // deleted), never overriding a manual section-chip click afterward
  // since this only re-runs when the URL's search params actually change.
  useEffect(() => {
    if (!song) return;
    const sectionParam = searchParams.get("section");
    if (sectionParam && song.sections.some((s) => s.id === sectionParam)) {
      setSelectedSectionId(sectionParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);
  const activeSpan = activeSection
    ? spans.find((span) => span.sectionId === activeSection.id) ?? null
    : null;
  const beatInSection = useMemo(() => {
    if (!tick || !activeSpan) return null;
    const beat = tick.beat - activeSpan.startBeat;
    if (beat < 0 || beat > activeSpan.durationBeats) return null;
    return beat;
  }, [tick, activeSpan]);
  const activeChordId = useActiveChord(
    activeSection,
    song,
    activeSpan?.durationBeats ?? 0,
    beatInSection,
  );

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
  const rawKey = activeSection?.key ?? song?.key ?? "C";
  const effectiveKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effectiveScale = activeSection?.scale ?? song?.scale ?? "ionian";

  /** The homes in force: what the author set, or what the key finder
   *  proposes for the progression as it actually plays. */
  const effectiveRegions = useMemo(() => {
    if (!activeSection) return [];
    const occurrences = resolveChordOccurrences(
      activeSection,
      sectionDurationBeats(activeSection),
    ).map((occurrence) => ({
      root: occurrence.chord.root,
      quality: occurrence.chord.quality,
      startTime: occurrence.startTime,
      duration: occurrence.duration,
    }));
    return effectiveTonicRegions(activeSection.tonicRegions, occurrences, {
      scale: effectiveScale,
      fallbackKey: effectiveKey,
    });
  }, [activeSection, effectiveKey, effectiveScale]);

  if (!song) return null;

  /** True when a meter outline (drums/Bend grid) decides chord timing, so the
   *  chords' own `beats` are not what plays — the rhythm strip goes read-only. */
  const chordsFollowOutline = !!(
    activeSection &&
    (activeSection.harmonyMeterOutline ??
      (activeSection.harmonyFollowsDrums === false ? null : activeSection.drumMeterOutline ?? null))
  );

  function updateChords(chords: Chord[]) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })));
  }

  /** Harmonic-rhythm edits write the chords' `beats` and the section's
   *  `beatsPerChord` default together. */
  function updateRhythm(chords: Chord[], beatsPerChord: number) {
    if (!activeSection) return;
    updateCurrentSong((s) =>
      updateSection(s, activeSection.id, (sec) => ({ ...sec, chords, beatsPerChord })),
    );
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
          Add sections on the spine above first, then build chord progressions here.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl space-y-3">
      {/* Hex canvas — full room to wander now that the preview controls,
         Linear/Loop toggle, and settings live in the dock's Tools panel.
         The progression-fit status lives in this workspace's bottom-right. */}
      <div className="relative border border-edge rounded-lg bg-scene overflow-hidden min-h-[420px] flex flex-col">
        {/* View-mode switcher ON the canvas: the same control lives in the
            dock's tools panel, but the inspector rail is narrow enough that a
            fourth button could wrap out of sight — the canvas is where you
            look, so the modes belong here too. */}
        <div className="absolute right-2 top-2 z-20 flex gap-1">
          {(["linear", "loop", "depth", "scene"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={honeycombMode === mode}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                honeycombMode === mode
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-edge/70 bg-well/80 text-inkMuted hover:text-ink"
              }`}
              onClick={() => setHoneycombMode(mode)}
              title={
                mode === "linear"
                  ? "One hex per chord"
                  : mode === "loop"
                    ? "Collapse repeating vamps onto one lap"
                    : mode === "depth"
                      ? "Depth (z = time): every step advances"
                      : "3D scene: degree × alteration × time"
              }
            >
              {mode === "linear" ? "Linear" : mode === "loop" ? "Loop" : mode === "depth" ? "Depth" : "3D"}
            </button>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center p-4 pt-6">
          {activeSection && honeycombMode === "scene" && (
            <HarmonyScene
              chords={activeSection.chords}
              keyName={effectiveKey}
              scale={effectiveScale}
              selectedChordId={selectedChordId}
              activeChordId={activeChordId}
              onSelectChord={setSelectedChordId}
              regions={activeSection.tonicRegions}
            />
          )}
          {activeSection && honeycombMode !== "scene" && (
            <HoneycombWheel
              keyName={effectiveKey}
              scale={effectiveScale}
              chords={activeSection.chords}
              beatsPerChord={activeSection.beatsPerChord}
              selectedChordId={selectedChordId}
              onSelectChord={setSelectedChordId}
              onChangeChords={updateChords}
              regions={effectiveRegions}
              colorFlavor={activeSection.colorFlavor}
              harmonyOutline={
                activeSection.harmonyMeterOutline ??
                (activeSection.harmonyFollowsDrums === false ? null : (activeSection.drumMeterOutline ?? null))
              }
              onPreviewChord={(chord) => void previewChord(chord)}
            />
          )}
        </div>
        {activeSection && (
          <div className="px-3 pt-1.5">
            <TonicStrip
              chords={activeSection.chords}
              regions={effectiveRegions}
              stored={activeSection.tonicRegions}
              keyName={effectiveKey}
              scale={effectiveScale}
              selectedChordId={selectedChordId}
              onChange={(regions) =>
                updateCurrentSong((s) =>
                  updateSection(s, activeSection.id, (sec) => ({ ...sec, tonicRegions: regions })),
                )
              }
            />
          </div>
        )}
        {/* The progression + effect lanes live IN the canvas now (layout
            grammar 2026-09-21: wide surfaces belong to the canvas, not a
            bottom menu — the old dock's Menu panel died here). */}
        {activeSection && (
          <div className="border-t border-edge/60 bg-deep px-3 py-2">
            <ProgressionEditor
              key={activeSection.id}
              chords={activeSection.chords}
              keyName={effectiveKey}
              scale={effectiveScale}
              beatsPerBar={meanBeatsPerBar(activeSection)}
              sectionBeats={sectionDurationBeats(activeSection)}
              selectedChordId={selectedChordId}
              activeChordId={activeChordId}
              outlineGoverned={chordsFollowOutline}
              regions={effectiveRegions}
              onSelectChord={setSelectedChordId}
              onChange={updateRhythm}
            />
          </div>
        )}
        {activeSection && (
          <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-edge/60 bg-deep">
            <FitStatus section={activeSection} onSetBars={setSectionBars} />
          </div>
        )}
      </div>

      {/* Borrowed-vs-modulate teaching moment — derived from the section's
          chords, anchored under the canvas, never blocks a chord add. */}
      {activeSection && (
        <ModeInferenceCard
          song={song}
          section={activeSection}
          keyName={effectiveKey}
          scale={effectiveScale}
          regions={effectiveRegions}
          onAdoptMode={(mode) =>
            updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, scale: mode })))
          }
          onKeepBorrowed={(ackKey) =>
            updateCurrentSong((s) => ({ ...s, blueprintAcks: { ...(s.blueprintAcks ?? {}), [ackKey]: true } }))
          }
        />
      )}
    </div>
  );
}
