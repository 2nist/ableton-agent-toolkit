/**
 * Melody stem — the captured hum-to-MIDI line mapped onto the timeline, the
 * export counterpart of the Chords/Bass/Drums/Color stems. Each section's
 * `melody` notes are already beats-relative-to-section-start (from capture),
 * so this is a straight offset to the section's real start beat — the same
 * shape as `planColorStem` and the other per-section stems.
 *
 * The stem feeds three consumers: the exported .mid (as the `Melody` track,
 * which maps to the template's `melody` track), live MIDI out (channel 5),
 * and — once the bridge extension is taught about the field — Send to
 * Ableton. A section with no `melody` simply contributes nothing.
 */

import {
  conductSection,
  resolveEffectiveStyle,
  styleMelodyLine,
} from "@drum/library";
import type { SectionSpan } from "../arrangement";
import type { MidiNote } from "../midiExport";
import type { BlueprintSong } from "../../types/blueprint";

/** Default melody velocity — matches the chord export's block-chord
 *  velocity (and what capture stamps on each note). */
export const DEFAULT_MELODY_VELOCITY = 96;

/** The melody stem for the whole song — one continuous line, each
 *  section's captured notes offset to its real start beat. */
export function planMelodyStem(spans: SectionSpan[], song?: BlueprintSong): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const section = span.section;
    if (!section.melody || section.melody.notes.length === 0) continue;
    // Bend Melody layer: the Contour axis applies to a captured line here.
    // Generated lines already applied it (and set `contourApplied`), so they
    // are passed through untouched — no double shaping.
    const profile = resolveEffectiveStyle(section, song);
    const shaped = section.melody.contourApplied
      ? section.melody.notes
      : styleMelodyLine(section.melody.notes, profile.melodyContour);
    // The section's own clock (§P3.6): one conduction at the boundary, so the
    // captured line lands where the chords it was written against do. Contour
    // shaping happens first — it reads local pitches, not local beats.
    const placed = conductSection(
      { ...section, melody: { ...section.melody, notes: shaped } },
      span.durationBeats,
    ).melody!.notes;
    for (const n of placed) {
      notes.push({
        pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
        startTime: span.startBeat + n.startTime,
        duration: Math.max(0.1, n.duration),
        velocity: n.velocity ?? DEFAULT_MELODY_VELOCITY,
      });
    }
  }
  return notes;
}
