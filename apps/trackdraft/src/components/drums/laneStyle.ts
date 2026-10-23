import { useMemo } from "react";
import type { KitVoice } from "@drum/library";
import { usePalette, type Palette, type VoiceColors } from "../../theme/palette";

/** The fixed six-lane stage — the design reference's KICK / SNR / RIM /
 *  HAT / CYM / TOM. Each lane is a *family* of drum voices rendered as
 *  one line and one necklace (rim+clap, the hats, the cymbals, the toms),
 *  so a song using any member voice lights that lane; lanes no member
 *  voice plays anywhere stay dimmed. Colours come from the theme's voice
 *  palette via `laneColor()` — a lane key is a voice family. */
export interface DrumLane {
  /** Stable key, e.g. "kick" / "hat" / "tom". */
  key: string;
  /** Lane label shown at the track's left, e.g. "KICK". */
  label: string;
  /** The `KitVoice`s this lane renders as one line. */
  voices: KitVoice[];
}

const lane = (key: string, label: string, voices: KitVoice[]): DrumLane => ({
  key,
  label,
  voices,
});

/** A lane's line/necklace colour: the first voice's family hue, which for
 *  every lane in `DRUM_LANES` is the lane key itself. */
export function laneColor(lane: { key: string }, P: Palette): string {
  const family = lane.key as keyof VoiceColors;
  return P.voices[family] ?? P.voices.snare;
}

/** Lane table with colours resolved for the current theme. */
export function useDrumLanes(): (DrumLane & { color: string })[] {
  const P = usePalette();
  return useMemo(() => DRUM_LANES.map((l) => ({ ...l, color: laneColor(l, P) })), [P]);
}

/** Fixed row order — foundational voices first, matching the reference's
 *  KICK/SNR/RIM/HAT/CYM/TOM stack. */
export const DRUM_LANES: DrumLane[] = [
  lane("kick", "KICK", ["kick"]),
  lane("snare", "SNR", ["snare"]),
  lane("rim", "RIM", ["rim", "clap"]),
  lane("hat", "HAT", ["closedHat", "openHat", "pedalHat"]),
  lane("cym", "CYM", ["crash", "ride", "rideBell"]),
  lane("tom", "TOM", ["tomLow", "tomMid", "tomHigh"]),
];
