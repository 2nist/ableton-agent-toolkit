import type { Chord } from "../../types/blueprint";

/**
 * Section detection over a chord stream.
 *
 * Catalog imports routinely land a whole tune in one "Unlabeled" section —
 * Layla arrives as 87 chords in a 77-bar block — and the harmony floor can
 * only ever show one window of it. This module answers the question the chart
 * already contains: *what repeats?*
 *
 * The unit is a **cell**: a chord with consecutive duplicates folded away, so
 * `Dm Dm B♭ C` and `Dm B♭ C` are the same shape. Durations are deliberately
 * NOT part of the match — a riff played with a held first chord is the same
 * riff — but they ARE part of how the result is expressed: a run of tiles
 * only becomes one section with `repeats` when every tile is the same length,
 * otherwise the duration change closes the section and the next one opens
 * as a separate section on the same letter.
 *
 * The strategy is a vocabulary, not a scan: count every chord block that
 * occurs more than once, close each one to its longest form (so `Dm` and
 * `Dm B♭` both collapse into `Dm B♭ C` instead of competing), then let the
 * most-repeated blocks claim the stream. A scan that only looks at what
 * follows the current position finds *one* repeat and then swallows
 * everything up to it — on Layla that meant a 26-bar block played twice,
 * which is the same unbounded section the user started with.
 */

export interface SegmentationOptions {
  /** Beats in one bar of the section being examined. */
  beatsPerBar: number;
  /** Shortest block worth calling a section, in beats. Defaults to two bars:
   *  one bar is usually a chord the material happens to share (a chorus that
   *  opens on the verse's second chord) rather than a section in its own
   *  right, and letting those compete buries the real blocks. */
  minBlockBeats?: number;
  /** A non-repeating stretch longer than this is cut up so it can't become
   *  the same unbounded block the user is trying to get rid of. Bars. */
  maxRunBars?: number;
  /** Collapse a repeating cycle (`A B A B` → "A B ×2"). On by default — it is
   *  the biggest thing the material says. The fine grain turns it off so the
   *  pieces a cycle is made of stay visible and editable. */
  collapseCycles?: boolean;
}

export interface DetectedSection {
  /** Inclusive start beat inside the source section. */
  startBeat: number;
  /** Exclusive end beat. */
  endBeat: number;
  /** How many times this exact span plays in a row (1 when it doesn't). */
  repeats: number;
  /** A, B, C… by first appearance of the *pattern*: two sections called "A"
   *  are the same material, which is how a lead sheet writes a form. */
  label: string;
  /** The pattern this section was recognised by, as chord tokens (for the UI). */
  pattern: string[];
  /** Rounded bar count of ONE pass (`endBeat - startBeat`), never of the run. */
  bars: number;
}

export interface Segmentation {
  sections: DetectedSection[];
  /** Beats covered by the source section, for the caller to sanity-check. */
  totalBeats: number;
  /** Total bars before and after, so a UI can show what the split will do. */
  barsBefore: number;
  barsAfter: number;
}

interface Cell {
  token: string;
  start: number;
  end: number;
}

interface Block {
  /** Token sequence — the identity of the pattern. */
  tokens: string[];
  /** Cell indices where this exact block starts. */
  positions: number[];
  length: number;
}

interface Claim {
  key: string;
  startCell: number;
  length: number;
  repeats: number;
}

/** Longest block worth calling a pattern. Beyond this it is a movement, not
 *  a section, and the user is better served by the unique-run chunking. */
const MAX_TILE_CELLS = 24;

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10,
  B: 11, Cb: 11,
};

/** `A#` and `B♭` are the same chord however the chart spells it. */
function pitchClass(root: string): string {
  const key = root.replace("♯", "#").replace("♭", "b").trim();
  const value = PITCH_CLASS[key];
  return value === undefined ? key.toLowerCase() : String(value);
}

export function chordToken(chord: Pick<Chord, "root" | "quality">): string {
  return `${pitchClass(chord.root)}:${chord.quality}`;
}

function cellsOf(chords: readonly Chord[]): Cell[] {
  const cells: Cell[] = [];
  let beat = 0;
  for (const chord of chords) {
    const beats = Math.max(0.25, chord.beats ?? 4);
    const token = chordToken(chord);
    const last = cells[cells.length - 1];
    // Fold a chord repeated in place into the cell that is already there.
    if (last && last.token === token && Math.abs(last.end - beat) < 0.001) last.end = beat + beats;
    else cells.push({ token, start: beat, end: beat + beats });
    beat += beats;
  }
  return cells;
}

