import { useState } from "react";
import { NOTE_TO_PC } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { Chord, MeterOutline } from "../../types/blueprint";
import { buildEuclideanOutline, resolveChordOccurrences, twoThreeCellCounts, numerator as outlineNumerator } from "@drum/library";
import { chordHomes } from "../../lib/harmony/modeInference";
import { effectiveTonicRegions } from "../../lib/harmony/tonic";
import { EuclidSliders, StepView } from "../drums/euclidEditor";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { updateSection } from "../../lib/sections";
import { downloadSongMidi } from "../../lib/midiExport";
import { previewProgression } from "../../lib/playback/previewMidi";
import PresetPicker from "./PresetPicker";
import ChordEditorPopover from "./ChordEditorPopover";
import BassSettings from "./BassSettings";
import ColorSettings from "./ColorSettings";
import MeterMapPanel from "./MeterMapPanel";

/** Which rotation (if any) of `buildEuclideanOutline(n, d, k, r)` matches
 *  the outline's cells — so the Offset slider shows a real number rather
 *  than a guess after the outline was built from sliders. */
function inferRotation(outline: MeterOutline, n: number, k: number): number {
  if (!twoThreeCellCounts(n).includes(k)) return 0;
  const d = Math.round(4 / outline.cellBeats);
  for (let r = 0; r < k; r++) {
    const cells = buildEuclideanOutline(n, d, k, r).cells;
    if (cells.length === outline.cells.length && cells.every((c, i) => c === outline.cells[i])) return r;
  }
  return 0;
}

/** Shared "which section is the dock talking about, and in what key"
 *  resolution for the two Harmony dock panels. Each panel is registered
 *  once by HarmonyView and reads the shared stores directly (the same way
 *  `SongInfoPanel` reads `useSongStore`), so it re-renders on its own
 *  whenever the song or selection changes rather than HarmonyView having
 *  to push freshly-computed JSX into the dock on every change. */
function useHarmonyDockSection() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const song = currentSong;
  const activeSection = song?.sections.find((s) => s.id === selectedSectionId) ?? song?.sections[0] ?? null;

  let effectiveKey: NoteName | undefined;
  let effectiveScale: ScaleType | undefined;
  if (song && activeSection) {
    const rawKey = activeSection.key ?? song.key;
    effectiveKey = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
    effectiveScale = activeSection.scale ?? song.scale;
  }

  return { song, updateCurrentSong, activeSection, effectiveKey, effectiveScale };
}

/** Harmony's Tools panel — the right sidebar's tools for the active
 *  section: a header with the progression preview's play button;
 *  **Chords** — the selected chord's editor (selection/remove → Beats →
 *  Quality → Substitutions), the Rhythm control (how the progression
 *  advances: beats/euclid/follow-drums + Push), and the Preset picker;
 *  then the preview layer toggles + Linear/Loop, and Download MIDI. The
 *  derived voices (Bass/Color settings) live in the dock's **Layers**
 *  bottom tab (`HarmonyLayers`) so this sidebar stays uncluttered. Reads
 *  the shared selection store directly, so clicking a chord on the wheel
 *  swaps the chord under edit without re-registering anything. */
