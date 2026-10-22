/**
 * Harmony and structure inferred from a melody.
 *
 * BiMMuDa and CoCoPops ship **monophonic melody annotations** — one note at a
 * time, no chords, no drums. There is no harmony track to read, so the only
 * way to get a progression out of them is to infer the harmony the line
 * implies. That is a guess, and every consumer of this module must present it
 * as one: the importer records it in `provenance.warnings`, never as extracted
 * fact.
 *
 * The method is deliberately conventional rather than clever, because a
 * predictable answer is easier to check by ear than a clever one:
 *
 *  1. Weight each pitch class by how long and how prominently it sounds
 *     (a downbeat note matters more than an offbeat passing tone).
 *  2. Score the seven diatonic triads (plus a dominant seventh on V) against
 *     that weight — chord tones earn, non-chord tones cost.
 *  3. Pick the best path through the bars with a transition prior, so the
 *     result reads as a progression (V→I, ii→V, repeats where a chord holds)
 *     rather than as eight independent guesses.
 */

import { noteName, pitchClass, SCALE_INTERVALS } from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import type { Chord, SectionRole } from "@music-theory/song-blueprint";

export interface MelodyNoteLike {
  pitch: number;
  /** Beats from the start of the file. */
  startTime: number;
  duration: number;
}

export interface InferredChord {
  degree: number;
  romanNumeral: string;
  quality: ChordQuality;
  /** Section-relative beat the chord starts on. */
  beat: number;
  beats: number;
  /** Fit score, for diagnostics and for choosing between readings. */
  score: number;
}

export interface InferOptions {
  keyName: NoteName;
  scale: ScaleType;
  beatsPerBar: number;
  totalBeats: number;
  /** How often a new chord may start. Defaults to one chord per bar. */
  windowBeats?: number;
}

const ROMAN_UPPER = ["I", "II", "III", "IV", "V", "VI", "VII"];
/** Relative weight of a note by its position in the bar: downbeat, the
 *  halfway point, then everything else. */
const METRIC_WEIGHT_STRONG = 1;
const METRIC_WEIGHT_HALF = 0.75;
const METRIC_WEIGHT_WEAK = 0.45;
/** A non-chord tone costs this much of the weight it carries. Melodies are
 *  full of passing tones, so this must stay well below 1 — but not so low
 *  that any chord fits any bar. */
const NON_CHORD_PENALTY = 0.45;
/** Sharing a pitch class with the melody's first note is weak evidence for a
 *  root, but it breaks ties between I and vi, or IV and ii. */
const ROOT_PRESENT_BONUS = 0.25;
/** Weight of the transition prior relative to chord fit. */
const TRANSITION_WEIGHT = 0.35;

interface Candidate {
  degree: number;
  /** Chord root in semitones above the tonic. */
  rootOffset: number;
  /** Chord tones in semitones above the root. */
  intervals: number[];
  quality: ChordQuality;
  romanNumeral: string;
}

/** Triad quality from stacked scale degrees, so a mode gets its own chords
 *  (dorian's IV is major, locrian's i is diminished). */
function triadFor(
  scaleIntervals: number[],
  degree: number,
): { rootOffset: number; intervals: number[]; quality: ChordQuality } {
  const at = (step: number) => {
    const raw = degree + step;
    return scaleIntervals[raw % 7] + 12 * Math.floor(raw / 7);
  };
  const root = at(0);
  const third = at(2) - root;
  const fifth = at(4) - root;
  const quality: ChordQuality =
    third === 4 && fifth === 7
      ? "maj"
      : third === 3 && fifth === 7
        ? "min"
        : third === 3 && fifth === 6
          ? "dim"
          : third === 4 && fifth === 8
            ? "aug"
            : "maj";
  return { rootOffset: root, intervals: [0, third, fifth], quality };
}

/** The diatonic chords of a key, plus a dominant seventh on V — the one
 *  non-triad every tonal melody leans on. */
