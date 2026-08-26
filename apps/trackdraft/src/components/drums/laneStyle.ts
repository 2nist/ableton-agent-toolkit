import type { KitVoice } from "@drum/library";
import { VOICE_COLOR } from "./voiceStyle";

/** The fixed six-lane stage — the design reference's KICK / SNR / RIM /
 *  HAT / CYM / TOM. Each lane is a *family* of drum voices rendered as
 *  one line and one necklace (rim+clap, the hats, the cymbals, the toms),
 *  so a song using any member voice lights that lane; lanes no member
 *  voice plays anywhere stay dimmed. Colors derive from `VOICE_COLOR`'s
 *  family hues (single source of truth, no new palette). */
export interface DrumLane {
  /** Stable key, e.g. "kick" / "hat" / "tom". */
  key: string;
  /** Lane label shown at the track's left, e.g. "KICK". */
  label: string;
  /** The lane's line/necklace color. */
  color: string;
  /** The `KitVoice`s this lane renders as one line. */
  voices: KitVoice[];
}

const lane = (key: string, label: string, voices: KitVoice[]): DrumLane => ({
  key,
  label,
  voices,
  color: VOICE_COLOR[voices[0]] ?? "#8B94A1",
});

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
