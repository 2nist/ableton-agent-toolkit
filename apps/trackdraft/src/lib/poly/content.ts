import {
  DRUM_LANE_IDS,
  audibleLanes,
  resolveChordOccurrences,
  type DrumLaneId,
} from "@drum/library";
import { pitchClass, type NoteName, type ScaleType } from "@music-theory/core";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import { beatsPerBar, sectionDurationBeats } from "../../types/blueprint";
import { analyzeSection } from "../harmony/analysis";
import { chordDisplayName } from "../harmony/chordBuilder";
import { resolveSectionLaneHits } from "../timeline/drumLaneHits";
import { applyTimeDomain, normaliseTimeDomain } from "@drum/library";
import { DRIFT_GRID, driftOf } from "./drift";
import { bassVoiceMarks, colorVoiceMarks } from "../harmony/voiceLayers";
import { authoredSteps, type DrumStepAuthored } from "./drumSteps";
import type { DrumBlock } from "../../types/blueprint";

/**
 * What a section node is made of — the material the canvas draws inside a
 * card, derived from the song and never stored.
 *
 * Everything here is a pure read of the blueprint through the SAME resolvers
 * the rest of the app uses (`analyzeSection` for numerals,
 * `resolveChordOccurrences` for what actually sounds, the shared drum
 * necklace resolver), so the canvas cannot disagree with the editors or with
 * export. Nothing in this module writes.
 */

export interface PolyChordCell {
  id: string;
  /** The underlying chord's id — what a click selects. */
  chordId: string;
  /** Derived numeral ("♭VII", "V7/V"); falls back to the stored label. */
  roman: string;
  /** Absolute name ("B♭maj7"). */
  name: string;
  /** Share of the span's duration, 0..1. */
  share: number;
  /** First cell of a new lap of the chord cell — the seam the timeline marks. */
  seam: boolean;
  /** The tail of a very long section, collapsed into one cell. */
  merged?: boolean;
}

/**
 * How many cells a drum lane gets (§S1.4).
 *
 * The rule is not "as many as fit" — it is **the cells must divide the bar.**
 * A Hard Day's Night's verse is 12 bars (48 beats); capping at 32 produced cells
 * of 1.5 beats, so no boundary landed on a bar, the grid drifted against the bar
 * lines, and it read as "2.5 beats per bar". A cell that is not a fraction of the
 * bar is a cell a musician cannot count.
 *
 * So: pick the finest rung of the ladder that still fits under the cap —
 * 4 per bar (a beat), then 2 (half bar), then 1 (the bar) — and give up
 * resolution in **whole divisions** rather than in fractions of one.
 */
export function drumCellCount(
  durationBeats: number,
  bars: number,
  maxColumns: number,
): number {
  const barCount = Math.max(0, Math.floor(bars));
  if (!(durationBeats > 0) || barCount <= 0) return 1;
  for (const perBar of [4, 2, 1]) {
    const columns = barCount * perBar;
    if (columns <= maxColumns) return columns;
  }
  // Longer than the cap can subdivide at all: one cell per bar, capped.
  return Math.max(1, Math.min(maxColumns, barCount));
}

export interface PolyDrumRow {
  /** The surface lane this row draws — the same vocabulary the section's
   *  `drumLaneMute` / `drumLaneSolo` fields use, so a click can toggle it. */
  lane: DrumLaneId;
  /** Short glyph for the row ("K", "S", "H"…). */
  glyph: string;
  /** Buckets, true where a hit lands. */
  cells: boolean[];
  /** How long the hit in each cell holds, in beats (0 = no hit). A gate longer
   *  than a cell spills into the next one — that is what a held hit does. */
  gates: number[];
  /** Cells holding an AUTHORED step — the only ones whose gate and feel can be
   *  edited. The rest of the row is the generated groove, and re-gating one hit
   *  of it would mean baking a block that replaces the groove under that window.
   *  `null` is a generated (or empty) cell. */
  authored: (DrumStepAuthored | null)[];
  /** Real onset count in the loop. */
  count: number;
  /** In `drumLaneMute` — kept on screen (struck through) so the toggle is
   *  reversible from the canvas. */
  muted: boolean;
  /** Silenced by a mute, or by another lane's solo. */
  silent: boolean;
  /** Hits the section's clock pushed off the 16th grid. */
  offGrid: number;
  /** The largest such push, in beats. */
  worstDrift: number;
  /** Hits that mapped past the section and were dropped. */
  dropped: number;
}

export interface PolyVoiceNote {
  /** Share of the span's duration, 0..1. */
  x: number;
  /** Share of the span's duration, 0..1. */
  w: number;
  /** Chromatic semitones above the tonic, 0-11 — the lane's vertical axis. */
  step: number;
  label: string;
}

export interface PolyColorNote extends PolyVoiceNote {
  /** The colour chord's symbol, e.g. "F#m11". */
  name?: string;
}

const LANE_GLYPH: Record<DrumLaneId, string> = {
  kick: "K",
  snare: "S",
  rim: "R",
  hat: "H",
  cym: "C",
  tom: "T",
};