export function diatonicCandidates(scale: ScaleType): Candidate[] {
  const scaleIntervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const candidates: Candidate[] = [];
  for (let degree = 0; degree < 7; degree++) {
    const { rootOffset, intervals, quality } = triadFor(scaleIntervals, degree);
    const isMinor = quality === "min" || quality === "dim";
    candidates.push({
      degree,
      rootOffset,
      intervals,
      quality,
      romanNumeral: isMinor ? ROMAN_UPPER[degree].toLowerCase() : ROMAN_UPPER[degree],
    });
  }
  const fifth = triadFor(scaleIntervals, 4);
  if (fifth.quality === "maj") {
    candidates.push({
      degree: 4,
      rootOffset: fifth.rootOffset,
      intervals: [0, 4, 7, 10],
      quality: "7",
      romanNumeral: "V7",
    });
  }
  return candidates;
}

/** Additive prior for one degree following another. Positive values are the
 *  moves that make a progression sound like a progression. */
function transitionScore(prev: number, next: number): number {
  if (prev === next) return 0.55;
  const table: Record<string, number> = {
    "0>4": 0.5, "4>0": 0.9, "0>3": 0.45, "3>0": 0.4, "0>5": 0.4, "5>3": 0.45,
    "1>4": 0.55, "4>5": 0.2, "5>0": 0.35, "3>4": 0.35, "2>3": 0.3, "3>5": 0.3,
    "6>0": 0.6, "4>3": 0.25, "5>4": 0.35, "1>0": 0.2,
  };
  return table[`${prev}>${next}`] ?? 0;
}

