import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSection, type BlueprintSong } from "./blueprint.js";

export interface DrumClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

// Standard GM drum-map note numbers — match Ableton's own default Drum
// Rack layout closely enough to be useful without a specific kit chosen.
const KICK_PITCH = 36;
const SNARE_PITCH = 38;
const HAT_PITCH = 42;

const KICK_VELOCITY = 100;
const SNARE_VELOCITY = 95;
const HAT_VELOCITY = 70;

/** A short, un-sustained hit — not a block chord — regardless of hat subdivision. */
const HIT_DURATION = 0.25;

/**
 * Hi-hat subdivision in beats. Kick/snare stay identical everywhere
 * (beat-1-indexed odd beats = kick, even beats = snare — 1&3/2&4 in
 * 4/4); only hat density varies by section role: half-time on bridges
 * (thinned to 8th notes), double-time on choruses (32nd notes), 16th
 * notes everywhere else.
 */
function hatSubdivision(section: BlueprintSection): number {
  if (section.role === "bridge") return 0.5;
  if (section.role === "chorus") return 0.125;
  return 0.25;
}

export function planDrumClips(song: BlueprintSong): DrumClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const numerator = section.timeSignatureNumerator;
    const notes: NoteDescription[] = [];

    for (let beat = 0; beat < durationBeats; beat++) {
      const beatInBar = beat % numerator;
      const pitch = beatInBar % 2 === 0 ? KICK_PITCH : SNARE_PITCH;
      const velocity = beatInBar % 2 === 0 ? KICK_VELOCITY : SNARE_VELOCITY;
      notes.push({ pitch, startTime: beat, duration: HIT_DURATION, velocity });
    }

    const hatStep = hatSubdivision(section);
    const hatCount = Math.round(durationBeats / hatStep);
    for (let i = 0; i < hatCount; i++) {
      notes.push({ pitch: HAT_PITCH, startTime: i * hatStep, duration: hatStep, velocity: HAT_VELOCITY });
    }

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
