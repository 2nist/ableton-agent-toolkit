import type { KitVoice } from "@drum/library";

// Same family of hues as HoneycombWheel's HUES palette (warm/muted, one
// clear accent per role) — a fresh, voice-specific set rather than a
// reused import, since "which scale degree" and "which drum voice" are
// unrelated meanings that shouldn't share one literal color table.
export const VOICE_COLOR: Partial<Record<KitVoice, string>> = {
  kick: "#E8B54A",
  snare: "#D96459",
  rim: "#D9954A",
  clap: "#D9954A",
  closedHat: "#8B94A1",
  openHat: "#8B94A1",
  pedalHat: "#8B94A1",
  ride: "#4FA3A5",
  rideBell: "#4FA3A5",
  crash: "#4FA3A5",
  tomLow: "#9678C8",
  tomMid: "#9678C8",
  tomHigh: "#9678C8",
};

export const VOICE_LABEL: Record<KitVoice, string> = {
  kick: "KICK", snare: "SNR", rim: "RIM", clap: "CLAP",
  closedHat: "C.HAT", openHat: "O.HAT", pedalHat: "P.HAT",
  ride: "RIDE", rideBell: "BELL", crash: "CRASH",
  tomLow: "TOM LO", tomMid: "TOM MID", tomHigh: "TOM HI",
};

/** Fixed row order for a multi-voice lane view — most-used/foundational
 *  voices first, so a song using only kick/snare/hat doesn't scatter
 *  them across an otherwise-empty tall stack. */
export const VOICE_ORDER: KitVoice[] = [
  "kick", "snare", "rim", "clap",
  "closedHat", "openHat", "pedalHat",
  "tomLow", "tomMid", "tomHigh",
  "ride", "rideBell", "crash",
];