/** The analysis's numeral per chord id — the one place numerals are derived, so
 *  the chord lane and the colour lane cannot disagree about what a chord is. */
function romanByChordId(
  section: BlueprintSection,
  song: Pick<BlueprintSong, "key" | "scale">,
): Map<string, string> {
  const analysis = analyzeSection(section.chords, {
    key: (section.key ?? song.key) as NoteName,
    scale: (section.scale ?? song.scale) as ScaleType,
    regions: section.tonicRegions,
    beatsPerBar: beatsPerBar(section),
  });
  return new Map(analysis.events.map((event) => [event.chordId, event.roman]));
}

/** Chords as they PLAY (the list is a repeating cell) with a derived numeral
 *  per cell. Long sections collapse their tail into one "…" cell instead of
 *  drawing forty unreadable slivers. */
export function polyChords(
  section: BlueprintSection,
  song: Pick<BlueprintSong, "key" | "scale">,
  durationBeats: number,
  limit = 16,
): PolyChordCell[] {
  if (section.chords.length === 0 || durationBeats <= 0) return [];

  const key = (section.key ?? song.key) as NoteName;
  const romanById = romanByChordId(section, song);

  const occurrences = resolveChordOccurrences(section, durationBeats);
  if (occurrences.length === 0) return [];

  const cellCount = section.chords.length;
  const cells: PolyChordCell[] = occurrences.map((occurrence, index) => ({
    id: `${occurrence.chord.id}#${index}`,
    chordId: occurrence.chord.id,
    roman: romanById.get(occurrence.chord.id) ?? occurrence.chord.romanNumeral,
    name: chordDisplayName(
      pitchClass(occurrence.chord.root),
      occurrence.chord.quality,
      key,
    ),
    share: occurrence.duration / durationBeats,
    seam: index > 0 && index % cellCount === 0,
  }));

  if (cells.length <= limit) return cells;

  const head = cells.slice(0, limit - 1);
  const tail = cells.slice(limit - 1);
  head.push({
    id: `${section.id}…`,
    chordId: "",
    roman: "…",
    name: `${tail.length} more`,
    share: tail.reduce((sum, cell) => sum + cell.share, 0),
    seam: false,
    merged: true,
  });
  return head;
}

/** The groove as one loop, bucketed onto a compact grid — enough to recognise
 *  a pattern at a glance without drawing a sequencer.
 *
 *  Voices are merged into the six surface lanes (a closed and an open hat are
 *  both "hat"), because the lane is the thing a section's mute/solo fields
 *  name and therefore the thing a click can toggle. */
export function polyDrums(
  section: BlueprintSection,
  song: Pick<
    BlueprintSong,
    "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
  >,
  occurrenceIndex = 0,
  maxRows = 6,
  maxColumns = 64,
): PolyDrumRow[] {
  return drumRows(section, song, occurrenceIndex, maxRows, maxColumns, true);
}

/**
 * The same groove as a *pattern*: the cells a step paint writes into.
 *
 * `polyDrums` shows where the hits SOUND, which under a clock is not where the
 * pattern's cells are — so a click on cell 5 would paint step 5 of a different
 * beat, and the old build answered that with a silent no-op. The lane draws
 * this instead: one grid, always in pattern space, so what you click is what
 * you edit. Where it *sounds* is the clock badge's job (off-grid count, lost
 * notes) and the per-cell tooltip's.
 */
export function polyDrumPattern(
  section: BlueprintSection,
  song: Pick<
    BlueprintSong,
    "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
  >,
  occurrenceIndex = 0,
  maxRows = 6,
  maxColumns = 64,
): PolyDrumRow[] {
  return drumRows(section, song, occurrenceIndex, maxRows, maxColumns, false);
}

