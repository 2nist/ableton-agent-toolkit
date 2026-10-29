import { useCallback, useEffect, useMemo, useState } from "react";
import {
  meanBeatsPerBar,
  sectionDurationBeats,
  type Chord,
} from "../../../types/blueprint";
import { deriveEvent, rootForDegree } from "../../../lib/harmony/analysis";
import { MODE_DATA } from "@music-theory/core";
import { floorSlots, insertChordAt } from "../../../lib/harmony/floorLayout";
import { chordGluePreview } from "../../../lib/midiExport";
import { uuid } from "../../../lib/uuid";
import ProgressionEditor from "../ProgressionEditor";
import HoneycombWheel from "../HoneycombWheel";
import TapeLabel from "../../common/TapeLabel";
import FitStatus from "../FitStatus";
import ProgressionFloor from "./ProgressionFloor";
import { segmentChordStream } from "../../../lib/harmony/segmentSections";
import type { HarmonyDeskProps } from "./types";

/** Write the progression.
 *
 *  **The floor is the instrument.** A box is a chord, depth is time, the gap
 *  is a rest — and the ladder is the keyboard: click a row and the chord
 *  of that degree appears at that beat. The left rail is only the toolbox for
 *  the chord you already selected; the map and the harmonic-rhythm grid are
 *  drawers under the floor.
 */