export function HarmonyTools() {
  const { song, updateCurrentSong, activeSection, effectiveKey, effectiveScale } = useHarmonyDockSection();
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);
  const honeycombMode = useHarmonySelectionStore((s) => s.honeycombMode);
  const setHoneycombMode = useHarmonySelectionStore((s) => s.setHoneycombMode);
  // Which layers the progression preview sends — chords always, bass and
  // color opt-in via the toggles (default on for a fuller sketch).
  const [previewLayers, setPreviewLayers] = useState<{ bass: boolean; color: boolean }>({
    bass: true,
    color: true,
  });
  if (!song || !activeSection || !effectiveKey || !effectiveScale) return null;

  function updateChords(chords: Chord[]) {
    updateCurrentSong((s) => updateSection(s, activeSection!.id, (sec) => ({ ...sec, chords })));
  }

  // Euclidean harmony — how the chord progression advances: per-chord beats
  // (default), on a `harmonyMeterOutline`'s onsets, or following the section's
  // drum meter (the drums literally drive the harmony).
  const rhythmMode: "beats" | "euclid" | "drums" = activeSection.harmonyMeterOutline
    ? "euclid"
    : activeSection.harmonyFollowsDrums === false
      ? "beats"
      : activeSection.harmonyFollowsDrums === true
        ? "drums"
        : activeSection.drumMeterOutline
          ? "drums" // following the drums is the default when a drum outline exists
          : "beats";
  const hOutline = activeSection.harmonyMeterOutline;
  const hDenom = hOutline ? Math.round(4 / hOutline.cellBeats) : 8;
  const hN = hOutline ? outlineNumerator(hOutline) : 7;
  const hK = hOutline ? hOutline.cells.length : (twoThreeCellCounts(hN)[0] ?? 3);
  const hRot = hOutline ? inferRotation(hOutline, hN, hK) : 0;

  function setRhythmMode(mode: "beats" | "euclid" | "drums") {
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => {
        if (mode === "beats") return { ...sec, harmonyMeterOutline: undefined, harmonyFollowsDrums: false };
        if (mode === "drums") return { ...sec, harmonyMeterOutline: undefined, harmonyFollowsDrums: true };
        return {
          ...sec,
          harmonyFollowsDrums: undefined,
          harmonyMeterOutline: sec.harmonyMeterOutline ?? buildEuclideanOutline(7, 8, twoThreeCellCounts(7)[0]!, 0),
        };
      }),
    );
  }

  function setHarmonyOutline(next: MeterOutline) {
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => ({ ...sec, harmonyMeterOutline: next, harmonyFollowsDrums: undefined })),
    );
  }

  function setSyncopation(value: number) {
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => ({
        ...sec,
        syncopationOffset: value > 0 ? Math.round(value * 100) / 100 : undefined,
      })),
    );
  }

  const editorChord = selectedChordId ? activeSection.chords.find((c) => c.id === selectedChordId) ?? null : null;

  /** The selected chord's own home, when the section modulates. Its editor
   *  offers substitutions relative to that home — the menu was built from the
   *  song key, so after a key change every suggestion was wrong. */
  const editorHome = (() => {
    if (!editorChord || !activeSection) return null;
    const regions = effectiveTonicRegions(
      activeSection.tonicRegions,
      resolveChordOccurrences(activeSection, Math.max(4, activeSection.bars * 4)).map((occurrence) => ({
        root: occurrence.chord.root,
        quality: occurrence.chord.quality,
        startTime: occurrence.startTime,
        duration: occurrence.duration,
      })),
      { scale: effectiveScale, fallbackKey: effectiveKey },
    );
    return chordHomes(activeSection.chords, regions, { key: effectiveKey, scale: effectiveScale }).get(editorChord.id) ?? null;
  })();

  return (
    <div className="flex flex-col">
      {/* Tools header — the progression preview's play button lives here,
          keeping the strip a single compact row. */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-edge shrink-0">
        <span className="text-[11px] font-mono uppercase tracking-wider text-inkMuted">Tools</span>
        <button
          className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-xs font-mono"
          onClick={() => {
            if (!activeSection) return;
            void previewProgression(
              activeSection.chords,
              song.bpm,
              activeSection.beatsPerChord,
              previewLayers,
              activeSection.colorFlavor,
            );
          }}
          disabled={!activeSection || activeSection.chords.length === 0}
          title="Audition this section's progression through the selected MIDI port — chords on its channel, plus bass and/or color if toggled"
        >
          ▶ Play
        </button>
      </div>

      {/* CHORDS — the authored progression (editing the selected chord),
          how it advances (Rhythm), and the template (Preset). */}
      <div className="px-2.5 pt-2 pb-1.5 border-b border-edge font-mono text-3xs uppercase tracking-wider text-inkMuted/70">
        Chords
      </div>

      {/* Selected chord's editor — selection/remove → Beats → Quality →
          Substitutions; performance lives in the effect row. */}
      {editorChord && (
        <div className="border-b border-edge">
          <ChordEditorPopover
            chord={editorChord}
            keyName={editorHome?.key ?? effectiveKey}
            scale={editorHome?.scale ?? effectiveScale}
            onChange={(updated) => updateChords(activeSection.chords.map((c) => (c.id === updated.id ? updated : c)))}
            onRemove={() => {
              updateChords(activeSection.chords.filter((c) => c.id !== editorChord.id));
              setSelectedChordId(null);
            }}
            onDeselect={() => setSelectedChordId(null)}
          />
        </div>
      )}

      {/* Meter — one meter, or a map of changes when the chart moves. */}
      {activeSection && (
        <MeterMapPanel
          section={activeSection}
          onChange={(map) =>
            updateCurrentSong((song) =>
              updateSection(song, activeSection.id, (section) => ({ ...section, meterMap: map })),
            )
          }
        />
      )}

      {/* Rhythm — how the chord progression advances across the section:
          per-chord beats, on a Euclidean outline (same engine as the drums),
          or following the section's drum meter. */}
      <div className="p-2.5 border-b border-edge">
        <span
          className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
          title="How the chord progression advances across the section — the export honors this everywhere (.mid, live out, Send to Ableton)"
        >
          Rhythm
        </span>
        <div className="flex gap-1 mb-2">
          {(["beats", "euclid", "drums"] as const).map((m) => (
            <button
              key={m}
              className={`flex-1 font-mono text-2xs rounded px-2 py-1 border ${
                rhythmMode === m ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => setRhythmMode(m)}
              title={
                m === "beats"
                  ? "Each chord holds its own beats, as authored"
                  : m === "euclid"
                    ? "Chords advance on a Euclidean outline's onsets — same engine as the drums"
                    : "Chord changes follow this section's drum meter — the drums drive the harmony"
              }
            >
              {m === "euclid" ? "euclid" : m === "drums" ? "follow drums" : "beats"}
            </button>
          ))}
        </div>

        {/* Push — the global anticipation offset, orthogonal to how the
            chords advance: every chord change lands this many beats early. */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="font-mono text-2xs uppercase tracking-wider text-inkMuted"
            title="Anticipation — push every chord change this many beats early (a jazz push). The wheel/UI stay on the clean grid; only the exported onsets shift."
          >
            Push
          </span>
          <div className="flex items-center gap-1">
            <button
              className="font-mono text-2xs rounded px-1.5 py-0.5 border border-edge text-inkMuted hover:text-ink"
              onClick={() => setSyncopation((activeSection.syncopationOffset ?? 0) - 0.25)}
            >
              −
            </button>
            <span className="font-mono text-2xs tabular-nums text-ink w-10 text-center">
              {Math.round(((activeSection.syncopationOffset ?? 0) / 0.25) * 4) / 4}/16
            </span>
            <button
              className="font-mono text-2xs rounded px-1.5 py-0.5 border border-edge text-inkMuted hover:text-ink"
              onClick={() => setSyncopation((activeSection.syncopationOffset ?? 0) + 0.25)}
            >
              +
            </button>
          </div>
        </div>

        {rhythmMode === "euclid" && hOutline && (
          <div className="space-y-1.5">
            <StepView outline={hOutline} />
            <p className="font-mono text-2xs text-inkMuted">
              {hK} / {hN} · rot {hRot} · {hOutline.label}
            </p>
            <EuclidSliders
              n={hN}
              denom={hDenom}
              k={hK}
              rotation={hRot}
              onChange={(nv, kv, rv) => setHarmonyOutline(buildEuclideanOutline(nv, hDenom, kv, rv))}
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Grid</span>
              <div className="flex gap-1">
                {[8, 16].map((d) => (
                  <button
                    key={d}
                    className={`font-mono text-2xs rounded px-1.5 py-0.5 border ${
                      hDenom === d ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
                    }`}
                    onClick={() => setHarmonyOutline({ ...hOutline, cellBeats: 4 / d })}
                  >
                    /{d}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-2xs text-inkMuted/70">
              Chord changes land on each 2s/3s cell's start — set the same outline on the drums to lock them together.
            </p>
          </div>
        )}

        {rhythmMode === "drums" && (
          <p className="text-2xs text-inkMuted/70">
            {activeSection.drumMeterOutline
              ? `Chord changes follow the drum meter (${activeSection.drumMeterOutline.label}).`
              : "This section has no drum outline yet — set one in the Drums tab (Euclid mode), or pick euclid here to author one."}
          </p>
        )}
      </div>

      {/* Preset — the progression template, tucked under the Color flavor
          (it's tall enough to dominate the menu when it sits at the top). */}
      <div className="p-2.5 border-b border-edge">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Preset</span>
        <PresetPicker
          keyName={effectiveKey}
          beatsPerChord={activeSection.beatsPerChord}
          hasChords={activeSection.chords.length > 0}
          sectionName={activeSection.name}
          onApply={updateChords}
        />
      </div>

      {/* Preview layers + honeycomb view mode — wraps, because four modes plus
          the two layer toggles overflowed the rail and pushed "3D" off-screen. */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 border-b border-edge">
        {(["bass", "color"] as const).map((layer) => (
          <button
            key={layer}
            aria-pressed={previewLayers[layer]}
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              previewLayers[layer]
                ? "border-accent text-accent bg-accent/10"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            title={`Send this layer on the progression preview — bass ch.2, color ch.4`}
            onClick={() => setPreviewLayers((s) => ({ ...s, [layer]: !s[layer] }))}
          >
            {layer}
          </button>
        ))}
        <span className="w-px h-4 bg-edge mx-1" />
        {(["linear", "loop", "depth", "scene"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={honeycombMode === mode}
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              honeycombMode === mode
                ? "border-accent text-accent bg-accent/10"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            title={
              mode === "linear"
                ? "One hex per chord (only immediate back-and-forth reuses a hex)"
                : mode === "loop"
                  ? "Collapse repeating vamps onto a single lap"
                  : mode === "depth"
                    ? "Depth (z = time): each chord steps back in depth, so repeats, runs and modulations all advance in one direction"
                    : "3D scene: degree × alteration × time — drag to orbit, wheel to zoom, shift-drag to pan"
            }
            onClick={() => setHoneycombMode(mode)}
          >
            {mode === "linear" ? "Linear" : mode === "loop" ? "Loop" : mode === "depth" ? "Depth" : "3D"}
          </button>
        ))}
      </div>

      {/* Download MIDI */}
      <div className="p-2.5">
        <button
          onClick={() => downloadSongMidi(song)}
          className="w-full border border-accent/50 text-accent rounded px-3 py-1.5 text-xs hover:bg-accent/10 font-medium"
          title="Export as Standard MIDI File — Chords, Bass, Drums, and Color tracks; drag into Ableton, Logic, or any DAW"
        >
          ⬇ Download MIDI
        </button>
      </div>
    </div>
  );
}

/** The dock's Layers panel — the derived voices generated from the
 *  progression (Bass + Color settings), given their own bottom-dock tab so
 *  the right-side Tools sidebar stays uncluttered. Reads the shared
 *  selection store directly like the other Harmony dock panels, so it
 *  re-renders whenever the active section changes. */
export function HarmonyLayers() {
  const { activeSection, updateCurrentSong } = useHarmonyDockSection();
  if (!activeSection) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2">
      <div className="p-3 sm:border-r sm:border-edge sm:pr-6">
        <BassSettings
          section={activeSection}
          onChange={(updater) => updateCurrentSong((s) => updateSection(s, activeSection.id, updater))}
        />
      </div>
      <div className="p-3">
        <ColorSettings
          section={activeSection}
          onChange={(updater) => updateCurrentSong((s) => updateSection(s, activeSection.id, updater))}
        />
      </div>
    </div>
  );
}