function drumRows(
  section: BlueprintSection,
  song: Pick<
    BlueprintSong,
    "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
  >,
  occurrenceIndex: number,
  maxRows: number,
  maxColumns: number,
  clocked: boolean,
): PolyDrumRow[] {
  const duration = sectionDurationBeats(section);
  if (duration <= 0) return [];
  // The SAME hit compiler the Drum Blocks surface draws from: the base groove,
  // the Bend transforms, the seeded tiling, the 4-bar cycle and — crucially —
  // the section's authored `drumBlocks` compiled on top. Painting a step in
  // this lane writes one of those blocks, so a grid that skipped them would
  // show a cell that never changes.
  //
  // Mute/solo are stripped for the read so a muted lane still has hits to draw
  // (a struck-through row is a toggle you can undo); the flags are applied
  // below with the same `audibleLanes` rule the planner uses.
  const resolved = resolveSectionLaneHits(
    { ...section, drumLaneMute: undefined, drumLaneSolo: undefined },
    song as Parameters<typeof resolveSectionLaneHits>[1],
    occurrenceIndex,
  );
  if (resolved.size === 0) return [];
  // The section's own clock (§P3): the dots have to show the beat the note
  // actually lands on, or the grid and the export disagree — which is the one
  // thing this canvas is not allowed to do.
  const clock = clocked ? normaliseTimeDomain(section.timeDomain) : null;
  const hitsByLane = clock
    ? new Map(
        [...resolved].map(([lane, hits]) => [
          lane,
          applyTimeDomain(hits, clock, duration),
        ]),
      )
    : resolved;

  const playing = audibleLanes(section.drumLaneMute, section.drumLaneSolo);
  const muted = new Set<DrumLaneId>(section.drumLaneMute ?? []);
  const columns = drumCellCount(duration, section.bars, maxColumns);

  return DRUM_LANE_IDS.filter((lane) => (hitsByLane.get(lane)?.length ?? 0) > 0)
    .slice(0, maxRows)
    .map((lane) => {
      const hits = hitsByLane.get(lane) ?? [];
      const cells = new Array<boolean>(columns).fill(false);
      const gates = new Array<number>(columns).fill(0);
      for (const hit of hits) {
        const index = Math.min(
          columns - 1,
          Math.max(0, Math.floor((hit.beat / duration) * columns)),
        );
        cells[index] = true;
        // Two hits in one cell: the longer one is what the cell holds.
        if (hit.durBeats !== undefined) {
          gates[index] = Math.max(gates[index], hit.durBeats);
        }
      }
      // How far this lane's clock moved its hits off the song's grid — the
      // lane draws cells, so the number has to be carried, not derived.
      // Measured against the grid the CLOCK defines: a double-time section
      // puts its sixteenths on thirty-seconds by design, and calling that
      // drift would flag every hit. What is left is what the clock did not
      // account for — swing, an odd rate, a snapped-then-moved hit.
      const drift = driftOf(
        hits.map((hit) => hit.beat),
        DRIFT_GRID / (clock?.rate ?? 1),
      );
      const stored = resolved.get(lane)?.length ?? 0;
      // An authored gate WINS over the resolved note length. They answer
      // different questions: a ratchet splits the gate into sub-hits, so
      // `stepsBlockNotes` publishes each onset at `gate / ratchet` — the bar
      // would shrink to a 1.5-beat roll when the author asked for a 3-beat
      // step rolled twice. The gate is what the step HOLDS; the resolved
      // length is what one onset sounds for.
      const authoredStepsForLane = authoredSteps(
        section.drumBlocks as DrumBlock[] | undefined,
        lane,
        duration,
        columns,
      );
      authoredStepsForLane.forEach((step, index) => {
        if (step?.gate !== undefined) gates[index] = step.gate;
      });
      return {
        lane,
        glyph: LANE_GLYPH[lane],
        cells,
        gates,
        authored: authoredStepsForLane,
        count: hits.length,
        muted: muted.has(lane),
        silent: !playing.has(lane),
        offGrid: drift.offGrid,
        worstDrift: drift.worst,
        // A folded section deliberately ignores material outside the loop, so
        // that is not "lost" — only a 1:1 clock can push notes off the end.
        dropped: clock?.cycle ? 0 : Math.max(0, stored - hits.length),
      };
    });
}

/** Normalise a planner's beats into the column's 0..1 space. */
function toNotes(
  marks: readonly {
    step: number;
    start: number;
    duration: number;
    label: string;
    name?: string;
  }[],
  durationBeats: number,
): PolyColorNote[] {
  if (durationBeats <= 0) return [];
  return marks.map((mark) => ({
    x: Math.min(1, Math.max(0, mark.start / durationBeats)),
    w: Math.min(1, Math.max(0, mark.duration / durationBeats)),
    step: mark.step,
    label: mark.label,
    name: mark.name,
  }));
}

/** The generated bass line — real notes from the same planner the exports
 *  use, not one block per chord. */
export function polyBass(
  section: BlueprintSection,
  song: Pick<
    BlueprintSong,
    "key" | "scale" | "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
  >,
  durationBeats = sectionDurationBeats(section),
): PolyVoiceNote[] {
  if (section.chords.length === 0) return [];
  return toNotes(
    bassVoiceMarks(
      section,
      (section.key ?? song.key) as string,
      song as BlueprintSong,
    ),
    durationBeats,
  );
}

/**
 * The bi-tonal colour layer — one mark per chord, at the root of the chord the
 * flavour actually stacks.
 *
 * It draws the COLOUR chord's symbol, never the numeral of the chord it colours:
 * those roots differ by design (that is the point of the layer), so a numeral
 * here would name the wrong chord. The numeral/letter preference is therefore
 * the chords lane's alone.
 */
export function polyColor(
  section: BlueprintSection,
  song: Pick<
    BlueprintSong,
    "key" | "scale" | "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
  >,
  durationBeats = sectionDurationBeats(section),
): PolyColorNote[] {
  if (section.chords.length === 0) return [];
  return toNotes(
    colorVoiceMarks(
      section,
      (section.key ?? song.key) as string,
      song as BlueprintSong,
    ),
    durationBeats,
  );
}

/** Non-empty lyric lines, in order. */
export function polyLyrics(section: BlueprintSection): string[] {
  const raw = section.lyrics ?? "";
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