export default function ComposeDesk({
  song,
  section,
  keyName,
  scale,
  regions,
  analysis,
  selectedChordId,
  activeChordId,
  onSelectChord,
  onChangeChords,
  onChangeRhythm,
  onSetBars,
  onPreviewChord,
  onTransposeSong,
  onTransposeSection,
  onChangeRegions,
  onChangeSection,
  onSplitSection,
  onSplitSectionAt,
  onSplitSectionAtBar,
  onMergeWithNext,
  onRenameSection,
}: HarmonyDeskProps) {
  const [extension, setExtension] = useState<"triad" | "seventh">("triad");
  const [drawer, setDrawer] = useState<"none" | "map" | "rhythm" | "form">(
    "none",
  );
  /** What just happened, said out loud: a split rewrites the song, and the
   *  only other evidence is the section list quietly getting longer. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);

  const beatsPerBar = Math.max(1, meanBeatsPerBar(section));
  const barCount = Math.max(
    1,
    Math.round(sectionDurationBeats(section) / beatsPerBar),
  );
  /** Coarse ↔ fine: how long a block has to be before the reader may call it
   *  a part. Two bars finds every phrase, eight finds only the big ones. */
  const [grain, setGrain] = useState<"fine" | "medium" | "coarse">("medium");
  const minBlockBars = grain === "fine" ? 2 : grain === "coarse" ? 8 : 4;

  /**
   * What repeats inside this section. Catalog imports land whole tunes in one
   * block — Layla arrives as 87 chords in 77 bars — and this is the reading
   * that turns that block back into the form it already contains.
   */
  const segmentation = useMemo(
    () =>
      segmentChordStream(section.chords, {
        beatsPerBar,
        minBlockBeats: minBlockBars * beatsPerBar,
        // Fine shows the phrases a cycle is built from; medium and coarse
        // show the cycle, which is the reading worth writing as a form.
        collapseCycles: grain !== "fine",
      }),
    [section.chords, beatsPerBar, minBlockBars, grain],
  );

  const slots = useMemo(() => floorSlots(section.chords), [section.chords]);
  const chordSlices = useCallback(
    (startBeat: number, endBeat: number) => {
      const picked = section.chords
        .map((chord, index) => ({
          chord,
          index,
          start: slots[index]?.start ?? 0,
        }))
        .filter(
          (entry) =>
            entry.start >= startBeat - 0.001 && entry.start < endBeat - 0.001,
        );
      return {
        chords: picked.map((entry) => entry.chord),
        romans: picked.map(
          (entry) =>
            analysis.events[entry.index]?.roman ?? entry.chord.romanNumeral,
        ),
      };
    },
    [section.chords, slots, analysis.events],
  );

  /** The reading as detected — beat-accurate, with its repeats intact. */
  const detectedSplits = useMemo(
    () =>
      segmentation.sections.map((part) => ({
        ...part,
        ...chordSlices(part.startBeat, part.endBeat),
        startBar: Math.max(
          0,
          Math.min(barCount - 1, Math.round(part.startBeat / beatsPerBar)),
        ),
        endBar: Math.max(
          1,
          Math.min(barCount, Math.round(part.endBeat / beatsPerBar)),
        ),
      })),
    [segmentation.sections, chordSlices, beatsPerBar, barCount],
  );

  /** The swept ruler selection — the structural verbs hang off this. */
  const [barRange, setBarRange] = useState<{ from: number; to: number } | null>(
    null,
  );
  useEffect(() => setBarRange(null), [section.id]);

  /** What the band writes: the detected parts, at the grain you chose. */
  const formSplits = detectedSplits;

  const formStructure = useMemo(() => {
    const labels = detectedSplits.map((part) => part.label);
    return {
      useful:
        detectedSplits.length > 1 &&
        (new Set(labels).size < labels.length ||
          detectedSplits.some((part) => part.repeats > 1)),
    };
  }, [detectedSplits]);

  const harmonyOutline =
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false
      ? null
      : (section.drumMeterOutline ?? null));

  // One reading, everywhere: the floor, the map and the tools all see the
  // derived numerals, never the stored strings.
  // What the groove glue WOULD do to the chord onsets. The foot of the floor
  // shows it; nothing here writes to the song.
  const glue = useMemo(() => {
    const starts = floorSlots(section.chords).map((slot) => slot.start);
    return chordGluePreview(song, section.id, starts);
  }, [song, section.id, section.chords]);

  const syncedChords = section.chords.map((chord, index) => ({
    ...chord,
    romanNumeral: analysis.events[index]?.roman ?? chord.romanNumeral,
  }));

  /**
   * A click on the ladder names a step, a beat and (for a row between two scale
   * steps) a spelling; this is what that becomes. The quality is the landing
   * row's diatonic triad (or seventh) — a chromatic row still gets the chord of
   * its nearer scale step, so a bare click never writes something unasked for.
   */
  function placeChord(
    degree: number,
    accidental: number,
    beat: number,
    span: number,
    spelling?: "sharp" | "flat",
  ) {
    const label = MODE_DATA[scale]?.degrees[degree];
    const diatonic = label ? MODE_DATA[scale].map[label] : undefined;
    // A chromatic landing takes the quality of the row it is nearest: ♯III
    // wants III's triad, ♭VII wants ♭VII's.
    const quality: Chord["quality"] =
      extension === "seventh"
        ? (diatonic?.seventh ?? "maj7")
        : (diatonic?.triad ?? "maj");
    const root = rootForDegree(keyName, scale, degree, accidental);
    const beats = Math.max(0.5, span);
    const draft: Chord = {
      id: uuid(),
      root,
      quality,
      beats,
      romanNumeral: "",
      spelling,
    };
    const derived = deriveEvent(draft, null, {
      key: keyName,
      scale,
      startBeat: beat,
    });
    const chord: Chord = { ...draft, romanNumeral: derived.roman };
    // `insertChordAt` already knows the two ways a drop can land: inside a
    // chord (split it) or in open time / a rest (fill it).
    onChangeChords(insertChordAt(section.chords, beat, chord, beats));
    onSelectChord(chord.id);
    onPreviewChord?.(chord);
  }

  return (
    <div className="relative min-w-0">
      <ProgressionFloor
        chords={section.chords}
        analysis={analysis}
        keyName={keyName}
        scale={scale}
        beatsPerBar={beatsPerBar}
        beatsPerChord={section.beatsPerChord}
        selectedChordId={selectedChordId}
        activeChordId={activeChordId}
        regions={regions}
        onChangeChords={onChangeChords}
        onSelectChord={onSelectChord}
        onPreviewChord={onPreviewChord}
        onTranspose={(semitones, wholeSong) =>
          wholeSong ? onTransposeSong(semitones) : onTransposeSection(semitones)
        }
        onChangeRegions={onChangeRegions}
        onPlaceChord={placeChord}
        glue={glue}
        sections={song.sections.map((entry) => ({
          id: entry.id,
          name: entry.name,
        }))}
        sectionId={section.id}
        section={section}
        song={song}
        onChangeSection={onChangeSection}
        extension={extension}
        onExtensionChange={setExtension}
        tools={
          <span className="flex items-center gap-1.5">
            <span className="text-[8px] uppercase tracking-wider text-inkMuted/70">
              tools
            </span>
            <span className="flex overflow-hidden rounded border border-edge">
              {(
                [
                  {
                    id: "map",
                    label: "map",
                    hint: "The hex lens — the same progression as a walk",
                  },
                  {
                    id: "rhythm",
                    label: "rhythm",
                    hint: "Harmonic rhythm — every chord's share of the cycle",
                  },
                  {
                    id: "form",
                    label: formStructure.useful
                      ? `form · ${segmentation.sections.length}`
                      : "form",
                    hint: formStructure.useful
                      ? `This section already contains ${segmentation.sections.length} parts`
                      : "Detect the sections this chord stream already contains",
                  },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={drawer === entry.id}
                  title={entry.hint}
                  onClick={() =>
                    setDrawer(drawer === entry.id ? "none" : entry.id)
                  }
                  className={`border-r border-edge px-1 py-0.5 last:border-r-0 ${
                    drawer === entry.id
                      ? "bg-accent text-accentInk"
                      : entry.id === "form" && formStructure.useful
                        ? "text-accent hover:bg-accent/10"
                        : "hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </span>

            {/* How finely the stream is read — on the band, not behind a
                panel: the ghost boundaries move as you press it. */}
            {section.chords.length > 8 && (
              <span className="flex items-center gap-0.5">
                <span className="text-[8px] uppercase tracking-wider text-inkMuted/70">
                  grain
                </span>
                <span className="flex overflow-hidden rounded border border-edge">
                  {(["coarse", "medium", "fine"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={grain === option}
                      onClick={() => setGrain(option)}
                      title={`Only blocks of ${option === "coarse" ? 8 : option === "medium" ? 4 : 2}+ bars count as parts`}
                      className={`border-r border-edge px-1 py-0.5 text-[9px] last:border-r-0 ${
                        grain === option
                          ? "bg-accent text-accentInk"
                          : "hover:text-ink"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </span>
              </span>
            )}

            {formStructure.useful && (
              <button
                type="button"
                onClick={() => {
                  const parts = formSplits.length;
                  onSplitSection(
                    formSplits.map((part) => ({
                      label: part.label,
                      chords: part.chords,
                      repeats: part.repeats,
                    })),
                  );
                  setNotice(
                    `saved · split into ${parts} sections — undo to go back`,
                  );
                }}
                className="rounded border border-accent bg-accent px-1 py-0.5 text-[9px] font-semibold text-accentInk"
                title={`Write the ${formSplits.length} parts the chords already contain as sections`}
              >
                write {formSplits.length} sections
              </button>
            )}
            {notice && (
              <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent">
                {notice}
              </span>
            )}
          </span>
        }
        barRange={barRange}
        sectionName={section.name}
        onBarRange={setBarRange}
        onSplitSectionAtBar={onSplitSectionAtBar}
        segments={drawer === "form" && formStructure.useful ? formSplits : null}
        onSplitSectionAt={onSplitSectionAt}
        onMergeWithNext={onMergeWithNext}
        onRenameSection={onRenameSection}
        status={<FitStatus section={section} onSetBars={onSetBars} />}
      />

      {/* Tools open OVER the floor, never under it: the page is one screen. */}
      {drawer !== "none" && (
        <div className="absolute left-3 right-3 top-[38px] z-20 max-h-[min(420px,60%)] overflow-auto rounded border border-edge bg-panel shadow-2xl">
          <div className="sticky top-0 flex items-center gap-2 border-b border-edge bg-panel px-2 py-1 font-mono text-[9px] text-inkMuted/70">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              {drawer === "map" ? "Map" : "Harmonic rhythm"}
            </TapeLabel>
            <span className="text-inkMuted/60">
              {drawer === "map"
                ? "the same progression as a walk"
                : "each chord's share of the cycle"}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {analysis.stats.borrowedCount > 0 && (
                <span className="text-danger">
                  {analysis.stats.borrowedCount} borrowed
                </span>
              )}
              {analysis.stats.appliedCount > 0 && (
                <span className="text-accent">
                  {analysis.stats.appliedCount} applied
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setDrawer("none")}
              className="rounded border border-edge px-1 hover:text-ink"
              aria-label="Close tools"
            >
              ✕
            </button>
          </div>

          {drawer === "map" && (
            <div className="flex min-h-[300px] items-center justify-center overflow-x-auto px-3 py-2">
              <HoneycombWheel
                keyName={keyName}
                scale={scale}
                chords={syncedChords}
                beatsPerChord={section.beatsPerChord}
                selectedChordId={selectedChordId}
                activeChordId={activeChordId}
                onSelectChord={onSelectChord}
                onChangeChords={onChangeChords}
                regions={regions}
                colorFlavor={section.colorFlavor}
                harmonyOutline={harmonyOutline}
                onPreviewChord={onPreviewChord}
                mode="linear"
                initialScale={44}
                newChordExtension={extension}
              />
            </div>
          )}

          {drawer === "rhythm" && (
            <div className="px-2 py-2">
              <ProgressionEditor
                chords={syncedChords}
                keyName={keyName}
                scale={scale}
                beatsPerBar={beatsPerBar}
                sectionBeats={sectionDurationBeats(section)}
                selectedChordId={selectedChordId}
                activeChordId={activeChordId}
                outlineGoverned={false}
                regions={regions}
                onSelectChord={(id) => onSelectChord(id)}
                onChange={onChangeRhythm}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