/** Duration- and accent-weighted pitch-class energies for one window. */
function windowWeights(
  melody: MelodyNoteLike[],
  from: number,
  to: number,
  beatsPerBar: number,
): number[] {
  const weights = new Array<number>(12).fill(0);
  for (const note of melody) {
    const end = note.startTime + Math.max(note.duration, 0.01);
    const overlap = Math.min(to, end) - Math.max(from, note.startTime);
    if (overlap <= 0) continue;
    const inBar = ((note.startTime % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const accent =
      inBar < 1e-6
        ? METRIC_WEIGHT_STRONG
        : Math.abs(inBar - beatsPerBar / 2) < 1e-6
          ? METRIC_WEIGHT_HALF
          : METRIC_WEIGHT_WEAK;
    weights[note.pitch % 12] += overlap * accent;
  }
  return weights;
}

function fitScore(
  candidate: Candidate,
  weights: number[],
  tonicPc: number,
  firstNotePc: number | null,
): number {
  const chordPcs = new Set(
    candidate.intervals.map((i) => (tonicPc + candidate.rootOffset + i) % 12),
  );
  let score = 0;
  for (let pc = 0; pc < 12; pc++) {
    if (weights[pc] === 0) continue;
    score += chordPcs.has(pc) ? weights[pc] : -NON_CHORD_PENALTY * weights[pc];
  }
  const rootPc = (tonicPc + candidate.rootOffset) % 12;
  if (firstNotePc != null && chordPcs.has(firstNotePc)) score += ROOT_PRESENT_BONUS;
  // Prefer a chord whose root the melody actually plays — the strongest
  // single signal a monophonic line gives about which chord is underneath.
  if (weights[rootPc] > 0) score += ROOT_PRESENT_BONUS;
  return score;
}

/**
 * Infer a chord per window, smoothed into a progression.
 *
 * Returns chords merged so a chord held across several bars appears once,
 * which is what the progression editor and every planner want.
 */
export function inferChordProgression(
  melody: MelodyNoteLike[],
  options: InferOptions,
): InferredChord[] {
  const { keyName, scale, beatsPerBar, totalBeats } = options;
  const windowBeats = options.windowBeats ?? beatsPerBar;
  if (melody.length === 0 || windowBeats <= 0 || totalBeats <= 0) return [];

  const candidates = diatonicCandidates(scale);
  const tonicPc = pitchClass(keyName);
  const windows: { from: number; to: number }[] = [];
  for (let from = 0; from < totalBeats - 1e-6; from += windowBeats) {
    windows.push({ from, to: Math.min(totalBeats, from + windowBeats) });
  }
  if (windows.length === 0) return [];

  const weightsPerWindow = windows.map(({ from, to }) =>
    windowWeights(melody, from, to, beatsPerBar),
  );

  // Viterbi over the candidate grid: best[window][candidateIndex].
  const scores: number[][] = [];
  const back: number[][] = [];
  for (let w = 0; w < windows.length; w++) {
    const weights = weightsPerWindow[w];
    const firstNote = melody.find(
      (n) => n.startTime >= windows[w].from - 1e-6 && n.startTime < windows[w].to + 1e-6,
    );
    const firstNotePc = firstNote ? firstNote.pitch % 12 : null;
    const row: number[] = [];
    const from: number[] = [];
    for (let c = 0; c < candidates.length; c++) {
      const fit = fitScore(candidates[c], weights, tonicPc, firstNotePc);
      if (w === 0) {
        // Opening the song on the tonic is a strong convention.
        row.push(fit + (candidates[c].degree === 0 ? 0.3 : 0));
        from.push(-1);
        continue;
      }
      let bestPrev = 0;
      let bestScore = -Infinity;
      for (let p = 0; p < candidates.length; p++) {
        const total = scores[w - 1][p] + TRANSITION_WEIGHT * transitionScore(candidates[p].degree, candidates[c].degree);
        if (total > bestScore) {
          bestScore = total;
          bestPrev = p;
        }
      }
      row.push(fit + bestScore);
      from.push(bestPrev);
    }
    scores.push(row);
    back.push(from);
  }

  // Traceback from the best final state, nudged toward ending on the tonic.
  let bestFinal = 0;
  let bestFinalScore = -Infinity;
  for (let c = 0; c < candidates.length; c++) {
    const total = scores[windows.length - 1][c] + (candidates[c].degree === 0 ? 0.4 : 0);
    if (total > bestFinalScore) {
      bestFinalScore = total;
      bestFinal = c;
    }
  }
  const path: number[] = new Array(windows.length);
  path[windows.length - 1] = bestFinal;
  for (let w = windows.length - 1; w > 0; w--) path[w - 1] = back[w][path[w]];

  // Merge runs of the same chord into one span.
  const merged: InferredChord[] = [];
  for (let w = 0; w < windows.length; w++) {
    const candidate = candidates[path[w]];
    const last = merged[merged.length - 1];
    if (last && last.degree === candidate.degree && last.quality === candidate.quality && last.romanNumeral === candidate.romanNumeral) {
      last.beats += windows[w].to - windows[w].from;
      continue;
    }
    merged.push({
      degree: candidate.degree,
      romanNumeral: candidate.romanNumeral,
      quality: candidate.quality,
      beat: windows[w].from,
      beats: windows[w].to - windows[w].from,
      score: scores[w][path[w]],
    });
  }
  return merged;
}

/** Inferred chords as blueprint chords (absolute roots for the given key). */
export function inferredChordsToBlueprint(
  inferred: InferredChord[],
  keyName: NoteName,
  scale: ScaleType,
): Chord[] {
  const scaleIntervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const tonicPc = pitchClass(keyName);
  return inferred.map((chord) => ({
    id: crypto.randomUUID(),
    romanNumeral: chord.romanNumeral,
    root: noteName((tonicPc + scaleIntervals[chord.degree]) % 12, keyName),
    quality: chord.quality,
    beats: Math.max(0.5, Math.round(chord.beats * 4) / 4),
  }));
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export interface InferredSection {
  /** Bar index this section starts at. */
  startBar: number;
  bars: number;
  /** Block label — identical labels mean the same musical material. */
  label: string;
  role: SectionRole;
}

/** One chord degree per bar — the token a repeated section repeats. */
function chordTokensByBar(
  inferred: InferredChord[],
  beatsPerBar: number,
  bars: number,
): (number | null)[] {
  const tokens: (number | null)[] = new Array(bars).fill(null);
  let index = 0;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar;
    while (
      index + 1 < inferred.length &&
      inferred[index + 1].beat <= barStart + 1e-6
    ) {
      index += 1;
    }
    const chord = inferred[index];
    // Only claim a token when a chord actually covers this bar.
    if (chord && chord.beat < barStart + beatsPerBar - 1e-6) tokens[bar] = chord.degree;
  }
  return tokens;
}

const BLOCK_SIMILARITY = 0.75;
/** Most blocks a structure may have. More than this is noise, not structure. */
const MAX_BLOCKS = 8;
/** Most distinct labels — a song needing a fifth letter has no repeating
 *  structure we can honestly claim. */
const MAX_DISTINCT_BLOCKS = 4;
/** Share of bars that must sit inside a repeated block. */
const MIN_REPEAT_COVERAGE = 0.34;

function tokenSimilarity(a: (number | null)[], b: (number | null)[]): number {
  let compared = 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    compared += 1;
    if (a[i] === b[i]) same += 1;
  }
  return compared === 0 ? 0 : same / compared;
}

export interface InferredSection {
  /** Bar index this section starts at. */
  startBar: number;
  bars: number;
  /** Block label — identical labels mean the same musical material. */
  label: string;
  role: SectionRole;
}

/**
 * Repeated-block structure, from the **chord** sequence rather than the
 * melody.
 *
 * A bare melody does not repeat cleanly enough to segment: pitch-class
 * histograms are near-identical across a tonal song (which collapsed every
 * block into one label) while bar-level fingerprints are so noisy that a 76-bar
 * song came out as 38 two-bar "sections". Harmonic loops are what actually
 * repeat in this repertoire — a verse IS its chord cycle — so the same
 * block-matching problem becomes tractable once chords have been inferred.
 *
 * A result is accepted only when blocks repeat and at least a third of the
 * song sits inside a repeat; otherwise this returns an empty list and the
 * importer keeps one honest full-song section. Labels are A/B/C — what the
 * evidence supports, never verse/chorus, which needs lyrics or an arrangement.
 */
export function inferSectionsFromChords(
  inferred: InferredChord[],
  options: { beatsPerBar: number; bars: number },
): InferredSection[] {
  const { beatsPerBar, bars } = options;
  if (inferred.length === 0 || bars < 16 || beatsPerBar <= 0) return [];
  const tokens = chordTokensByBar(inferred, beatsPerBar, bars);

  let best: { length: number; labels: string[] } | null = null;

  // Longest block first: a 16-bar section that repeats is stronger evidence
  // than four 4-bar quarters of it, so it wins whenever it qualifies.
  for (const length of [16, 8, 4]) {
    const count = Math.floor(bars / length);
    if (count < 2 || count > MAX_BLOCKS) continue;

    const blocks = Array.from({ length: count }, (_, i) => {
      const from = i * length;
      const to = i === count - 1 ? bars : from + length;
      return tokens.slice(from, to);
    });
    const labelOfBlock = new Array<number>(count).fill(-1);
    let distinct = 0;
    for (let i = 0; i < count; i++) {
      if (labelOfBlock[i] >= 0) continue;
      labelOfBlock[i] = distinct;
      for (let j = i + 1; j < count; j++) {
        if (labelOfBlock[j] < 0 && tokenSimilarity(blocks[i], blocks[j]) >= BLOCK_SIMILARITY) {
          labelOfBlock[j] = distinct;
        }
      }
      distinct += 1;
    }

    const repeated = count - distinct;
    const coverage = repeated / count;
    if (repeated < 1 || coverage < MIN_REPEAT_COVERAGE) continue;
    if (distinct > MAX_DISTINCT_BLOCKS) continue;

    if (!best || length > best.length) {
      best = { length, labels: labelOfBlock.map((id) => String.fromCharCode(65 + id)) };
    }
  }

  if (!best) return [];

  // Merge neighbouring blocks that share a label (A A B → one 2-block A, then
  // B): a repeated 4-bar pattern three times is one 12-bar section, and
  // reporting three would multiply every later edit.
  const merged: InferredSection[] = [];
  best.labels.forEach((label, index) => {
    const startBar = index * best!.length;
    const endBar = Math.min(bars, startBar + best!.length);
    const last = merged[merged.length - 1];
    if (last && last.label === label) {
      last.bars += endBar - startBar;
      return;
    }
    merged.push({ startBar, bars: endBar - startBar, label, role: "custom" as SectionRole });
  });
  return merged;
}
