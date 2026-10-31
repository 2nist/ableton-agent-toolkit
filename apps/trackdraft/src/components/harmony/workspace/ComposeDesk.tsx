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
import TapeLabel from "../../common/TapeLabel";
import FitStatus from "../FitStatus";
import ProgressionFloor from "./ProgressionFloor";
import ChordSurface, { CHORD_VIEWS, useChordView } from "./ChordSurface";
import { segmentChordStream } from "../../../lib/harmony/segmentSections";
import type { BarsPerView } from "../../drums/blocks/meterGrid";
import type { HarmonyDeskProps } from "./types";

/** The three tools that genuinely open OVER the floor. "form" is deliberately
 *  not one of them — it toggles an annotation on the floor itself. */
/** Write the progression.
 *
 *  **The floor is the instrument.** A box is a chord, depth is time, the gap
 *  is a rest — and the ladder is the keyboard: click a row and the chord
 *  of that degree appears at that beat. The left rail is only the toolbox for
 *  the chord you already selected; the map and the harmonic-rhythm grid are
 *  drawers under the floor.
 */
export default function ComposeDesk({
  barsPerView,
  barOffset,
  song,
  section,
  keyName,
  scale,
  regions,
  analysis,
  selectedChordId,
  activeChordId,
  playheadBeat,
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
  leading,
  compact,
}: HarmonyDeskProps & {
  /** Force every band to show all its bars — the multi-section strip needs
   *  that so neighbouring bands share one bar grid. */
  barsPerView?: BarsPerView;
  /** Strip band: floor only, no toolbar or foot band. */
  compact?: boolean;
  /** Bars before this section in the song — the strip prints the song's own
   *  bar numbers instead of restarting at 1 on every band. */
  barOffset?: number;
}) {
  const [extension, setExtension] = useState<"triad" | "seventh">("triad");
  const [view, setView] = useChordView();
  /** "form" is not a drawer: it annotates the floor with the parts the chord
   *  stream already contains. It used to be a drawer value, which opened an
   *  empty overlay mislabelled "Harmonic rhythm" on top of the very segments
   *  it was meant to reveal. */
  const [formOn, setFormOn] = useState(false);
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
        leading={leading}
        compact={compact}
        barsPerView={barsPerView}
        barOffset={barOffset}
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
              {CHORD_VIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={view === entry.id}
                  title={entry.hint}
                  onClick={() => setView(view === entry.id ? "floor" : entry.id)}
                  className={`border-r border-edge px-1 py-0.5 ${
                    view === entry.id ? "bg-accent text-accentInk" : "hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={formOn}
                title={
                  formStructure.useful
                    ? `This section already contains ${segmentation.sections.length} parts — show them on the floor`
                    : "Detect the sections this chord stream already contains"
                }
                onClick={() => setFormOn((on) => !on)}
                className={`px-1 py-0.5 ${
                  formOn
                    ? "bg-accent text-accentInk"
                    : formStructure.useful
                      ? "text-accent hover:bg-accent/10"
                      : "hover:text-ink"
                }`}
              >
                {formStructure.useful
                  ? `form · ${segmentation.sections.length}`
                  : "form"}
              </button>
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
        segments={formOn && formStructure.useful ? formSplits : null}
        onSplitSectionAt={onSplitSectionAt}
        onMergeWithNext={onMergeWithNext}
        onRenameSection={onRenameSection}
        status={<FitStatus section={section} onSetBars={onSetBars} />}
      />

      {/* The lenses open OVER the floor, never under it: the page is one
          screen. Which one is open — and what each one needs — lives in
          ChordSurface, so adding a fourth is one table entry. */}
      <ChordSurface
        view={view}
        onClose={() => setView("floor")}
        desk={{
          song,
          section,
          keyName,
          scale,
          regions,
          playheadBeat,
          selectedChordId,
          activeChordId,
          onSelectChord,
          onChangeChords,
          onChangeRhythm,
          onPreviewChord,
        }}
        chords={syncedChords}
        beatsPerBar={beatsPerBar}
        sectionBeats={sectionDurationBeats(section)}
        harmonyOutline={harmonyOutline}
        extension={extension}
        borrowedCount={analysis.stats.borrowedCount}
        appliedCount={analysis.stats.appliedCount}
      />
    </div>
  );
}
