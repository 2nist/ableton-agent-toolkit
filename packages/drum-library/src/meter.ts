import { ABLETON_SAFE_NOTES } from "./ableton.js";
import type { PackedNote, PackedVariant } from "./presetData.js";

/**
 * Building any meter — however odd — out of 2-beat ("apple") and 3-beat
 * ("galloping") groups, per Kevin Ferguson's "Mastering Odd, Complex Time
 * Signatures and Rhythms": Balkan/Hindustani rhythmic cycles are all
 * constructed this way (5/16 = 2+3, 7/16 = 2+2+3 or 3+2+2, 11/16 =
 * 2+2+3+2+2...), and large irregular meters (25/16, 27/16) are built by
 * concatenating smaller 5/7/9/11-style blocks rather than one flat
 * decomposition. `PRESET_DATA`'s fixed `DrumPattern` enum (4/4, 6/8, 5/4,
 * 7/8) covers what the corpus has takes for; this module is the parallel
 * path for everything else — meters with no corpus analogue at all.
 */

/** "apple" (2, DA-da) or "gallop" (3, DA-da-da) — Ferguson's mnemonic groups. */
export type MeterCell = 2 | 3;

export interface MeterOutline {
  /** Quarter-note-beat span of one cell: 0.5 for x/8 meters, 0.25 for x/16. */
  cellBeats: number;
  /** Ordered 2s/3s whose sum is the meter's numerator, in cell units. */
  cells: MeterCell[];
  /** Mnemonic counting text, e.g. "1 2 1 2 3" for 5/8 grouped as 2+3. */
  label: string;
}

/** Sum of an outline's cells — the meter's numerator, in cell units. */
export function numerator(outline: MeterOutline): number {
  return outline.cells.reduce((sum, cell) => sum + cell, 0);
}

/**
 * Quarter-note beats spanned by one bar of this meter — the same
 * "a 7/8 bar is 3.5 beats, not 7" convention `song-blueprint`'s
 * `beatsPerBar()` and `trackdraft-bridge`'s `sectionSpans` already use.
 * Named `outlineBeatsPerBar` (not `beatsPerBar`) to avoid colliding with
 * `catalog.ts`'s `TimeSignature`-based function of the same name.
 */
export function outlineBeatsPerBar(outline: MeterOutline): number {
  return numerator(outline) * outline.cellBeats;
}

/** Quarter-note beats per cell for a given time-signature denominator. */
function cellBeatsForDenominator(denominator: number): number {
  return 4 / denominator;
}

/** Mnemonic counting text for an arbitrary cell sequence — exported so a caller building a freeform outline (not one of `canonicalGroupings`'s curated options) can still get a label without reimplementing this. */
export function countLabel(cells: readonly MeterCell[]): string {
  return cells.map((cell) => Array.from({ length: cell }, (_, i) => String(i + 1)).join(" ")).join(" ");
}

/**
 * Known honest groupings per numerator, straight from the source material
 * (cited per entry) — offered as a picker rather than one hardcoded answer,
 * since the PDF's own point is that a meter can be genuinely grouped more
 * than one way depending on the song's actual accents.
 */
const CANONICAL_GROUPINGS: Record<number, MeterCell[][]> = {
  // "Apple Sauce": 5/8 as "apple galloping" (2+3), the introductory example.
  5: [[2, 3], [3, 2]],
  // "apple apple galloping" (2+2+3) vs. rupak / "galloping apple apple" (3+2+2).
  7: [[2, 2, 3], [3, 2, 2]],
  // Macedonian syncopated "apple apple apple galloping" (2+2+2+3) vs. the
  // "Western" even 3+3+3 ("Olimpijski Chochek", "Abdala").
  9: [[2, 2, 2, 3], [3, 3, 3]],
  // Jhaptal (Hindustani 10-beat tal): "apple galloping galloping apple".
  10: [[2, 3, 3, 2]],
  // "Revisko Oro": "apple apple galloping apple apple" (2+2+3+2+2).
  11: [[2, 2, 3, 2, 2]],
  // Ghanaian "gankogui": 2+3+2+2+3 (from the 2+2+1+2+2+2+1 pulse pattern,
  // primary/secondary accents only).
  12: [[2, 3, 2, 2, 3]],
};

/**
 * Fallback for a numerator with no curated grouping above: greedily use 3s,
 * dropping to a single trailing 2 rather than ever leaving a bare 1 beat
 * over — every integer >= 2 is expressible this way.
 */