function tileBeats(cells: readonly Cell[], from: number, length: number): number {
  return cells[from + length - 1].end - cells[from].start;
}

function sameDurations(cells: readonly Cell[], a: number, b: number, length: number): boolean {
  for (let k = 0; k < length; k++) {
    const left = cells[a + k];
    const right = cells[b + k];
    if (Math.abs(left.end - left.start - (right.end - right.start)) > 0.001) return false;
  }
  return true;
}

/** How often `span` occurs in `tokens`, overlaps included. */
function spanOccurrences(tokens: readonly string[], span: readonly string[]): number {
  let count = 0;
  for (let start = 0; start + span.length <= tokens.length; start++) {
    let hit = true;
    for (let k = 0; k < span.length; k++) {
      if (tokens[start + k] !== span[k]) {
        hit = false;
        break;
      }
    }
    if (hit) count += 1;
  }
  return count;
}

/**
 * Every chord block that occurs at least twice, closed to its longest form.
 *
 * Closure is what makes this usable: `Dm`, `Dm B♭` and `Dm B♭ C` all occur
 * wherever the riff does, so without it the shortest one wins on count and
 * every section becomes a single chord.
 */
function repeatedBlocks(cells: readonly Cell[], minBlockBeats: number): Block[] {
  const n = cells.length;
  const open = new Map<string, number[]>();
  const limit = Math.min(MAX_TILE_CELLS, Math.floor(n / 2));
  for (let length = 1; length <= limit; length++) {
    for (let start = 0; start + length <= n; start++) {
      let key = cells[start].token;
      for (let k = 1; k < length; k++) key += ` ${cells[start + k].token}`;
      const positions = open.get(key);
      if (positions) positions.push(start);
      else open.set(key, [start]);
    }
  }

  // No closure pass: a block that extends past a section boundary ("the whole
  // bridge plus the riff after it") has the same support as its prefix but a
  // bigger coverage, so it would out-rank the prefix and then fail to claim
  // (the riff is already taken), fragmenting the bridge into stumps. Leaving
  // every length in the candidate list lets the ranking try the long form
  // first and fall back to the honest prefix.
  const blocks: Block[] = [];
  for (const [key, positions] of open) {
    if (positions.length < 2) continue;
    const tokens = key.split(" ");
    const length = tokens.length;
    if (tileBeats(cells, positions[0], length) < minBlockBeats - 0.001) continue;
    blocks.push({ tokens, positions, length });
  }
  return blocks;
}

/**
 * Neighbouring sections of the SAME material usually split only because one
 * pass had slightly different durations — `sameDurations` refuses to fold
 * those into `repeats`, so a vamp that plays 4-6-4 bars reads as three
 * sections that look alike. Stitching them is only honest while the stitched
 * span still turns up more than once: then it is the real unit and the user
 * gets one section instead of look-alikes they have to merge by hand.
 */
function coarsenSameMaterial(sections: readonly Claim[], tokens: readonly string[]): Claim[] {
  const covered = (claim: Claim) => claim.length * claim.repeats;
  const result: Claim[] = [];
  let index = 0;
  while (index < sections.length) {
    let current = sections[index];
    let next = index;
    while (next + 1 < sections.length && sections[next + 1].key === current.key) {
      const length = covered(current) + covered(sections[next + 1]);
      const joined = tokens.slice(current.startCell, current.startCell + length);
      if (spanOccurrences(tokens, joined) < 2) break;
      current = { key: current.key, startCell: current.startCell, length, repeats: 1 };
      next += 1;
    }
    result.push(current);
    index = next + 1;
  }
  return result;
}

/** Longest unit of sections worth calling a cycle. Beyond this the "cycle" is
 *  the whole song, which the user can already see. */
const MAX_CYCLE_UNITS = 8;

/**
 * Two neighbouring sections that come back as a pair are a *cycle*, not six
 * sections: `A B A B A B` is "A B ×3". This is the reading a long loop needs —
 * `repeatedBlocks` never proposes it because a cycle of 26 chords runs past
 * `MAX_TILE_CELLS`, so the detector only ever sees the pieces inside it.
 *
 * The comparison is over the CHORD CELLS, not over the detected pieces: a
 * cycle boundary rarely lines up with a fragment boundary (the leftover chord
 * at the end of a pass lands in its own little section), and comparing pieces
 * would miss a cycle that is plainly there. Only units whose every copy
 * matches chord for chord *and* beat for beat are stitched, because `repeats`
 * means the same thing again — Layla's block stays six sections precisely
 * because its three passes are 57/51/51 beats, not 51/51/51.
 */
