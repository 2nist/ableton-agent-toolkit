/**
 * Chord edits from the canvas (§S1).
 *
 * The harmony workspace can retype, re-quality, invert and delete a chord; the
 * canvas could only retype one. S1 put it plainly: *"the chords need the right
 * click menu the harmony view has"*. These are the three writes a right-click
 * needs, kept pure and out of the component so each is a test rather than a
 * handler with a `map` inside it.
 *
 * Every one of them goes through `updateSection`, so a chord edit on the canvas
 * is one undo step — the same as the same edit in the harmony view.
 */

import type { ChordQuality } from "@music-theory/core";
import type { BlueprintSection, Chord } from "../../types/blueprint";

/** The qualities a right-click offers. The seven a writer reaches for; the
 *  harmony view's fuller palette (9ths, 13ths, altered) lives behind its own
 *  inspector, and a context menu that needs scrolling is a menu nobody reads. */
export const CHORD_MENU_QUALITIES: readonly ChordQuality[] = [
  "maj",
  "min",
  "7",
  "min7",
  "maj7",
  "dim",
  "sus4",
];

/** How a quality reads on a button. */
export const QUALITY_LABEL: Record<string, string> = {
  maj: "maj",
  min: "min",
  "7": "7",
  min7: "m7",
  maj7: "maj7",
  dim: "dim",
  sus4: "sus4",
};

/** The inversions a right-click offers: root, first, second. */
export const CHORD_INVERSIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "root" },
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
];

function mapChord(
  section: BlueprintSection,
  chordId: string,
  patch: (chord: Chord) => Chord,
): BlueprintSection {
  return {
    ...section,
    chords: section.chords.map((chord) =>
      chord.id === chordId ? patch(chord) : chord,
    ),
  };
}

/**
 * Change a chord's quality.
 *
 * `extendedSuffix` is **cleared**: it is the display/voicing override for a
 * richer quality ("maj9", "7b13"), and leaving it behind after asking for a
 * plain minor would label the chord one thing and play another.
 */
export function withChordQuality(
  section: BlueprintSection,
  chordId: string,
  quality: ChordQuality,
): BlueprintSection {
  return mapChord(section, chordId, (chord) => {
    const next: Chord = { ...chord, quality };
    delete next.extendedSuffix;
    return next;
  });
}

/**
 * Put a chord tone in the bass, or back to root position.
 *
 * Root position is the absent case, not `{ inversion: 0 }` — every planner
 * treats an absent voicing as root-position-close, and storing the default
 * would make "never touched" and "touched then reset" two different states.
 */
export function withChordInversion(
  section: BlueprintSection,
  chordId: string,
  inversion: number,
): BlueprintSection {
  const clamped = Math.max(0, Math.min(2, Math.floor(inversion) || 0));
  return mapChord(section, chordId, (chord) => {
    const next: Chord = { ...chord };
    if (clamped === 0) {
      if (next.voicing) {
        const { inversion: _drop, ...rest } = next.voicing;
        if (Object.keys(rest).length === 0) delete next.voicing;
        else next.voicing = rest;
      }
      return next;
    }
    next.voicing = { ...next.voicing, inversion: clamped };
    return next;
  });
}

/**
 * Remove a chord from the progression.
 *
 * Its beats are handed to the chord BEFORE it (the last chord's beats go
 * nowhere, since the progression tiles to fill the section anyway) — so deleting
 * a chord shortens the progression instead of leaving a hole in the bar.
 */
export function withoutChord(
  section: BlueprintSection,
  chordId: string,
): BlueprintSection {
  const index = section.chords.findIndex((chord) => chord.id === chordId);
  if (index < 0) return section;
  const chords = section.chords.filter((chord) => chord.id !== chordId);
  if (index > 0 && chords.length > 0) {
    const previous = index - 1;
    chords[previous] = {
      ...chords[previous],
      beats: chords[previous].beats + section.chords[index].beats,
    };
  }
  return { ...section, chords };
}

/** The chord a right-click is for, or null when the id is stale. */
export function chordById(
  section: BlueprintSection,
  chordId: string,
): Chord | null {
  return section.chords.find((chord) => chord.id === chordId) ?? null;
}