function decompose(n: number): MeterCell[] {
  const cells: MeterCell[] = [];
  let remaining = n;
  while (remaining > 3) {
    if (remaining % 2 === 0) {
      cells.push(2);
      remaining -= 2;
    } else {
      cells.push(3);
      remaining -= 3;
    }
  }
  if (remaining > 0) cells.push(remaining as MeterCell);
  return cells;
}

/** All known groupings for a numerator — curated ones first, else a single generated fallback. */
export function canonicalGroupings(numeratorValue: number): MeterCell[][] {
  if (numeratorValue < 2) throw new Error(`canonicalGroupings: numerator must be >= 2, got ${numeratorValue}`);
  return CANONICAL_GROUPINGS[numeratorValue] ?? [decompose(numeratorValue)];
}

/**
 * Build a meter outline for `numerator/denominator`, e.g.
 * `buildMeterOutline(7, 16)` for 7/16. `variant` selects among
 * `canonicalGroupings`'s options (0 = first/most common); out-of-range
 * clamps to the last option rather than throwing, so a caller iterating
 * variants doesn't need to know each numerator's count in advance.
 */
export function buildMeterOutline(numeratorValue: number, denominator: number, variant = 0): MeterOutline {
  const options = canonicalGroupings(numeratorValue);
  const cells = options[Math.max(0, Math.min(variant, options.length - 1))]!;
  return { cellBeats: cellBeatsForDenominator(denominator), cells, label: countLabel(cells) };
}

/* ============================================================
   EUCLIDEAN CONSTRUCTION — a second, more general way to reach
   the same 2s/3s cells `canonicalGroupings` curates by hand.

   Bjorklund's algorithm (k pulses spread as evenly as possible
   across n steps) turns out to *already produce* Ferguson's own
   curated groupings for the numerators above — verified directly:
   E(3,7) -> gaps [2,2,3]; E(4,9) -> [2,2,2,3]; E(3,9) -> [3,3,3].
   That's not a coincidence: both are "maximal evenness" answers to
   the same question, just parameterized differently (an explicit
   2/3 sequence vs. a pulse count). This section generalizes that —
   any numerator, any valid pulse count, not just the hand-curated
   5/7/9/10/11/12 set — while staying inside the same 2s/3s cell
   vocabulary `MeterOutline` already commits to.
   ============================================================ */

/**
 * k pulses distributed as evenly as possible across n steps —
 * Bjorklund's algorithm, the same construction behind son clave,
 * tresillo, and most hardware "Euclidean" sequencer modes.
 */
export function euclideanPattern(pulses: number, steps: number): boolean[] {
  if (pulses <= 0 || steps <= 0) return new Array(Math.max(steps, 0)).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);

  let a: number[][] = Array.from({ length: pulses }, () => [1]);
  let b: number[][] = Array.from({ length: steps - pulses }, () => [0]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const newA: number[][] = [];
    for (let i = 0; i < m; i++) newA.push(a[i]!.concat(b[i]!));
    const remA = a.slice(m);
    const remB = b.slice(m);
    a = newA;
    b = remA.length ? remA : remB;
  }
  return a.concat(b).flat().map((v) => v === 1);
}

/**
 * Every cell count a numerator can honestly be built from using only
 * 2s and 3s (solving `2a + 3b = numeratorValue` for non-negative
 * integers, returning each valid `a + b`) — e.g. 12 can be 4 cells (all
 * 3s), 5 cells (three 2s, two 3s — the curated gankogui grouping), or 6
 * cells (all 2s). `canonicalGroupings` only ever offered one hand-picked
 * cell count per numerator; this is every one that's mathematically
 * valid, ascending (fewer, larger cells first).
 */
export function twoThreeCellCounts(numeratorValue: number): number[] {
  const counts = new Set<number>();
  for (let b = 0; b * 3 <= numeratorValue; b++) {
    const rem = numeratorValue - b * 3;
    if (rem % 2 === 0) {
      const a = rem / 2;
      if (a + b >= 1) counts.add(a + b);
    }
  }
  return Array.from(counts).sort((x, y) => x - y);
}