function coarsenCycles(sections: readonly Claim[], tokens: readonly string[], cells: readonly Cell[]): Claim[] {
  const covered = (claim: Claim) => claim.length * claim.repeats;
  // One boundary per claim PLUS the end of the last one: the copies check has
  // to read `starts[n]` to know how many cells the final copy covers.
  const starts: number[] = [];
  let cursor = 0;
  for (const section of sections) {
    starts.push(cursor);
    cursor += covered(section);
  }
  starts.push(cursor);

  const sameSpan = (a: number, b: number, length: number): boolean => {
    if (b + length > tokens.length) return false;
    for (let k = 0; k < length; k++) {
      if (tokens[a + k] !== tokens[b + k]) return false;
    }
    return sameDurations(cells, a, b, length);
  };

  const result: Claim[] = [];
  let index = 0;
  while (index < sections.length) {
    let best: { unit: number; copies: number; cells: number } | null = null;
    const limit = Math.min(MAX_CYCLE_UNITS, Math.floor((sections.length - index) / 2));
    for (let unit = 2; unit <= limit; unit++) {
      const span = starts[index + unit] - starts[index];
      if (span <= 0) continue;
      // A copy only counts if the detected pieces split it the same way: the
      // emitted claim repeats `span` cells, so a copy that is the same music
      // but a different number of cells would silently drop chords.
      const aligned = (count: number) => starts[index + unit * count] - starts[index] === span * count;
      let copies = 1;
      while (
        index + unit * (copies + 1) <= sections.length &&
        aligned(copies + 1) &&
        sameSpan(starts[index], starts[index + unit * copies], span)
      ) {
        copies += 1;
      }
      if (copies < 2) continue;
      const total = span * copies;
      if (!best || total > best.cells || (total === best.cells && copies > best.copies)) {
        best = { unit, copies, cells: total };
      }
    }
    if (!best) {
      result.push(sections[index]);
      index += 1;
      continue;
    }
    const span = starts[index + best.unit] - starts[index];
    result.push({
      key: tokens.slice(starts[index], starts[index] + span).join(" "),
      startCell: sections[index].startCell,
      length: span,
      repeats: best.copies,
    });
    index += best.unit * best.copies;
  }
  return result;
}

function labelAt(occurrence: number): string {
  const letter = String.fromCharCode(65 + (occurrence % 26));
  const round = Math.floor(occurrence / 26);
  return round === 0 ? letter : `${letter}${round + 1}`;
}

/**
 * Split a chord stream into the sections it is actually made of.
 *
 * Returns sections that cover `[0, totalBeats)` exactly, in order: a run of
 * identical tiles becomes ONE section carrying `repeats`, so 20 passes of a
 * three-chord riff read as "A ×20" instead of twenty copies.
 *
 * Two readings keep the result at section scale rather than phrase scale:
 * neighbouring sections of the same material are stitched while the stitched
 * span still recurs (a vamp that plays 4-4-5 bars is one section, not three
 * look-alikes), and anything under two bars is folded into the section before
 * it.
 */
