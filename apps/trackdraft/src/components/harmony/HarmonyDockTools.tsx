import { useState } from "react";
import { NOTE_TO_PC } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { Chord, MeterOutline } from "../../types/blueprint";
import { buildEuclideanOutline, twoThreeCellCounts, numerator as outlineNumerator } from "@drum/library";
import { EuclidSliders, StepView } from "../drums/euclidEditor";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { updateSection } from "../../lib/sections";
import { downloadSongMidi } from "../../lib/midiExport";
import { previewProgression } from "../../lib/playback/previewMidi";
import { BI_TONAL_MATRIX, DEFAULT_COLOR_FLAVOR } from "@platform/progression-engine";
import PresetPicker from "./PresetPicker";
import ProgressionTrack from "./ProgressionTrack";
import ChordEditorPopover from "./ChordEditorPopover";

/** Every bi-tonal flavor in the engine's matrix, deduped to `[id, label]`
 *  — the options for the per-section Color Chord flavor picker. */
const COLOR_FLAVORS = Array.from(
  new Map(
    Object.values(BI_TONAL_MATRIX)
      .flatMap((family) => Object.entries(family))
      .map(([id, def]) => [id, def.label]),
  ),
);

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
  const selectedSectionId = useHarmonySelectionStore((s) => s.selectedSectionId);
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

/** Harmony's main menu — the dock's primary panel, always visible on the
 *  Harmony tab: the per-section working rows — section chips, the
 *  progression chord lane, and the effect lane. The settings toolbox (MIDI
 *  export, key/scale/presets, and the selected chord's editor) lives in
 *  `HarmonyTools` (the dock's Tools panel). */
export function HarmonyMainMenu() {
  const { song, updateCurrentSong, activeSection, effectiveKey, effectiveScale } = useHarmonyDockSection();
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);
  const setSelectedSectionId = useHarmonySelectionStore((s) => s.setSelectedSectionId);
  if (!song || !activeSection || !effectiveKey || !effectiveScale) return null;

  function updateChords(chords: Chord[]) {
    updateCurrentSong((s) => updateSection(s, activeSection!.id, (sec) => ({ ...sec, chords })));
  }

  function updateSingleChord(chordId: string, update: Partial<Chord>) {
    const next = activeSection.chords.map((c) => (c.id === chordId ? { ...c, ...update } : c));
    updateChords(next);
  }

  return (
    <div className="flex flex-col">
      {/* Section chips — the active section drives the progression/effect
          lanes below, the Tools panel, and the hex canvas above. */}
      <div className="grid grid-cols-[96px_1fr] items-stretch">
        <div className="flex flex-col items-end justify-center gap-0.5 px-3 border-r border-edge">
          <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted">Sections</span>
          <span className="font-mono text-[8.5px] text-inkMuted/70">{song.sections.length}</span>
        </div>
        <div className="px-2.5 py-1.5 overflow-x-auto">
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

      {/* Progression + effect lanes for the active section */}
      <ProgressionTrack
        key={activeSection.id}
        section={activeSection}
        keyName={effectiveKey}
        scale={effectiveScale}
        selectedChordId={selectedChordId}
        onSelectChord={setSelectedChordId}
        onChangeChords={updateChords}
        onUpdateChord={updateSingleChord}
      />
    </div>
  );
}

/** Harmony's Tools panel — the right sidebar's tools for the active
 *  section, top-to-bottom: a header with the progression preview's play
 *  button, the Preset picker, the selected chord's editor (selection/
 *  remove → Beats → Quality → Substitutions), the Color Chord flavor, the
 *  preview layer toggles + Linear/Loop, and Download MIDI. The song/section
 *  key selectors are gone — the song key lives in the header/Studio, and
 *  section key overrides felt redundant with editing chord roots directly.
 *  Reads the shared selection store directly, so clicking a chord on the
 *  wheel swaps the chord under edit without re-registering anything. */
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

  function setColorFlavor(flavor: string | undefined) {
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => ({ ...sec, colorFlavor: flavor })),
    );
  }

  // Euclidean harmony — how the chord progression advances: per-chord beats
  // (default), on a `harmonyMeterOutline`'s onsets, or following the section's
  // drum meter (the drums literally drive the harmony).
  const rhythmMode: "beats" | "euclid" | "drums" = activeSection.harmonyMeterOutline
    ? "euclid"
    : activeSection.harmonyFollowsDrums
      ? "drums"
      : "beats";
  const hOutline = activeSection.harmonyMeterOutline;
  const hDenom = hOutline ? Math.round(4 / hOutline.cellBeats) : 8;
  const hN = hOutline ? outlineNumerator(hOutline) : 7;
  const hK = hOutline ? hOutline.cells.length : (twoThreeCellCounts(hN)[0] ?? 3);
  const hRot = hOutline ? inferRotation(hOutline, hN, hK) : 0;

  function setRhythmMode(mode: "beats" | "euclid" | "drums") {
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => {
        if (mode === "beats") return { ...sec, harmonyMeterOutline: undefined, harmonyFollowsDrums: undefined };
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

  const editorChord = selectedChordId ? activeSection.chords.find((c) => c.id === selectedChordId) ?? null : null;

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

      {/* Selected chord's editor — selection/remove → Beats → Quality →
          Substitutions; performance lives in the effect row. */}
      {editorChord && (
        <div className="border-b border-edge">
          <ChordEditorPopover
            chord={editorChord}
            keyName={effectiveKey}
            scale={effectiveScale}
            onChange={(updated) => updateChords(activeSection.chords.map((c) => (c.id === updated.id ? updated : c)))}
            onRemove={() => {
              updateChords(activeSection.chords.filter((c) => c.id !== editorChord.id));
              setSelectedChordId(null);
            }}
            onDeselect={() => setSelectedChordId(null)}
          />
        </div>
      )}

      {/* Color flavor */}
      <div className="p-2.5 border-b border-edge">
        <label
          className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
          title="Bi-tonal 'Color Chord' flavor for this section — the Color track in MIDI export, Send to Ableton, and real-time MIDI out"
        >
          Color flavor
        </label>
        <select
          className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-ink"
          value={activeSection.colorFlavor ?? ""}
          onChange={(e) => setColorFlavor(e.target.value || undefined)}
        >
          <option value="">Default ({DEFAULT_COLOR_FLAVOR})</option>
          {COLOR_FLAVORS.map(([id, label]) => (
            <option key={id} value={id}>
              {id.replace(/_/g, " ")} · {label}
            </option>
          ))}
        </select>
      </div>

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

        {rhythmMode === "euclid" && hOutline && (
          <div className="space-y-1.5">
            <StepView outline={hOutline} color="#E8B54A" />
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

      {/* Preview layers + honeycomb view mode */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge">
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
        {(["linear", "loop"] as const).map((mode) => (
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
                : "Collapse repeating vamps onto a single lap"
            }
            onClick={() => setHoneycombMode(mode)}
          >
            {mode === "linear" ? "Linear" : "Loop"}
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