/**
 * The cells for `numeratorValue` built from exactly `cellCount` 2s/3s,
 * via `euclideanPattern` — the maximally-even arrangement, which is what
 * makes this differ from just picking *a* valid combination: it's the
 * same evenness the corpus's own real playing tends toward, not an
 * arbitrary one. `rotation` cyclically shifts which cell is read first
 * (0 = the arrangement `euclideanPattern` itself produces), a real
 * musical choice — an accent pattern read starting from a different beat
 * of its own cycle — not a destructive edit.
 *
 * Throws if `cellCount` isn't one of `twoThreeCellCounts(numeratorValue)`
 * — every gap `euclideanPattern` produces for an invalid count won't be
 * exactly 2 or 3 (e.g. `E(2,7)` gives gaps [3,4]), and silently clamping
 * that into the 2/3 vocabulary would misrepresent the meter rather than
 * fail loudly. Callers should offer only `twoThreeCellCounts`'s options.
 */
export function euclideanCells(numeratorValue: number, cellCount: number, rotation = 0): MeterCell[] {
  const pattern = euclideanPattern(cellCount, numeratorValue);
  const onsets: number[] = [];
  pattern.forEach((hit, i) => { if (hit) onsets.push(i); });
  if (onsets.length !== cellCount) {
    throw new Error(`euclideanCells: ${cellCount} is not a valid 2s/3s cell count for numerator ${numeratorValue}`);
  }

  const gaps: MeterCell[] = onsets.map((onset, i) => {
    const next = onsets[(i + 1) % onsets.length]!;
    const gap = next > onset ? next - onset : numeratorValue - onset + next;
    if (gap !== 2 && gap !== 3) {
      throw new Error(`euclideanCells: ${cellCount} is not a valid 2s/3s cell count for numerator ${numeratorValue}`);
    }
    return gap;
  });

  const r = ((rotation % cellCount) + cellCount) % cellCount;
  return [...gaps.slice(r), ...gaps.slice(0, r)];
}

/**
 * The Euclidean equivalent of `buildMeterOutline` — same output shape,
 * generalized cell selection (`twoThreeCellCounts`, not a curated
 * 1-2-option table) and an explicit rotation instead of a fixed "first
 * option" default.
 */
export function buildEuclideanOutline(
  numeratorValue: number,
  denominator: number,
  cellCount: number,
  rotation = 0,
): MeterOutline {
  const cells = euclideanCells(numeratorValue, cellCount, rotation);
  return { cellBeats: cellBeatsForDenominator(denominator), cells, label: countLabel(cells) };
}

/**
 * Concatenate outlines into one larger meter — how the PDF builds
 * large/irregular meters like 25/16 (7+11+7, per the PDF's own opening
 * example) or 27/16 (7+9+11, "Mayday Macedonia"): as a sequence of smaller
 * 5/7/9/11-style blocks, not one flat decomposition of the whole numerator.
 */
export function composeMeter(...parts: MeterOutline[]): MeterOutline {
  if (parts.length === 0) throw new Error("composeMeter: at least one part required");
  const cellBeats = parts[0]!.cellBeats;
  if (parts.some((part) => part.cellBeats !== cellBeats)) {
    throw new Error("composeMeter: all parts must share the same cellBeats (subdivision)");
  }
  return {
    cellBeats,
    cells: parts.flatMap((part) => part.cells),
    label: parts.map((part) => part.label).join(" / "),
  };
}

export interface ClickPatternOptions {
  /** Pitch for every subdivision; default matches this library's closed-hat convention (note 42). */
  pitch?: number;
  /** Pitch for the accented (first) subdivision of each cell; defaults to `pitch`. */
  accentPitch?: number;
  velocity?: number;
  accentVelocity?: number;
}

/** Closed hat, matching `drumRackProbe.ts`'s `ASSUMED` note convention. */
const DEFAULT_CLICK_PITCH = ABLETON_SAFE_NOTES.closedHat;

/**
 * One hit per cell subdivision — a hi-hat/click pattern a player can count
 * or play along to. The first subdivision of each cell is accented (the
 * "DA" in "DA-da" / "DA-da-da"), giving an audible sense of where each
 * apple/gallop starts without needing to read the outline.
 */
export function outlineToClickPattern(outline: MeterOutline, opts: ClickPatternOptions = {}): PackedNote[] {
  const pitch = opts.pitch ?? DEFAULT_CLICK_PITCH;
  const accentPitch = opts.accentPitch ?? pitch;
  const velocity = opts.velocity ?? 80;
  const accentVelocity = opts.accentVelocity ?? 110;

  const notes: PackedNote[] = [];
  let beat = 0;
  for (const cell of outline.cells) {
    for (let sub = 0; sub < cell; sub++) {
      const accent = sub === 0;
      notes.push([beat, accent ? accentPitch : pitch, accent ? accentVelocity : velocity]);
      beat += outline.cellBeats;
    }
  }
  return notes;
}

