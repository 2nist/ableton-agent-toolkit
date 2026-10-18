/**
 * Tonal centre — where the music thinks "home" is, beat by beat.
 *
 * The song carries one key/scale, and a section has none of its own, so a
 * modulation was unrepresentable: every chord in a section was measured
 * against the same tonic, which meant a move to the dominant still read as
 * "diatonic" and nothing could show on an axis built for exactly that.
 *
 * A **tonic region** is a run of the section with one home note. Inference
 * proposes them (Krumhansl-Kessler key profiles over the resolved chords,
 * the same profiles the audio key estimator uses); the author can overwrite
 * any boundary, and an authored boundary is marked so a later inference run
 * cannot silently move it. The *mode* is never inferred — it stays authored,
 * so inference only has to answer "which pitch class is home".
 */

import { getChordIntervals, noteName, pitchClass, SCALE_INTERVALS } from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";

export type TonicSource = "inferred" | "authored";

export interface TonicRegion {
  /** Section-relative beat where this home takes over (the first is always 0). */
  startBeat: number;
  key: NoteName;
  scale: ScaleType;
  source: TonicSource;
}

export interface TonicChordOccurrence {
  root: NoteName;
  quality: string;
  startTime: number;
  duration: number;
}

/** Krumhansl-Kessler probe-tone profiles. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Four bars of 4/4 — a key needs a few chords to establish itself (two is
 *  ambiguous: G–C fits both C and G), but not so many that a modulation is
 *  smeared across the join. */
export const DEFAULT_WINDOW_BEATS = 16;
/** Two bars — a shorter run is a passing chord, not a key change. */
export const DEFAULT_MIN_REGION_BEATS = 8;

const MAJOR_ISH: ReadonlySet<ScaleType> = new Set<ScaleType>(["ionian", "lydian", "mixolydian"]);

function profileFor(scale: ScaleType): number[] {
  return MAJOR_ISH.has(scale) ? MAJOR_PROFILE : MINOR_PROFILE;
}

/** Duration-weighted pitch-class histogram, roots counted double so a
 *  tonic-heavy progression doesn't lose to a chord-tone-rich one. */
function chromaBetween(
  chords: TonicChordOccurrence[],
  from: number,
  to: number,
): number[] {
  const chroma = new Array<number>(12).fill(0);
  for (const chord of chords) {
    const end = chord.startTime + chord.duration;
    const overlap = Math.min(to, end) - Math.max(from, chord.startTime);
    if (overlap <= 0) continue;
    const rootPc = pitchClass(chord.root);
    for (const interval of getChordIntervals(chord.quality as ChordQuality)) {
      chroma[(rootPc + interval) % 12] += interval === 0 ? overlap : overlap * 0.5;
    }
  }
  return chroma;
}

/** Every candidate home's fit for a chroma, in the section's mode. */
export function tonicScores(chroma: number[], scale: ScaleType): number[] {
  const profile = profileFor(scale);
  const scores = new Array<number>(12).fill(0);
  for (let tonic = 0; tonic < 12; tonic++) {
    let score = 0;
    for (let degree = 0; degree < 12; degree++) {
      score += chroma[(tonic + degree) % 12] * profile[degree];
    }
    scores[tonic] = score;
  }
  return scores;
}

/** The best-fitting home note for a chroma, in the section's mode. */
export function bestTonic(
  chroma: number[],
  scale: ScaleType,
): { pc: number; score: number } {
  const scores = tonicScores(chroma, scale);
  let best = { pc: 0, score: -Infinity };
  scores.forEach((score, pc) => {
    if (score > best.score) best = { pc, score };
  });
  return best;
}

/** A window's raw best fit is often ambiguous — G–C–D–G fits both G and D
 *  about equally well. Two tiebreaks, in order: stay where we already are
 *  (a modulation has to be clearly better, not merely equal), then prefer
 *  the chord we are actually sitting on (a progression loop normally lands
 *  on its own tonic). Both only apply when the candidate is close to the
 *  raw winner, so a real modulation still wins on merit. */
function chooseTonic(
  chroma: number[],
  scale: ScaleType,
  current: number | null,
  chordPc: number,
): number {
  const scores = tonicScores(chroma, scale);
  const raw = bestTonic(chroma, scale);
  const best = scores[raw.pc] || 1;
  const near = (pc: number, margin: number) => scores[pc] >= best * (1 - margin);
  if (current != null && near(current, 0.08)) return current;
  if (near(chordPc, 0.02)) return chordPc;
  return raw.pc;
}

/** The home note at one beat, using a window centred on it. */
function tonicAtBeat(
  chords: TonicChordOccurrence[],
  beat: number,
  scale: ScaleType,
  windowBeats: number,
  current: number | null,
  chordPc: number,
): number {
  const half = windowBeats / 2;
  const chroma = chromaBetween(chords, beat - half, beat + half);
  if (chroma.every((value) => value === 0)) {
    return chooseTonic(chromaBetween(chords, 0, Infinity), scale, current, chordPc);
  }
  return chooseTonic(chroma, scale, current, chordPc);
}

/**
 * Propose the tonic regions for a section's resolved chords (one entry per
 * occurrence, in time order). Returns at least one region; an empty
 * progression falls back to `fallbackKey`.
 */
