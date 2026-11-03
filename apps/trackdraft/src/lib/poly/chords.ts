import type { Chord } from "../../types/blueprint";
import { honeycombTextToChords } from "../harmony/chordBuilder";
import type { NoteName, ScaleType } from "@music-theory/core";

/**
 * Retyping a chord on the canvas.
 *
 * The one field a cell actually shows is its numeral, so that is what you type:
 * "vi", "V7", "♭VIImaj7". Parsing goes through the harmony charts' OWN parser
 * (`honeycombTextToChords`), which is where the numeral + quality vocabulary
 * already lives — a second parser here would drift from it the first time a
 * suffix was added.
 *
 * Only the identity of the chord changes. Its `id` (what selection, the
 * arrangement and the export point at) and its `beats`/`gap` (the timing the
 * user set on the timeline) are kept, so retyping a chord cannot silently
 * re-time the progression.
 */

export interface ChordSource {
  chords: readonly Chord[];
  beatsPerChord: number;
  key?: NoteName;
  scale?: ScaleType;
}

export interface RetypeResult {
  chords: Chord[];
  /** The chord as it now sounds — the caller re-selects it by id. */
  chord: Chord;
}

/** Move a chord to another chord's slot. Order is the progression's meaning,
 *  so this is the definition being edited — every lap follows. */
export function moveChord(
  chords: readonly Chord[],
  fromId: string,
  toId: string,
): Chord[] | null {
  if (fromId === toId) return null;
  const from = chords.findIndex((chord) => chord.id === fromId);
  const to = chords.findIndex((chord) => chord.id === toId);
  if (from < 0 || to < 0) return null;
  const next = [...chords];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function retypeChord(
  section: ChordSource,
  chordId: string,
  text: string,
  song: { key: NoteName; scale: ScaleType },
): RetypeResult | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const index = section.chords.findIndex((chord) => chord.id === chordId);
  if (index < 0) return null;

  const parsed = honeycombTextToChords(
    trimmed,
    section.key ?? song.key,
    section.beatsPerChord,
    section.scale ?? song.scale,
  );
  const first = parsed[0];
  if (!first) return null;

  const original = section.chords[index];
  const chord: Chord = {
    ...first,
    id: original.id,
    beats: original.beats,
    restAfter: original.restAfter,
    restBefore: original.restBefore,
    // A voicing is a choice about the OLD chord's pitches; carry it only when
    // the chord still starts on the same root.
    voicing: original.root === first.root ? original.voicing : undefined,
  };

  return {
    chords: section.chords.map((entry, at) => (at === index ? chord : entry)),
    chord,
  };
}
