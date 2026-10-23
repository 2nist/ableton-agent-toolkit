/**
 * Chord voicing controls — the small state machine behind the voicing lane.
 *
 * A voicing has two independent parts, each one click away in the UI:
 * which chord tone sits in the bass (the inversion) and whether the upper
 * voices are stacked close or spread open. Both are stored minimally: root
 * position + close spacing is the default, so it is simply absent from the
 * chord rather than written as `{inversion: 0}` — a song that never touched
 * the lane keeps exactly the JSON it had before.
 *
 * The musical effect lives in `@music-theory/core`'s `voiceChord`, which every
 * planner calls; this module only decides what the buttons do.
 */

import { getChordIntervals } from "@music-theory/core";
import type { ChordVoicing } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

/** How many bass tones the chord has — a triad has three (R, 1, 2). */
export function inversionCount(chord: Pick<Chord, "quality">): number {
  return Math.max(1, getChordIntervals(chord.quality).length);
}

/** Semitone → the chord tone's name, for naming what ends up in the bass. */
const TONE_NAMES: Record<number, string> = {
  0: "root",
  2: "second",
  3: "third",
  4: "third",
  5: "fourth",
  6: "fifth",
  7: "fifth",
  8: "fifth",
  9: "sixth",
  10: "seventh",
  11: "seventh",
  13: "♭9",
  14: "ninth",
  15: "♯9",
  17: "eleventh",
  18: "♯11",
  20: "♭13",
  21: "thirteenth",
};

/** Human name for the tone in the bass (0 = root). Pass the quality when
 *  you have it: a five-note chord's fourth inversion puts its **ninth** in
 *  the bass, and "fourth" would be a lie. Without a quality this falls back
 *  to positional names, which is what it always returned. */
export function bassName(inversion: number, quality?: Chord["quality"]): string {
  if (inversion <= 0) return "root";
  if (quality) {
    const intervals = getChordIntervals(quality);
    const semitones = intervals[inversion % intervals.length];
    const name = semitones === undefined ? undefined : TONE_NAMES[semitones];
    if (name) return name;
  }
  return ["first", "second", "third", "fourth"][inversion - 1] ?? `${inversion}th`;
}

/** Normalize a voicing, dropping the defaults so untouched chords stay clean. */
export function normalizeVoicing(voicing: ChordVoicing | undefined): ChordVoicing | undefined {
  const clean: ChordVoicing = {
    ...(voicing?.inversion ? { inversion: voicing.inversion } : {}),
    ...(voicing?.spread === "open" ? { spread: "open" as const } : {}),
  };
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Set a chord's voicing, dropping it entirely when it is the default. */
export function withVoicing(chord: Chord, voicing: ChordVoicing | undefined): Chord {
  return { ...chord, voicing: normalizeVoicing(voicing) };
}

/** Cycle the bass tone: root → 1st → 2nd → … → root. */
export function cycleInversion(chord: Chord): Chord {
  const next = ((chord.voicing?.inversion ?? 0) + 1) % inversionCount(chord);
  return withVoicing(chord, { ...chord.voicing, inversion: next });
}

/** Toggle close ↔ open spacing. */
export function toggleSpread(chord: Chord): Chord {
  const spread = chord.voicing?.spread === "open" ? "close" : "open";
  return withVoicing(chord, { ...chord.voicing, spread });
}

/** Compact readout for tooltips: "root · close", "first · open". */
export function voicingLabel(chord: Pick<Chord, "voicing">): string {
  const inversion = chord.voicing?.inversion ?? 0;
  const spread = chord.voicing?.spread ?? "close";
  return `${bassName(inversion)} · ${spread}`;
}
