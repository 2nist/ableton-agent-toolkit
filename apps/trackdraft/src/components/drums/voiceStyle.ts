import { useMemo } from "react";
import type { KitVoice } from "@drum/library";
import { usePalette, type Palette, type VoiceColors } from "../../theme/palette";

// Same family of hues as HoneycombWheel's HUES palette (warm/muted, one
// clear accent per role) — a fresh, voice-specific set rather than a
// reused import, since "which scale degree" and "which drum voice" are
// unrelated meanings that shouldn't share one literal color table.
//
// Assignments are the D5 decision from the Design Lab (2026-09-21):
// kick red · snare slate · rim teal · hat amber · cym orange · tom purple —
// single-sourced from `theme/palette.ts` so the app and the Lab can't drift.
/** Which palette family a kit voice draws in. Clap was never in the D5 list;
 *  it has always borrowed the cymbal orange, so it keeps doing that. */
const VOICE_FAMILY: Record<KitVoice, keyof VoiceColors> = {
  kick: "kick",
  snare: "snare",
  rim: "rim",
  clap: "cym",
  closedHat: "hat",
  openHat: "hat",
  pedalHat: "hat",
  ride: "cym",
  rideBell: "cym",
  crash: "cym",
  tomLow: "tom",
  tomMid: "tom",
  tomHigh: "tom",
};

/** A voice's colour under the current theme. */
export function voiceColor(voice: KitVoice, P: Palette): string {
  return P.voices[VOICE_FAMILY[voice] ?? "snare"];
}

/** Every voice resolved at once — for lists that draw several in one pass. */
export function useVoiceColors(): Record<KitVoice, string> {
  const P = usePalette();
  return useMemo(() => {
    const out = {} as Record<KitVoice, string>;
    for (const voice of Object.keys(VOICE_FAMILY) as KitVoice[]) out[voice] = voiceColor(voice, P);
    return out;
  }, [P]);
}

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
