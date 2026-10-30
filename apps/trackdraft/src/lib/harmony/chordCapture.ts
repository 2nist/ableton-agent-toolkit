/**
 * MIDI performance → authored progression.
 *
 * The chord pad records "this chord started on this beat of the section"
 * while the metronome runs. That is a performance, not a score: changes
 * land a hair early or late, the same chord gets re-struck, and a passing
 * chord can be a quarter-beat long. This module turns that stream into the
 * `Chord[]` the section stores:
 *
 * - consecutive repeats collapse into one chord;
 * - change points snap to the chosen grid (a beat by default) — the
 *   metronome is the reference, so playing slightly ahead still writes the
 *   downbeat you meant;
 * - each chord's `beats` is the gap to the next change, and the last chord
 *   fills the rest of the section;
 * - a take that starts just after the downbeat is pulled onto it, because
 *   attacking 40 ms late is what a human does, not a deliberate rest.
 *
 * Pure, so the mapping is testable with fake performances (no MIDI, no
 * transport, no wall clock).
 */

import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import { noteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { uuid } from "../uuid";
import { deriveEvent } from "./analysis";

/** One chord change as it was played: section-relative beat + the shape. */
export interface CapturedChordEvent {
  /** Section-relative beat the chord began on. */
  beat: number;
  rootPc: number;
  quality: ChordQuality;
}

/** A takedown that has already been quantized and given a duration. */
export interface CapturedChord {
  rootPc: number;
  quality: ChordQuality;
  /** Section-relative beat the chord starts on, on the grid. */
  startBeat: number;
  /** How long it holds — the gap to the next change, or the section end. */
  beats: number;
}

/** How a take is read back. */
export interface CaptureReadOptions {
  /** Choice of grid, in quarter-note beats (1 = a beat, 4 = a bar). */
  gridBeats?: number;
  /** Longest progression accepted — the same ceiling the chord import uses. */
  maxChords?: number;
  /** Section-relative beat the take ended on (keys released, or the
   *  transport stopped). The last chord ends here — so a four-bar cycle
   *  played in an eight-bar section stays four bars and loops, instead of
   *  stretching its final chord across the rest of the section. Omit and
   *  the last chord fills the section. */
  endBeat?: number;
}

const DEFAULT_GRID_BEATS = 1;
const DEFAULT_MAX_CHORDS = 32;
/** Below this a "chord change" is a slip, not a harmony. */
const MIN_CHORD_BEATS = 0.25;

function roundBeat(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Read a live take into a progression for a section `sectionBeats` long.
 *
 * Events outside the section (a chord still ringing from the count-in, or
 * a stray note after the loop came round) are ignored.
 */
export function buildCapturedProgression(
  events: readonly CapturedChordEvent[],
  sectionBeats: number,
  options: CaptureReadOptions = {},
): CapturedChord[] {
  if (sectionBeats <= 0 || events.length === 0) return [];
  const grid = Math.max(0.125, options.gridBeats ?? DEFAULT_GRID_BEATS);
  const maxChords = Math.max(1, options.maxChords ?? DEFAULT_MAX_CHORDS);

  const ordered = [...events]
    .filter((event) => Number.isFinite(event.beat))
    .sort((a, b) => a.beat - b.beat)
    .filter((event) => event.beat >= -1e-6 && event.beat < sectionBeats - 1e-6);

  // Collapse repeats first: holding a chord through three bars is one chord,
  // and re-striking it should not create three.
  const merged: CapturedChordEvent[] = [];
  for (const event of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && previous.rootPc === event.rootPc && previous.quality === event.quality) continue;
    merged.push(event);
  }

  const snapped: { startBeat: number; rootPc: number; quality: ChordQuality }[] = [];
  for (const event of merged) {
    let start = Math.round(event.beat / grid) * grid;
    // A chord attacked just after the downbeat is the downbeat.
    if (start < grid / 2) start = 0;
    start = Math.min(start, Math.max(0, sectionBeats - MIN_CHORD_BEATS));
    start = Math.max(0, roundBeat(start));
    if (snapped.length > 0 && start <= snapped[snapped.length - 1]!.startBeat + 1e-6) continue;
    snapped.push({ startBeat: start, rootPc: event.rootPc, quality: event.quality });
    if (snapped.length >= maxChords) break;
  }

  const captured: CapturedChord[] = [];
  snapped.forEach((entry, index) => {
    const last = index + 1 >= snapped.length;
    let end = last ? sectionBeats : snapped[index + 1]!.startBeat;
    if (last && options.endBeat !== undefined && Number.isFinite(options.endBeat)) {
      // Round the release to the nearest grid line but never shorten the
      // chord below one cell — a hand lifting slightly early is not a rest.
      const snappedEnd = Math.round(options.endBeat / grid) * grid;
      end = Math.min(sectionBeats, Math.max(entry.startBeat + grid, snappedEnd));
    }
    const beats = roundBeat(end - entry.startBeat);
    if (beats < MIN_CHORD_BEATS - 1e-6) return;
    captured.push({ ...entry, beats });
  });
  return captured;
}

export interface CaptureToChordsOptions extends CaptureReadOptions {
  keyName: NoteName;
  scale: ScaleType;
}

/** The same read, written as the section's `Chord[]` (roman numerals and all). */
export function captureToChords(
  events: readonly CapturedChordEvent[],
  sectionBeats: number,
  options: CaptureToChordsOptions,
): Chord[] {
  const captured = buildCapturedProgression(events, sectionBeats, options);
  if (captured.length === 0) return [];

  const chords: Chord[] = captured.map((entry) => ({
    id: uuid(),
    root: noteName(entry.rootPc, options.keyName),
    quality: entry.quality,
    beats: entry.beats,
    romanNumeral: "",
  }));

  // Numerals need the chord that follows (applied dominants read as V7/x),
  // so derive them once the whole progression exists.
  let startBeat = 0;
  return chords.map((chord, index) => {
    const derived = deriveEvent(chord, chords[index + 1] ?? null, {
      key: options.keyName,
      scale: options.scale,
      startBeat,
    });
    startBeat += chord.beats;
    return { ...chord, romanNumeral: derived.roman };
  });
}
