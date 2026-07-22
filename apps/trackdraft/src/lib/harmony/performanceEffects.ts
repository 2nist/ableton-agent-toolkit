/* ============================================================
   PERFORMANCE EFFECTS — deterministic per-chord articulation
   transforms, following the vary.ts / groove.ts shape.

   Each transform is a pure function:
     (notes: NoteDescription[], params, options) => NoteDescription[]

   Deterministic: seeded by chord/step id (not Math.random()),
   so re-opening a song doesn't audibly change authored strums.

   Called from two places:
     · chordClips.ts  — Abelton export (MIDI NoteDescription[])
     · audioPreview.ts — WebAudio preview (frequencies via
       planChordPerformanceFreqs, which returns staggered start
       times + velocity scaling for the PreviewPlayer to apply)
   ============================================================ */

import type { ChordPerformanceEffect } from "../../types/blueprint";

/* ---------------------------------------------------------------
   TYPES
   --------------------------------------------------------------- */

/** A lightweight note descriptor used by both the export pipeline
 *  (chordClips.ts / bassLine.ts) and this transform.  We avoid
 *  importing @ableton-extensions/sdk's NoteDescription to keep
 *  the harmony lib free of SDK deps; callers convert at the edge. */
export interface PerfNote {
  pitch: number;
  startTime: number; // beats
  duration: number;  // beats
  velocity: number;  // 0-127
}

export interface PerfOptions {
  /** Deterministic seed — pass the chord.id. */
  seed: string;
}

/* ---------------------------------------------------------------
   SEEDED RNG (mulberry32, same as drum-library/src/vary.ts)
   --------------------------------------------------------------- */

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------
   STRUM
   --------------------------------------------------------------- */

/** Strum-spread: notes are staggered outward from the lowest pitch
 *  (first note) instead of sounding simultaneously.  Default
 *  strumMs=40 gives a quick arpeggiated feel. */
export function applyStrum(
  notes: PerfNote[],
  effect: ChordPerformanceEffect,
  options: PerfOptions,
): PerfNote[] {
  if (notes.length < 2) return notes;
  const rng = mulberry32(hashSeed(options.seed));
  const strumMs = (effect.params?.strumMs ?? 150) * (1 + (rng() - 0.5) * 0.1); // ±5% humanisation
  const strumBeats = strumMs / 1000; // convert to beats (approximate — caller should pass actual tempo for precision)
  const interval = strumBeats / Math.max(1, notes.length - 1);

  return notes
    .slice()
    .sort((a, b) => a.pitch - b.pitch)
    .map((n, i) => ({
      ...n,
      startTime: n.startTime + i * interval,
      duration: n.duration - i * interval, // compensate so last note doesn't overhang
      velocity: Math.min(127, n.velocity + Math.round((rng() - 0.5) * 8)),
    }));
}

/* ---------------------------------------------------------------
   PULSE (re-trigger / tremolo)
   --------------------------------------------------------------- */

/** Tremolo re-trigger: each note in the chord is split into
 *  `subdivision` equal-duration hits across the original note's span.
 *  subdivision=4 produces 4 hits per note (16th-note tremolo on a
 *  quarter-note chord).  Velocities follow a triangle wave (0→1→0)
 *  across the re-trigger cycle, with seeded humanisation so every
 *  bar of a looping section doesn't sound copy-paste identical. */
export function applyPulse(
  notes: PerfNote[],
  effect: ChordPerformanceEffect,
  options: PerfOptions,
): PerfNote[] {
  if (notes.length === 0) return notes;
  const rng = mulberry32(hashSeed(options.seed));
  const subdivision = effect.params?.subdivision ?? 4;
  const hitDuration = notes[0].duration / subdivision;

  return notes
    .flatMap((n) => {
      const hits: PerfNote[] = [];
      for (let i = 0; i < subdivision; i++) {
        // Triangle wave: 0→1→0 across [0, subdivision-1]
        const position = i / Math.max(1, subdivision - 1);
        const factor = 1 - Math.abs(position - 0.5) * 2;
        const velocity = Math.max(1, Math.min(127, Math.round(
          n.velocity * (0.6 + factor * 0.4) + (rng() - 0.5) * 8,
        )));
        hits.push({
          pitch: n.pitch,
          startTime: n.startTime + i * hitDuration,
          duration: hitDuration,
          velocity,
        });
      }
      return hits;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/* ---------------------------------------------------------------
   ARPEGGIATOR
   --------------------------------------------------------------- */

/** Arpeggiator: cycles through chord notes one at a time at a
 *  `subdivision` rate across the chord's full duration, low-to-high.
 *  subdivision=4 (default) gives 16th-note steps on a quarter-note chord:
 *  a 3-note triad becomes 4 single-note hits cycling C→E→G→C. */
export function applyArp(
  notes: PerfNote[],
  effect: ChordPerformanceEffect,
  options: PerfOptions,
): PerfNote[] {
  if (notes.length === 0) return notes;
  const rng = mulberry32(hashSeed(options.seed));
  const subdivision = effect.params?.subdivision ?? 4;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const stepDuration = notes[0].duration / subdivision;
  const hits: PerfNote[] = [];

  for (let i = 0; i < subdivision; i++) {
    const note = sorted[i % sorted.length];
    hits.push({
      pitch: note.pitch,
      startTime: notes[0].startTime + i * stepDuration,
      duration: stepDuration,
      velocity: Math.max(1, Math.min(127, Math.round(
        note.velocity + (rng() - 0.5) * 8,
      ))),
    });
  }
  return hits;
}

/* ---------------------------------------------------------------
   DISPATCHER
   --------------------------------------------------------------- */

/** Apply a chord's performance effect (if any) to a note list.
 *  If `effect` is null/undefined, returns notes unchanged.
 *  The `seed` should be the chord's id for deterministic re-apply. */
export function applyPerformanceEffect(
  notes: PerfNote[],
  effect: ChordPerformanceEffect | undefined,
  seed: string,
): PerfNote[] {
  if (!effect) return notes;
  const options: PerfOptions = { seed };
  switch (effect.style) {
    case "strum":
      return applyStrum(notes, effect, options);
    case "pulse":
      return applyPulse(notes, effect, options);
    case "arp":
      return applyArp(notes, effect, options);
    default:
      return notes;
  }
}

/* ---------------------------------------------------------------
   CONVERTERS (for wiring into chordClips.ts / audioPreview.ts)
   --------------------------------------------------------------- */

import type { Chord } from "../../types/blueprint";

/** Convert an sdk NoteDescription[] to PerfNote[], apply the
 *  performance effect, then convert back.  This is the main
 *  entry point for chordClips.ts. */
export function applyChordPerformanceToNotes(
  notes: { pitch: number; startTime: number; duration: number; velocity: number }[],
  chord: Chord,
): { pitch: number; startTime: number; duration: number; velocity: number }[] {
  const perfNotes: PerfNote[] = notes.map((n) => ({
    pitch: n.pitch,
    startTime: n.startTime,
    duration: n.duration,
    velocity: n.velocity,
  }));
  const transformed = applyPerformanceEffect(perfNotes, chord.performance, chord.id);
  return transformed.map((n) => ({
    pitch: n.pitch,
    startTime: n.startTime,
    duration: n.duration,
    velocity: n.velocity,
  }));
}