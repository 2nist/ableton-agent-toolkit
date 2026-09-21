import type { KitVoice } from "@drum/library";
import { TRACKDRAFT } from "../../theme/palette";

// Same family of hues as HoneycombWheel's HUES palette (warm/muted, one
// clear accent per role) — a fresh, voice-specific set rather than a
// reused import, since "which scale degree" and "which drum voice" are
// unrelated meanings that shouldn't share one literal color table.
//
// Assignments are the D5 decision from the Design Lab (2026-09-21):
// kick red · snare slate · rim teal · hat amber · cym orange · tom purple —
// single-sourced from `theme/palette.ts` so the app and the Lab can't drift.
export const VOICE_COLOR: Partial<Record<KitVoice, string>> = {
  kick: TRACKDRAFT.voices.kick,
  snare: TRACKDRAFT.voices.snare,
  rim: TRACKDRAFT.voices.rim,
  // Clap wasn't in the D5 list; it keeps its old orange (now the cym hue).
  clap: TRACKDRAFT.voices.cym,
  closedHat: TRACKDRAFT.voices.hat,
  openHat: TRACKDRAFT.voices.hat,
  pedalHat: TRACKDRAFT.voices.hat,
  ride: TRACKDRAFT.voices.cym,
  rideBell: TRACKDRAFT.voices.cym,
  crash: TRACKDRAFT.voices.cym,
  tomLow: TRACKDRAFT.voices.tom,
  tomMid: TRACKDRAFT.voices.tom,
  tomHigh: TRACKDRAFT.voices.tom,
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
