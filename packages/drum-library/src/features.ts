import { isBrightCymbal } from "./limbs.js";
import type { DrumNote, FeelFeatures } from "./types.js";

/**
 * Feel is measured against a 16th-note grid. E-GMD is human performance, so
 * essentially nothing lands exactly on it — that error *is* the signal, and
 * every axis below is some summary of how the playing departs from metronomic.
 */
const GRID = 0.25;

const EMPTY: FeelFeatures = {
  push: 0,
  looseness: 0,
  dynamics: 0,
  density: 0,
  syncopation: 0,
  swing: 0.5,
  weight: 0,
  brightness: 0,
  motion: 0,
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Signed distance to the nearest 16th, in beats. Negative = behind the beat. */
function gridOffset(beat: number): number {
  return beat - Math.round(beat / GRID) * GRID;
}

/**
 * Metric weakness of a position, 0 (bar downbeat) to 1 (16th offbeat). Used
 * to weight syncopation: energy on a downbeat is grounding, the same energy
 * on a 16th offbeat pushes against the pulse.
 */
function weakness(beatInBar: number): number {
  const sixteenth = Math.round(beatInBar / GRID);
  if (sixteenth === 0) return 0;
  if (sixteenth % 4 === 0) return 0.3;
  if (sixteenth % 2 === 0) return 0.7;
  return 1;
}

/**
 * Measure the eight feel axes for one limb's notes over a span.
 *
 * `notes` must be positioned relative to the start of the span, and
 * `lengthBars`/`beatsPerBar` describe that span — a 6/8 bar is 3 beats, so
 * bar-relative maths has to go through `beatsPerBar` rather than assume 4.
 */
export function measureFeel(notes: DrumNote[], lengthBars: number, beatsPerBar: number): FeelFeatures {
  if (notes.length === 0 || lengthBars <= 0) return { ...EMPTY };

  const offsets = notes.map((note) => gridOffset(note.beat));
  const velocities = notes.map((note) => note.velocity);
  const totalVelocity = velocities.reduce((sum, value) => sum + value, 0);

  // Syncopation: velocity-weighted share of energy on weak metric positions.
  let weakEnergy = 0;
  for (const note of notes) {
    const beatInBar = ((note.beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    weakEnergy += note.velocity * weakness(beatInBar);
  }
  const syncopation = totalVelocity > 0 ? weakEnergy / totalVelocity : 0;

  // Swing: where the "and" actually sits inside its beat. Only notes nearer
  // the offbeat than either surrounding downbeat are considered, so straight
  // 16th runs don't drag the figure toward 0.5 and mask a real shuffle.
  const offbeatPositions: number[] = [];
  for (const note of notes) {
    const withinBeat = note.beat - Math.floor(note.beat);
    if (withinBeat > 0.3 && withinBeat < 0.7) offbeatPositions.push(withinBeat);
  }
  const swing = offbeatPositions.length > 0 ? mean(offbeatPositions) : 0.5;

  // Weight: how hard the hits that land on the pulse are struck.
  const onBeatVelocities = notes
    .filter((note) => Math.abs(gridOffset(note.beat)) < GRID / 2 && Math.round(note.beat / GRID) % 4 === 0)
    .map((note) => note.velocity);
  const weight = onBeatVelocities.length > 0 ? mean(onBeatVelocities) / 127 : 0;

  // Brightness is only meaningful where there are cymbals to be bright.
  const cymbals = notes.filter((note) => isBrightCymbal(note.pitch) || isCymbalCandidate(note.pitch));
  const brightness =
    cymbals.length > 0 ? cymbals.filter((note) => isBrightCymbal(note.pitch)).length / cymbals.length : 0;

  return {
    push: mean(offsets),
    looseness: stdev(offsets),
    dynamics: stdev(velocities) / 127,
    density: notes.length / lengthBars,
    syncopation,
    swing,
    weight,
    brightness,
    motion: measureMotion(notes, lengthBars, beatsPerBar),
  };
}

/**
 * Identity of a pattern with its feel removed: onsets snapped to the 16th
 * grid, paired with voice, deduplicated and ordered. Two performances of the
 * same groove produce the same key despite differing in every actual
 * timestamp and velocity — which is the point, since that difference is what
 * we want to preserve *underneath* a shared rhythm rather than treat as two
 * unrelated patterns.
 */
export function rhythmKeyOf(notes: DrumNote[]): string {
  const positions = new Set<string>();
  for (const note of notes) {
    positions.add(`${Math.round(note.beat / GRID)}.${note.pitch}`);
  }
  return [...positions].sort().join(",");
}

/** Cymbal voices, bright or otherwise — the denominator for `brightness`. */
function isCymbalCandidate(pitch: number): boolean {
  return pitch === 22 || pitch === 42 || pitch === 51 || pitch === 53 || pitch === 59;
}

/**
 * How much the pattern changes bar to bar, 0 (identical loop) to 1 (every
 * bar different). Compares quantised (position, voice) sets so that human
 * timing jitter doesn't register as variation — only actual note choices do.
 */
function measureMotion(notes: DrumNote[], lengthBars: number, beatsPerBar: number): number {
  const barCount = Math.floor(lengthBars);
  if (barCount < 2) return 0;

  const bars: Set<string>[] = Array.from({ length: barCount }, () => new Set<string>());
  for (const note of notes) {
    const barIndex = Math.floor(note.beat / beatsPerBar);
    if (barIndex < 0 || barIndex >= barCount) continue;
    const beatInBar = note.beat - barIndex * beatsPerBar;
    bars[barIndex].add(`${Math.round(beatInBar / GRID)}:${note.pitch}`);
  }

  const similarities: number[] = [];
  for (let i = 0; i + 1 < barCount; i++) {
    const a = bars[i];
    const b = bars[i + 1];
    if (a.size === 0 && b.size === 0) continue;
    let shared = 0;
    for (const key of a) if (b.has(key)) shared++;
    const union = a.size + b.size - shared;
    similarities.push(union > 0 ? shared / union : 0);
  }

  if (similarities.length === 0) return 0;
  return 1 - mean(similarities);
}