export function segmentChordStream(
  chords: readonly Chord[],
  options: SegmentationOptions,
): Segmentation {
  const beatsPerBar = Math.max(1, options.beatsPerBar);
  const cells = cellsOf(chords);
  const totalBeats = cells.length ? cells[cells.length - 1].end : 0;
  const minBlockBeats = Math.max(1, options.minBlockBeats ?? beatsPerBar * 2);
  const collapseCycles = options.collapseCycles ?? true;
  const maxRunBeats = Math.max(beatsPerBar, (options.maxRunBars ?? 16) * beatsPerBar);
  // Always whole bars, never fewer than the content needs: a section whose
  // chords stop mid-bar still has to cover them.
  const bars = (beats: number) => Math.max(1, Math.ceil(beats / beatsPerBar - 0.001));

  if (cells.length === 0) {
    return { sections: [], totalBeats: 0, barsBefore: 0, barsAfter: 0 };
  }

  // Most-repeated block wins the argument: the riff that turns up nine times
  // is a more fundamental unit than the twenty-six bars that happen to
  // contain two of it. Ties break towards the longer total coverage.
  const ranked = repeatedBlocks(cells, minBlockBeats).sort((left, right) => {
    if (right.positions.length !== left.positions.length) return right.positions.length - left.positions.length;
    return tileBeats(cells, right.positions[0], right.length) - tileBeats(cells, left.positions[0], left.length);
  });

  const claimed = new Array<boolean>(cells.length).fill(false);
  const claims: Claim[] = [];
  for (const block of ranked) {
    const key = block.tokens.join(" ");
    for (const position of block.positions) {
      let free = true;
      for (let k = 0; k < block.length; k++) if (claimed[position + k]) free = false;
      if (!free) continue;
      for (let k = 0; k < block.length; k++) claimed[position + k] = true;
      claims.push({ key, startCell: position, length: block.length, repeats: 1 });
    }
  }
  claims.sort((left, right) => left.startCell - right.startCell);

  /** Unclaimed material, cut up so it can never become one unbounded block. */
  const uniqueRuns = (from: number, to: number): Claim[] => {
    const runs: Claim[] = [];
    let start = from;
    while (start < to) {
      let end = start;
      let beats = 0;
      while (end < to) {
        beats += cells[end].end - cells[end].start;
        end += 1;
        if (beats >= maxRunBeats) break;
      }
      runs.push({ key: `unique:${start}`, startCell: start, length: end - start, repeats: 1 });
      start = end;
    }
    return runs;
  };

  // Walk the stream: gaps become their own sections, and adjacent passes of
  // the same block (same tokens AND same lengths) become one section with
  // `repeats` — the only form the schema can express.
  const sections: Claim[] = [];
  let cursor = 0;
  let index = 0;
  while (index < claims.length) {
    const claim = claims[index];
    if (claim.startCell > cursor) sections.push(...uniqueRuns(cursor, claim.startCell));
    let repeats = 1;
    let next = index + 1;
    while (next < claims.length) {
      const following = claims[next];
      const expected = claim.startCell + claim.length * repeats;
      if (following.startCell !== expected || following.key !== claim.key) break;
      if (!sameDurations(cells, claim.startCell, expected, claim.length)) break;
      repeats += 1;
      next += 1;
    }
    sections.push({ ...claim, repeats });
    cursor = claim.startCell + claim.length * repeats;
    index = next;
  }
  if (cursor < cells.length) sections.push(...uniqueRuns(cursor, cells.length));

  const tokens = cells.map((cell) => cell.token);
  const stitched = coarsenSameMaterial(sections, tokens);
  const coarsened = collapseCycles ? coarsenCycles(stitched, tokens, cells) : stitched;

  // Letters follow first appearance of a *pattern*: a returning section wears
  // the letter of the material it is made of, exactly as a chart would note it.
  const labels = new Map<string, string>();
  const detected: DetectedSection[] = coarsened.map((section) => {
    let label = labels.get(section.key);
    if (!label) {
      label = labelAt(labels.size);
      labels.set(section.key, label);
    }
    const startBeat = cells[section.startCell].start;
    const endBeat = cells[section.startCell + section.length - 1].end;
    return {
      startBeat,
      endBeat,
      repeats: section.repeats,
      label,
      pattern: cells.slice(section.startCell, section.startCell + section.length).map((cell) => cell.token),
      bars: bars(endBeat - startBeat),
    };
  });

  // Anything shorter than two bars is a leftover — a chord the neighbouring
  // pattern happened to include, or the tail of a truncated phrase — not a
  // section. Fold it into the section before it. Only into one that plays
  // once: extending a repeated section's span would repeat the sliver too.
  const merged: DetectedSection[] = [];
  for (const section of detected) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.repeats === 1 &&
      section.repeats === 1 &&
      section.endBeat - section.startBeat < beatsPerBar * 2 - 0.001
    ) {
      previous.endBeat = section.endBeat;
      previous.bars = bars(previous.endBeat - previous.startBeat);
      previous.pattern = [...previous.pattern, ...section.pattern];
      continue;
    }
    merged.push({ ...section });
  }

  return {
    sections: merged,
    totalBeats,
    barsBefore: bars(totalBeats),
    barsAfter: merged.reduce((sum, section) => sum + section.bars * section.repeats, 0),
  };
}
