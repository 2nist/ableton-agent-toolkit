import type { BlueprintSection, MelodyNote } from "../../types/blueprint";
import { sectionDurationBeats } from "../../types/blueprint";
import { normaliseTimeDomain } from "@drum/library";
import { sectionBassLine, type BassSongSource } from "../harmony/voiceLayers";
import {
  noteFrame,
  noteGhosts,
  type PolyNoteFrame,
  type PolyNoteGhost,
} from "./melody";

/**
 * The bass lane, as editable geometry.
 *
 * A section's bass has two possible sources: the generated line
 * (`bassProfile`), which is what almost every section plays, and an authored
 * one (`bassNotes`), which wins when it exists. The lane draws whichever is
 * true and edits into the authored field — so the first drag on a generated
 * line *seeds* the override with the notes you were looking at, and nothing
 * jumps.
 *
 * Everything goes through `sectionBassLine`, the same resolve the .mid export,
 * live MIDI out and the Ableton bridge use, so a note dragged here is a note
 * that plays everywhere.
 */

/** A bassline reads over an octave or so; drawing it against the melody's
 *  seven-semitone window would flatten it into a straight line. */
export const BASS_MIN_RANGE = 12;

export interface PolyBassLine {
  notes: MelodyNote[];
  /** True when these notes are the section's own, not the generator's. */
  authored: boolean;
}

/**
 * The notes the lane EDITS: the stored line, in local beats.
 *
 * Authored or generated, the line comes from `sectionBassLine` — the same
 * resolve the export, live out and the bridge use — but on a section with no
 * clock, so the geometry a drag writes is the geometry it reads. Where the
 * section's own clock puts the line is `bassGhostsFor` (§P3.7); drawing the
 * conducted line here made the first edit write song beats into a local field.
 */
export function bassNotesFor(
  section: BlueprintSection,
  song?: BassSongSource,
): PolyBassLine {
  const authored = (section.bassNotes?.length ?? 0) > 0;
  const line = sectionBassLine(
    { ...section, timeDomain: undefined },
    (section.key ?? song?.key) as string,
    song,
  );
  return {
    authored,
    notes: line.map((note) => ({
      pitch: note.pitch,
      startTime: note.startTime,
      duration: note.duration,
      velocity: note.velocity,
    })),
  };
}

export function bassFrameFor(
  section: BlueprintSection,
  song?: BassSongSource,
): PolyNoteFrame {
  const duration = sectionDurationBeats(section);
  const frame = noteFrame(bassNotesFor(section, song).notes, duration, {
    minRange: BASS_MIN_RANGE,
    pad: 1,
  });
  const ghost = bassGhostsFor(section, frame, song);
  return ghost.length > 0 ? { ...frame, ghost } : frame;
}

/** Where the section's clock puts the line, in the local frame's coordinates. */
export function bassGhostsFor(
  section: BlueprintSection,
  frame: PolyNoteFrame,
  song?: BassSongSource,
): PolyNoteGhost[] {
  if (!section.timeDomain || !normaliseTimeDomain(section.timeDomain))
    return [];
  const sounded = sectionBassLine(
    section,
    (section.key ?? song?.key) as string,
    song,
  );
  return noteGhosts(sounded, frame);
}

/**
 * A section with an authored bass line. An empty array clears the field rather
 * than storing one, so "no notes" and "never touched" stay the same state —
 * which is what makes `absent → byte-identical` true forever.
 */
export function withBassNotes(
  section: BlueprintSection,
  notes: readonly MelodyNote[],
): BlueprintSection {
  if (notes.length === 0) {
    const next = { ...section };
    delete next.bassNotes;
    return next;
  }
  return { ...section, bassNotes: [...notes] };
}

/** Hand the section back to its generated line. */
export function clearBassNotes(section: BlueprintSection): BlueprintSection {
  return withBassNotes(section, []);
}
