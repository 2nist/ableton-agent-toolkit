import { drumPocket, glueToPocket } from "@drum/library";
import type { NoteDescription } from "@ableton-extensions/sdk";
import type { BlueprintSection } from "./blueprint.js";

/**
 * GROOVE-AS-GLUE, Ableton side. The app's `midiExport` glues with the same
 * two `@drum/library` calls (`drumPocket` + `glueToPocket`) over the same
 * shared drum planner, so "Send to Ableton" and the exported .mid sit in the
 * same pocket — which is the whole point of the feature.
 */

/** Beats in a bar, from the section's own meter (the schema's definition). */
function beatsPerBar(section: BlueprintSection): number {
  return section.timeSignatureNumerator * (4 / 2 ** section.timeSignatureDenPower);
}

function pocketFor(section: BlueprintSection, drumNotes: readonly NoteDescription[]) {
  if (!section.grooveGlue || drumNotes.length === 0) return null;
  return drumPocket(
    drumNotes.map((n) => ({ beat: n.startTime, velocity: n.velocity ?? 96 })),
    beatsPerBar(section),
  );
}

/** Note times here are SECTION-relative (the clip carries `startBeat`), which
 *  is exactly the frame `glueToPocket` expects. Pitch and duration survive. */
export function glueSectionNotes(
  notes: NoteDescription[],
  section: BlueprintSection,
  drumNotes: readonly NoteDescription[],
  target: "bass" | "chords",
): NoteDescription[] {
  const glue = section.grooveGlue;
  if (!glue || !glue[target]) return notes;
  const pocket = pocketFor(section, drumNotes);
  if (!pocket) return notes;
  const glued = glueToPocket(
    notes.map((n) => ({
      pitch: n.pitch,
      startTime: n.startTime,
      duration: n.duration,
      velocity: n.velocity ?? 96,
    })),
    pocket,
    { strength: glue.strength ?? 1 },
  );
  return glued.map((n) => ({ pitch: n.pitch, startTime: n.startTime, duration: n.duration, velocity: n.velocity }));
}
