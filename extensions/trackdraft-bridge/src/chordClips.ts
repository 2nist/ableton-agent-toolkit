import {
  getChordIntervals,
  pitchClass,
  voiceChord,
  type ChordQuality,
  applyPerformanceEffect,
} from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import {
  narrativeHarmonySection,
  resolveChordOccurrences,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  styleArticulation,
  styleQualityFor,
  styleSpacing,
  styleVelocityTarget,
} from "@drum/library";

export interface ChordClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/**
 * Octave 5 in @music-theory/core's numbering (octave*12+pc) is MIDI 60 —
 * the "middle C" octave as Ableton itself displays it. Matches
 * chord-assistant's own default for the same reason.
 */
export const DEFAULT_OCTAVE = 5;
const DEFAULT_VELOCITY = 96;

/**
 * One clip per section, each holding sustained block chords.  When a
 * chord carries a `performance` effect (strum/pulse/arp), the
 * effect is applied via @music-theory/core's shared applyPerformanceEffect.
 */
export function planChordClips(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): ChordClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const profile = resolveEffectiveStyle(section, song);
    const narrative = resolveNarrativeProfile(section, song);
    // structural_warp: re-grid the harmony onto an asymmetric 2s/3s outline
    // (an authored outline always wins). Neutral warp → section passes through.
    const harmonySection = narrativeHarmonySection(section, narrative);
    // Chord velocity now follows the energy axis (narrative rhythmic_energy)
    // via the same parity-locked curve the drums use, instead of a flat 96.
    const velocity = styleVelocityTarget(DEFAULT_VELOCITY, profile);
    const notes: NoteDescription[] = [];
    for (const occurrence of resolveChordOccurrences(harmonySection, durationBeats, styleSpacing(profile.density))) {
      const rootPc = pitchClass(occurrence.chord.root);
      // Bend Harmony layer: Color + Tension (authored suffix wins).
      const quality = styleQualityFor(occurrence.chord, profile.harmony, profile.tension ?? 0.5);
      // Voicing (inversion + spread) is applied the same way the app's .mid
      // export applies it, so "Send to Ableton" and the exported file voice a
      // chord identically.
      const voiced = voiceChord(
        octave * 12 + rootPc,
        getChordIntervals(quality as ChordQuality),
        occurrence.chord.voicing,
      );
      let chordNotes: NoteDescription[] = [];
      for (const interval of voiced.intervals) {
        const pitch = voiced.rootMidi + interval;
        chordNotes.push({ pitch, startTime: occurrence.startTime, duration: occurrence.duration, velocity });
      }

      chordNotes = applyPerformanceEffect(
        chordNotes,
        // Bend Articulation layer (an authored performance wins).
        occurrence.chord.performance ?? styleArticulation(profile.articulation ?? 0.5),
      );

      notes.push(...chordNotes);
    }
    return { name: section.name, startBeat, durationBeats, notes };
  });
}