export function inferTonicRegions(
  chords: TonicChordOccurrence[],
  options: {
    scale: ScaleType;
    fallbackKey: NoteName;
    windowBeats?: number;
    minRegionBeats?: number;
  },
): TonicRegion[] {
  const { scale, fallbackKey } = options;
  const windowBeats = options.windowBeats ?? DEFAULT_WINDOW_BEATS;
  const minRegionBeats = options.minRegionBeats ?? DEFAULT_MIN_REGION_BEATS;
  if (chords.length === 0) {
    return [{ startBeat: 0, key: fallbackKey, scale, source: "inferred" }];
  }

  // One pass: the local home at each chord onset, then runs of equal homes.
  const runs: { startBeat: number; pc: number; beats: number }[] = [];
  let end = 0;
  let current: number | null = null;
  for (const chord of chords) {
    const pc = tonicAtBeat(
      chords,
      chord.startTime,
      scale,
      windowBeats,
      current,
      pitchClass(chord.root),
    );
    current = pc;
    end = Math.max(end, chord.startTime + chord.duration);
    const last = runs[runs.length - 1];
    if (last && last.pc === pc) continue;
    runs.push({ startBeat: chord.startTime, pc, beats: chord.duration });
  }
  for (let i = 0; i < runs.length; i++) {
    runs[i].beats = (i + 1 < runs.length ? runs[i + 1].startBeat : end) - runs[i].startBeat;
  }

  // A short run is a passing chord: fold it into the run before it (a
  // leading run folds forward, so the first region always starts at 0).
  const kept: typeof runs = [];
  for (const run of runs) {
    if (kept.length === 0) {
      kept.push(run);
      continue;
    }
    const previous = kept[kept.length - 1];
    // A short run, or one that agrees with the home we already have (the
    // passing chord folded away), leaves the region in place.
    if (run.beats < minRegionBeats || run.pc === previous.pc) {
      previous.beats += run.beats;
      continue;
    }
    kept.push(run);
  }
  if (kept.length > 1) {
    const first = kept[0];
    if (first.beats < minRegionBeats) {
      first.pc = kept[1].pc;
      first.beats += kept[1].beats;
      kept.splice(1, 1);
    }
  }

  const regions = kept.map((run) => ({
    startBeat: run.startBeat,
    pc: run.pc,
  }));
  regions[0].startBeat = 0;
  return regions.map((region, index) => ({
    startBeat: region.startBeat,
    key: noteName(region.pc, index === 0 ? fallbackKey : undefined),
    scale,
    source: "inferred" as const,
  }));
}

/** The region covering `beat` (the last one that starts at or before it). */
export function resolveTonicAt(
  regions: TonicRegion[] | undefined,
  beat: number,
  fallback: { key: NoteName; scale: ScaleType },
): TonicRegion {
  const usable = (regions ?? []).slice().sort((a, b) => a.startBeat - b.startBeat);
  if (usable.length === 0) {
    return { startBeat: 0, key: fallback.key, scale: fallback.scale, source: "inferred" };
  }
  let found = usable[0];
  for (const region of usable) {
    if (region.startBeat <= beat + 1e-6) found = region;
  }
  return found;
}

/** Author a home at `startBeat` (or replace the one already there). The
 *  result keeps every other region, so inference can be corrected rather
 *  than thrown away. */
export function setTonicAt(
  regions: TonicRegion[] | undefined,
  region: { startBeat: number; key: NoteName; scale: ScaleType },
): TonicRegion[] {
  const existing = (regions ?? []).filter(
    (candidate) => Math.abs(candidate.startBeat - region.startBeat) > 1e-6,
  );
  const next = [...existing, { ...region, source: "authored" as const }].sort(
    (a, b) => a.startBeat - b.startBeat,
  );
  // A region authored at beat 0 replaces the implied default; anything else
  // still needs a starting home.
  if (next.length === 0 || next[0].startBeat > 1e-6) {
    next.unshift({
      startBeat: 0,
      key: next[0]?.key ?? region.key,
      scale: next[0]?.scale ?? region.scale,
      source: "inferred",
    });
  }
  return next;
}

/**
 * A chord root's place in a scale, as the hex model wants it: which degree,
 * and whether the root is a semitone below it (flat, -1) or above (sharp,
 * +1). An ambiguous semitone reads as a flat, matching the app's vocabulary
 * (♭II, ♭III, ♭VI, ♭VII) — with one exception: the raised fourth is spelled
 * ♯IV, because that is how a Lydian/borrowed fourth is actually written, and
 * otherwise the sharp side of the hex model could never fill.
 */
export function degreeRelativeTo(
  rootPc: number,
  tonicPc: number,
  scale: ScaleType,
): { deg: number; acc: number } {
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const relative = (((rootPc - tonicPc) % 12) + 12) % 12;
  const exact = intervals.indexOf(relative);
  if (exact >= 0) return { deg: exact, acc: 0 };

  let best = { deg: 0, acc: 0, distance: 13 };
  intervals.forEach((interval, deg) => {
    const above = (relative - interval + 12) % 12;
    const below = (interval - relative + 12) % 12;
    const candidates: { acc: number; distance: number }[] =
      above <= below
        ? [
            { acc: 1, distance: above },
            { acc: -1, distance: below },
          ]
        : [
            { acc: -1, distance: below },
            { acc: 1, distance: above },
          ];
    for (const candidate of candidates) {
      if (candidate.distance > best.distance) continue;
      if (candidate.distance === best.distance) {
        const prefersSharp = candidate.acc === 1 && deg === 3;
        const keepsFlat = candidate.acc === -1 && !(best.deg === 3 && best.acc === 1);
        if (!prefersSharp && !keepsFlat) continue;
      }
      best = { deg, acc: candidate.acc, distance: candidate.distance };
    }
  });
  return { deg: best.deg, acc: best.acc };
}
