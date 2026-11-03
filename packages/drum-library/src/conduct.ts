/**
 * Conducting a section: the same material, played on its own clock.
 *
 * `applyTimeDomain` maps *generated* hits — a kit's notes, which exist only
 * after a groove is resolved. Chords, melody and an authored bass line are
 * different: they are **stored**, in local beats, and every reader of them
 * (numerals, cell widths, the bass line, the .mid export, the Live bridge)
 * assumes song beats. Mapping them one consumer at a time is how §P3.5's bug
 * happened — thirty-odd readers, each of which has to remember.
 *
 * So the mapping happens once, at the boundary, and the rest of the system
 * never learns that clocks exist: `conductSection` returns the section with its
 * stored material already in song beats and its `timeDomain` cleared. Every
 * planner then reads it as an ordinary section on the song grid.
 *
 * **What it scales, and what it deliberately does not.** `rate` and `cycle` are
 * structural — a chord change is an event you can move. `phase`, `swing` and
 * `quantizeTo` are micro-timing for hits: nudging a chord change by a quarter
 * beat is a different feature (the jazz push, `syncopationOffset`), so harmony
 * conducts on `rate` + `cycle` only. Notes keep the full mapping, because a
 * swung melody is exactly what swing means.
 *
 * **Tiling is free.** A section's `chords` list is one pass through the
 * progression, and `loopChordsToFill` already repeats it to fill the span — so
 * double time (which halves each chord's span) fills the section with repeats
 * without a line of tiling code here.
 *
 * **An authored grid wins.** A section whose harmony follows a meter outline
 * (`harmonyMeterOutline`, or the drums' via `structural_warp`) has its chord
 * changes laid out by that grid, not by chord lengths — so conduction cannot
 * move them, and does not pretend to. Chord and bass still agree, because the
 * bass resolves from the same occurrences.
 */

import {
  applyTimeDomain,
  normaliseTimeDomain,
  type NormalDomain,
} from "./timeDomain.js";
import type { TimeDomain } from "@music-theory/song-blueprint";

/** The chord fields conducting scales. Structural, so this package stays
 *  decoupled from the blueprint schema (same reason `CycledChord` is). */
export interface ConductableChord {
  beats: number;
  /** Silence before this chord, in local beats. */
  restBefore?: number;
  /** Silence after this chord, in local beats. */
  restAfter?: number;
}

/** Anything with a start and a length, in local beats. */
export interface StoredNote {
  startTime: number;
  duration: number;
}

/** Guard against a chord that was written without a length. */
const spanOf = (chord: ConductableChord): number =>
  Number.isFinite(chord.beats) ? Math.max(0, chord.beats) : 0;

/**
 * The chord list as the clock plays it.
 *
 * Each chord's span is divided by `rate`, so a four-beat chord at half time
 * lasts eight global beats and at double time two — and because the resolver
 * loops the list to fill the section, double time simply repeats the
 * progression more often.
 */
export function conductChords<C extends ConductableChord>(
  chords: readonly C[],
  domain: NormalDomain,
): C[] {
  const scaled = chords.map((chord) => {
    const next = { ...chord, beats: spanOf(chord) / domain.rate };
    if (typeof chord.restBefore === "number" && chord.restBefore > 0) {
      next.restBefore = chord.restBefore / domain.rate;
    }
    if (typeof chord.restAfter === "number" && chord.restAfter > 0) {
      next.restAfter = chord.restAfter / domain.rate;
    }
    return next;
  });
  return domain.cycle > 0
    ? foldChords(scaled, domain.cycle / domain.rate)
    : scaled;
}

/** Keep the progression up to `limit` (in global beats), cutting the chord
 *  that straddles it — a loop is the first N local beats and nothing after. */
function foldChords<C extends ConductableChord>(
  chords: readonly C[],
  limit: number,
): C[] {
  const kept: C[] = [];
  let used = 0;
  for (const chord of chords) {
    const before = chord.restBefore ?? 0;
    const span = spanOf(chord);
    if (used + before + span > limit + 1e-6) {
      const room = limit - used - before;
      if (room > 1e-6) {
        kept.push({ ...chord, beats: room, restAfter: undefined });
      }
      break;
    }
    kept.push(chord);
    used += before + span + (chord.restAfter ?? 0);
    if (used >= limit - 1e-6) break;
  }
  return kept;
}

/** Notes through the full mapping — onsets, and lengths with them, so a
 *  half-time phrase lasts twice as long instead of becoming staccato. */
function conductNotes<N extends StoredNote>(
  notes: readonly N[],
  domain: NormalDomain,
  spanBeats: number,
): N[] {
  // Lengths are scaled BEFORE the mapping, so the mapping's clip to the
  // section end sees the real (stretched) length. Scaling afterwards put the
  // tail back over the boundary — a half-time phrase ended up a beat or two
  // into the next section.
  const scaled = notes.map((note) => ({
    ...note,
    beat: note.startTime,
    duration: note.duration / domain.rate,
  }));
  const mapped = applyTimeDomain(scaled, domain, spanBeats);
  return mapped.map(({ beat, ...rest }) => ({
    ...rest,
    startTime: beat,
  })) as unknown as N[];
}

/**
 * The section as its clock plays it: stored material in song beats, and no
 * `timeDomain` left to apply a second time.
 *
 * With no clock (or one that normalises to nothing) this returns the section
 * **itself** — same reference, so memo equality and "absent stays byte
 * identical" survive, and the common case costs a comparison.
 */
export function conductSection<
  C extends ConductableChord,
  N extends StoredNote,
  S extends {
    chords?: C[] | null;
    timeDomain?: TimeDomain | null;
    melody?: { notes: N[] } | null;
    bassNotes?: N[] | null;
  },
>(section: S, spanBeats: number): S {
  const domain = normaliseTimeDomain(section.timeDomain);
  if (!domain) return section;
  const span = Math.max(0, spanBeats);
  const next = { ...section };
  if (section.chords?.length) {
    next.chords = conductChords(section.chords, domain);
  }
  if (section.melody) {
    next.melody = {
      ...section.melody,
      notes: conductNotes(section.melody.notes, domain, span),
    };
  }
  if (section.bassNotes?.length) {
    next.bassNotes = conductNotes(section.bassNotes, domain, span);
  }
  delete next.timeDomain;
  return next;
}
