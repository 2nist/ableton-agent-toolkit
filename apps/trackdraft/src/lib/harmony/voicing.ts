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

/** Human name for the tone in the bass (0 = root). */
export function bassName(inversion: number): string {
  if (inversion <= 0) return "root";
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