/** Which voice a cell's downbeat plays — "hat" means no special voice, same as `outlineToClickPattern`'s plain accent. */
export type CellVoice = "kick" | "snare" | "hat";

export interface GroovePatternOptions {
  hatPitch?: number;
  kickPitch?: number;
  snarePitch?: number;
  /** Backbone pulse on every subdivision a cell's voice doesn't claim. */
  hatVelocity?: number;
  /** Every cell's downbeat hit, whichever voice it is. */
  accentVelocity?: number;
}

/**
 * A basic kick/snare groove built from the outline, not just a click:
 * each cell's first subdivision (its "DA") plays that cell's assigned
 * voice — kick or snare — at full accent; every other subdivision plays a
 * soft closed-hat pulse, same backbone role as `outlineToClickPattern`'s.
 * A cell with no assigned voice (or explicitly `"hat"`) just gets an
 * accented hat hit on its downbeat, identical to `outlineToClickPattern`.
 *
 * `cellVoices` shorter than `outline.cells` treats the missing entries as
 * `"hat"` — a caller doesn't have to assign every cell to get something
 * playable.
 */
export function outlineToGroovePattern(
  outline: MeterOutline,
  cellVoices: readonly CellVoice[],
  opts: GroovePatternOptions = {},
): PackedNote[] {
  const hatPitch = opts.hatPitch ?? ABLETON_SAFE_NOTES.closedHat;
  const kickPitch = opts.kickPitch ?? ABLETON_SAFE_NOTES.kick;
  const snarePitch = opts.snarePitch ?? ABLETON_SAFE_NOTES.snare;
  const hatVelocity = opts.hatVelocity ?? 70;
  const accentVelocity = opts.accentVelocity ?? 110;

  const notes: PackedNote[] = [];
  let beat = 0;
  outline.cells.forEach((cell, i) => {
    const voice = cellVoices[i] ?? "hat";
    const downbeatPitch = voice === "kick" ? kickPitch : voice === "snare" ? snarePitch : hatPitch;
    for (let sub = 0; sub < cell; sub++) {
      notes.push([beat, sub === 0 ? downbeatPitch : hatPitch, sub === 0 ? accentVelocity : hatVelocity]);
      beat += outline.cellBeats;
    }
  });
  return notes;
}

/**
 * Fallback fill for a meter with no corpus/synth-fill analogue at all —
 * `FILL_DATA.acoustic`/`FILL_DATA.synth` are keyed by beats-per-bar and
 * have nothing for an outline-driven bar length like 6.25 (25/16). Walks
 * back from the end of the bar over the last half of the outline's cells
 * with an alternating tom figure, landing the final cell on a kick+snare
 * punch — same spirit as `synthesize.ts`'s `SYNTH_FILLS`, just outline-
 * driven instead of meter-fixed.
 */
export function synthesizeOutlineFill(outline: MeterOutline, velocityTarget: number): PackedVariant {
  const bars = outlineBeatsPerBar(outline);
  const cellStarts: number[] = [];
  let beat = 0;
  for (const cell of outline.cells) {
    cellStarts.push(beat);
    beat += cell * outline.cellBeats;
  }

  const tomFigureCells = cellStarts.slice(-Math.max(1, Math.ceil(cellStarts.length / 2)), -1);
  const toms = [ABLETON_SAFE_NOTES.tomHigh, ABLETON_SAFE_NOTES.tomMid];
  const tomVelocity = Math.round(velocityTarget * 0.75);
  const notes: PackedNote[] = tomFigureCells.map((start, i) => [start, toms[i % 2]!, tomVelocity]);

  const lastCellStart = cellStarts[cellStarts.length - 1]!;
  notes.push([lastCellStart, ABLETON_SAFE_NOTES.kick, velocityTarget]);
  notes.push([lastCellStart, ABLETON_SAFE_NOTES.snare, velocityTarget]);

  return {
    lengthBeats: bars,
    beatsPerBar: bars,
    notes: notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    source: { origin: "synth", generator: "outline-fill" },
  };
}
