import type { NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSection, BlueprintSong, Chord, TonicRegion } from "../../../types/blueprint";
import type { HarmonyAnalysis } from "../../../lib/harmony/analysis";
import type { SectionSplit } from "../../../lib/sections";

/** What every desk receives. The analysis is computed once by the workspace,
 *  so a numeral cannot differ between the strip, the chart and the table. */
export interface HarmonyDeskProps {
  song: BlueprintSong;
  section: BlueprintSection;
  keyName: NoteName;
  scale: ScaleType;
  regions: TonicRegion[];
  analysis: HarmonyAnalysis;
  /** Song-relative beat the transport is on, so Rehearse's chart can put its
   *  cursor on the bar that is sounding. Null before anything has played. */
  playheadBeat?: number | null;
  selectedChordId: string | null;
  activeChordId: string | null;
  outlineGoverned: boolean;
  onSelectChord: (chordId: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
  onChangeRhythm: (chords: Chord[], beatsPerChord: number) => void;
  onSetBars: (bars: number) => void;
  onTransposeSong: (semitones: number) => void;
  /** Transpose just the section on screen — the ⌥ variant of a tonic drag. */
  onTransposeSection: (semitones: number) => void;
  /** Write (or clear) the section's authored tonic regions — the "rehome the
   *  analysis" verb: same pitches, different numerals. */
  onChangeRegions: (regions: TonicRegion[] | undefined) => void;
  /** Replace this section with the sections its own chord stream contains —
   *  one undo step, written like any other structural edit. */
  onSplitSection: (splits: SectionSplit[]) => void;
  /** Cut this section in two at a chord — the manual boundary, for when the
   *  reading is too fine or too coarse. */
  onSplitSectionAt: (chordId: string) => void;
  /** The same cut, expressed in bars: what a swept ruler selection means. */
  onSplitSectionAtBar: (bar: number) => void;
  /** Glue this section onto the next one. Null when there is no next. */
  onMergeWithNext: (() => void) | null;
  /** Rename this section (structure edit, one undo step). */
  onRenameSection: (name: string) => void;
  onPreviewChord?: (chord: Chord) => void;
}
