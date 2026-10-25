import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NOTE_TO_PC, noteName, pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import {
  sectionDurationBeats,
  type BlueprintSection,
  type Chord,
  type TonicRegion,
} from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { effectiveTonicRegions } from "../../lib/harmony/tonic";
import { resolveChordOccurrences } from "@drum/library";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import {
  mergeWithNext,
  removeSection,
  repeatsFor,
  updateRepeats,
  updateSection,
  splitSection,
  splitSectionAt,
  splitSectionAtBar,
  type SectionSplit,
} from "../../lib/sections";
import { sharedRepeats } from "../../lib/sectionSelection";
import { useSectionShortcuts } from "./useSectionShortcuts";
import SectionComparison from "./workspace/SectionComparison";
import { useHarmonyWorkspaceStore } from "../../store/harmonyWorkspaceStore";
import { sectionSpans } from "../../lib/arrangement";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { useActiveChord } from "../../hooks/useActiveChord";
import HarmonyWorkspace, { HarmonyDeskBar } from "./workspace/HarmonyWorkspace";
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

  /**
   * Multi-section: every selected section is a band on one canvas, so their
   * progressions can be read against the same bars instead of one at a time.
   * Capped — past a handful of bands nobody is reading any more.
   */
  const desk = useHarmonyWorkspaceStore((s) => s.desk);
  const selectedIds = useStudioSelectionStore((s) => s.selected);
  const clearSectionSelection = useStudioSelectionStore((s) => s.clearSelection);
  const reconcileSelection = useStudioSelectionStore((s) => s.reconcile);
  const setSectionSelection = useStudioSelectionStore((s) => s.setSelection);
  const extendSectionSelection = useStudioSelectionStore((s) => s.extendSelectionTo);
  const sectionOrder = useMemo(() => (song?.sections ?? []).map((entry) => entry.id), [song?.sections]);

  useSectionShortcuts({
    order: sectionOrder,
    focusedId: selectedSectionId,
    onFocus: (sectionId) => setSelectedSectionId(sectionId),
    onExtendTo: (sectionId) => extendSectionSelection(sectionId, sectionOrder),
    onSelectAll: () => setSectionSelection(sectionOrder, selectedSectionId ?? sectionOrder[0] ?? null),
    // Escape drops a multi-selection back to the focused section. With one
    // section selected there is nothing to collapse, so it is left alone —
    // Escape still belongs to whatever else is open.
    onCollapse: () => {
      if (selectedIds.length > 1 && selectedSectionId) setSelectedSectionId(selectedSectionId);
    },
  });

  const stackAll = useMemo(
    () => (song ? song.sections.filter((entry) => selectedIds.includes(entry.id)) : []),
    [song, selectedIds],
  );
  // The stack is the compose view: Rehearse and Study are built around one
  // section at a time (a scene, a table, a tension readout), and stacking
  // them turned three bands into an eight-thousand-pixel scroll.
  const stacked = desk === "compose" && stackAll.length > 1;

  // A section can vanish under the selection (delete, split, template) — the
  // store must not keep pointing at it.
  useEffect(() => {
    if (!song) return;
    reconcileSelection(song.sections.map((entry) => entry.id));
  }, [song, reconcileSelection]);

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

  /**
   * Where the chart's cursor sits. `beatInSection` is deliberately null once
   * the transport leaves the focused section, so using it froze the cursor on
   * the first bar for the rest of the tune; the chart is the whole song, so it
   * follows the raw song beat and only falls back to the focused section when
   * nothing has played yet.
   */
  const playheadBeat = tick ? tick.beat : (activeSpan?.startBeat ?? null);

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

  const stackRepeats = sharedRepeats(stackAll.map((entry) => repeatsFor(song, entry.id)));
  const stackBars = stackAll.reduce((sum, entry) => sum + Math.round(entry.bars * repeatsFor(song, entry.id)), 0);
  const stackChords = stackAll.reduce((sum, entry) => sum + entry.chords.length, 0);

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

  /** Bulk edits over the multi-selection — each one a single undo step. */
  function setRepeatsOnSelection(repeats: number) {
    const ids = stackAll.map((entry) => entry.id);
    if (ids.length === 0) return;
    updateCurrentSong((s) => ids.reduce((acc, id) => updateRepeats(acc, id, repeats), s));
  }

  function transposeSelection(semitones: number) {
    const ids = new Set(stackAll.map((entry) => entry.id));
    if (ids.size === 0 || semitones === 0) return;
    updateCurrentSong((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (!ids.has(sec.id)) return sec;
        const base = sec.key ?? s.key;
        const nextKey = noteName((pitchClass(base) + semitones + 12) % 12, base);
        const shift = (name: NoteName) => noteName((pitchClass(name) + semitones + 12) % 12, nextKey);
        return {
          ...sec,
          key: shift(base),
          chords: sec.chords.map((chord) => ({ ...chord, root: shift(chord.root) })),
          tonicRegions: sec.tonicRegions?.map((region) => ({ ...region, key: shift(region.key) })),
        };
      }),
    }));
  }

  function deleteSelection() {
    const ids = stackAll.map((entry) => entry.id);
    if (ids.length === 0) return;
    updateCurrentSong((s) => ids.reduce((acc, id) => removeSection(acc, id), s));
    clearSectionSelection();
  }

  /**
   * A structural edit replaces sections, so the selection has to be rebuilt
   * from what still exists plus what the edit created — otherwise a split
   * silently drops you back to one section and the strip disappears.
   */
  function reselectAfterEdit(previousSelection: readonly string[], previousIds: readonly string[]) {
    const after = useSongStore.getState().currentSong();
    if (!after) return;
    const before = new Set(previousIds);
    const survivors = previousSelection.filter((id) => after.sections.some((entry) => entry.id === id));
    const created = after.sections.filter((entry) => !before.has(entry.id)).map((entry) => entry.id);
    const keep = new Set([...survivors, ...created]);
    const ordered = after.sections.map((entry) => entry.id).filter((id) => keep.has(id));
    if (ordered.length === 0) return;
    setSectionSelection(ordered, ordered[0]);
  }

  /** The form drawer's write: one section becomes the sections its own chord
   *  stream contains. Structural, so it goes through the song store like any
   *  other edit — one undo step puts the block back. */
  function splitSectionOf(section: BlueprintSection, splits: SectionSplit[]) {
    if (!song || splits.length === 0) return;
    const previousSelection = selectedIds;
    const previousIds = song.sections.map((entry) => entry.id);
    updateCurrentSong((s) => splitSection(s, section.id, splits));
    reselectAfterEdit(previousSelection, previousIds);
    setSelectedChordId(null);
  }

  function splitIntoSectionParts(splits: SectionSplit[]) {
    if (!activeSection) return;
    splitSectionOf(activeSection, splits);
  }

  /** Cut at a bar of the strip — the same verb, expressed in bars. */
  function splitSectionAtBarOf(section: BlueprintSection, bar: number) {
    if (!song) return;
    const previousSelection = selectedIds;
    const previousIds = song.sections.map((entry) => entry.id);
    updateCurrentSong((s) => splitSectionAtBar(s, section.id, bar));
    reselectAfterEdit(previousSelection, previousIds);
    setSelectedChordId(null);
  }

  /** The manual cut: this chord starts a new section. Structural, one undo. */
  function splitSectionAtChordOf(section: BlueprintSection, chordId: string) {
    if (!song) return;
    const previousSelection = selectedIds;
    const previousIds = song.sections.map((entry) => entry.id);
    updateCurrentSong((s) => splitSectionAt(s, section.id, chordId));
    reselectAfterEdit(previousSelection, previousIds);
    setSelectedChordId(null);
  }

  /** Rename in place: a structure edit like any other, one undo step. */
  function renameSectionOf(section: BlueprintSection, name: string) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || trimmed === section.name) return;
    updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, name: trimmed })));
  }

  /** Glue onto the next section — the undo of an over-eager split. */
  function mergeSectionOf(section: BlueprintSection) {
    if (!song) return;
    const index = song.sections.findIndex((entry) => entry.id === section.id);
    if (index < 0 || index >= song.sections.length - 1) return;
    const previousSelection = selectedIds;
    const previousIds = song.sections.map((entry) => entry.id);
    updateCurrentSong((s) => mergeWithNext(s, section.id));
    reselectAfterEdit(previousSelection, previousIds);
  }

  /** A rehearsal transpose writes once: every chord root, every section key
   *  override and every authored tonic region move together, so the derived
   *  roman numerals read exactly as they did before. One undo step. */
  function transposeSong(semitones: number) {
    if (semitones === 0) return;
    updateCurrentSong((s) => {
      const nextKey = noteName((pitchClass(s.key) + semitones + 12) % 12, s.key);
      const shift = (name: NoteName) => noteName((pitchClass(name) + semitones + 12) % 12, nextKey);
      return {
        ...s,
        key: nextKey,
        sections: s.sections.map((sec) => ({
          ...sec,
          key: sec.key ? shift(sec.key) : undefined,
          chords: sec.chords.map((chord) => ({ ...chord, root: shift(chord.root) })),
          tonicRegions: sec.tonicRegions?.map((region) => ({ ...region, key: shift(region.key) })),
        })),
      };
    });
  }

  /** Transpose ONE section (the ⌥ variant of a tonic drag, and the stack's
   *  per-band control). */
  function transposeSectionOf(section: BlueprintSection, semitones: number) {
    if (semitones === 0) return;
    const base = section.key ?? effectiveKey;
    const nextKey = noteName((pitchClass(base) + semitones + 12) % 12, base);
    const shift = (name: NoteName) => noteName((pitchClass(name) + semitones + 12) % 12, nextKey);
    updateCurrentSong((s) =>
      updateSection(s, section.id, (sec) => ({
        ...sec,
        key: nextKey,
        chords: sec.chords.map((chord) => ({ ...chord, root: shift(chord.root) })),
        tonicRegions: sec.tonicRegions?.map((region) => ({ ...region, key: shift(region.key) })),
      })),
    );
  }

  /** The same write, scoped to the section on screen. */
  function transposeSection(semitones: number) {
    if (!activeSection) return;
    transposeSectionOf(activeSection, semitones);
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

  /** The desk props, built once: the multi-selection branch and the plain
   *  one render the same workspace, and two copies of this list already
   *  drifted apart once. */
  /** The desk props, built once: the multi-selection branch and the plain one
   *  render the same workspace, and two copies of this list drifted apart the
   *  last time they were written out separately. */
  const deskProps = activeSection
    ? {
        song,
        section: activeSection,
        keyName: effectiveKey,
        scale: effectiveScale,
        regions: effectiveRegions,
        selectedChordId,
        activeChordId,
        playheadBeat,
        outlineGoverned: chordsFollowOutline,
        onSelectChord: setSelectedChordId,
        onChangeChords: updateChords,
        onChangeRhythm: updateRhythm,
        onSetBars: setSectionBars,
        onTransposeSong: transposeSong,
        onTransposeSection: transposeSection,
        onChangeRegions: (regions: TonicRegion[] | undefined) =>
          updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, tonicRegions: regions }))),
        onPreviewChord: (chord: Chord) => void previewChord(chord),
        onSplitSection: splitIntoSectionParts,
        onSplitSectionAt: (chordId: string) => splitSectionAtChordOf(activeSection, chordId),
        onSplitSectionAtBar: (bar: number) => splitSectionAtBarOf(activeSection, bar),
        onMergeWithNext:
          song.sections.findIndex((entry) => entry.id === activeSection.id) < song.sections.length - 1
            ? () => mergeSectionOf(activeSection)
            : null,
        onRenameSection: (name: string) => renameSectionOf(activeSection, name),
      }
    : null;

  return (
    <div className="p-3 space-y-2">
      <HarmonyDeskBar />

      {desk === "study" && stackAll.length > 1 ? (
        <SectionComparison
          song={song}
          sections={stackAll}
          onFocus={(sectionId) => setSelectedSectionId(sectionId)}
        />
      ) : !stacked && desk !== "compose" && stackAll.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-edge/60 bg-panel/60 px-2 py-1 font-mono text-[9px] text-inkMuted/70">
          <span>
            {stackAll.length} sections selected — this desk shows the focused one
          </span>
          <button
            type="button"
            onClick={clearSectionSelection}
            className="rounded border border-edge px-1.5 hover:text-ink"
          >
            focus one
          </button>
        </div>
      ) : stacked ? (
        <div className="space-y-2">
          {/* Bulk edits over the whole selection — one undo step each. */}
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-edge bg-panel px-2 py-1 font-mono text-[10px]">
            <span className="font-semibold text-ink">{stackAll.length} sections selected</span>
            <span className="text-inkMuted/70">
              {stackBars} bars · {stackChords} chords · edits apply to all of them
            </span>
            <span className="mx-1 h-3 w-px bg-edge" />
            <span className="text-inkMuted/60">repeats</span>
            <button
              type="button"
              onClick={() => setRepeatsOnSelection(Math.max(1, (stackRepeats ?? 1) - 1))}
              className="rounded border border-edge px-1.5 hover:text-ink"
              aria-label="One fewer pass"
              title="Fewest passes is 1 — 0 would skip the section, which the spine menu still does per section"
            >
              −
            </button>
            <span className="w-5 text-center tabular-nums">{stackRepeats ?? "—"}</span>
            <button
              type="button"
              onClick={() => setRepeatsOnSelection(Math.min(16, (stackRepeats ?? 1) + 1))}
              className="rounded border border-edge px-1.5 hover:text-ink"
              aria-label="One more pass"
            >
              +
            </button>
            <span className="mx-1 h-3 w-px bg-edge" />
            <span className="text-inkMuted/60">transpose</span>
            <button type="button" onClick={() => transposeSelection(-1)} className="rounded border border-edge px-1.5 hover:text-ink">
              ♭
            </button>
            <button type="button" onClick={() => transposeSelection(1)} className="rounded border border-edge px-1.5 hover:text-ink">
              ♯
            </button>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={clearSectionSelection}
                className="rounded border border-edge px-1.5 hover:text-ink"
                title="Back to one section"
              >
                focus one
              </button>
              <button
                type="button"
                onClick={deleteSelection}
                className="rounded border border-danger/60 px-1.5 text-danger hover:bg-danger/10"
              >
                delete {stackAll.length}
              </button>
            </span>
          </div>

          {deskProps && <HarmonyWorkspace {...deskProps} />}
        </div>
      ) : (
        deskProps && <HarmonyWorkspace {...deskProps} />
      )}

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
