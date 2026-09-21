import { pitchClass } from "@music-theory/core";
import { planSectionBass, resolveBassProfile, resolveChordOccurrences, resolveStyleProfile, styleSpacing } from "@drum/library";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";

export interface BassLinePlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/**
 * Octave 3 in @music-theory/core's numbering (octave*12+pc) is MIDI 36
 * (C2 in Ableton's own display) — a standard bass register, an octave
 * and a half below chordClips' default. This is the fallback octave when
 * a section carries no `bassProfile`; a section's own `bassProfile.octave`
 * wins when it's set.
 */
export const DEFAULT_OCTAVE = 3;

/**
 * One clip per section: a single sustained root note per chord, full
 * duration, back-to-back with no gaps (legato) by default — no octave
 * jumps, walking lines, or rhythmic variation, the historical v1. A
 * section's `bassProfile` (register/motion/rhythm/velocity) shapes the
 * line when present. Uses the SAME generator the app's `planBassStem`
 * calls (`@drum/library`'s `planSectionBass`), so the bass Live writes
 * matches the app's .mid/live-out note for note.
 */
export function planBassLine(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): BassLinePlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const profile = resolveStyleProfile(section, song);
    const occurrences = resolveChordOccurrences(section, durationBeats, styleSpacing(profile.density)).map((occ) => ({
      rootPc: pitchClass(occ.chord.root),
      startTime: occ.startTime,
      duration: occ.duration,
    }));
    // Bend Bass layer: the octave param is the call-site default; the
    // section's explicit profile sits under the bend axes — resolved by
    // the SAME shared function the app's planBassStem uses (parity).
    const notes: NoteDescription[] = planSectionBass(
      occurrences,
      resolveBassProfile({ octave, ...section.bassProfile }, profile),
    ).map((n) => ({ pitch: n.pitch, startTime: n.startTime, duration: n.duration, velocity: n.velocity }));
    return { name: section.name, startBeat, durationBeats, notes };
  });
}
