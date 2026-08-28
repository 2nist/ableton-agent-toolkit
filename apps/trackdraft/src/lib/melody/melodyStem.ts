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

import type { SectionSpan } from "../arrangement";
import type { MidiNote } from "../midiExport";

/** Default melody velocity — matches the chord export's block-chord
 *  velocity (and what capture stamps on each note). */
export const DEFAULT_MELODY_VELOCITY = 96;

/** The melody stem for the whole song — one continuous line, each
 *  section's captured notes offset to its real start beat. */
export function planMelodyStem(spans: SectionSpan[]): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const span of spans) {
    const melody = span.section.melody;
    if (!melody || melody.notes.length === 0) continue;
    for (const n of melody.notes) {
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
