/**
 * Stem routing — the one place that answers "where does each stem go on a
 * MIDI port, and what should be loaded there".
 *
 * This exists because the two output paths used to disagree. The file export
 * (`midiExport.ts`) hard-coded channels aimed at General MIDI (drums on
 * channel 10, where every DAW expects percussion), while live MIDI out
 * (`playback/liveMidiOut.ts`) defaulted to the Live template's track order
 * (drums on channel 1). Neither was wrong — they were answering different
 * questions — but with one shared shape and two *profiles*, the difference is
 * now explicit data instead of two sets of constants that quietly drift.
 *
 * The rule that must not be broken: the export default stays General MIDI.
 * Pointing an exported .mid's drums at channel 1 makes any GM-compatible DAW
 * play the drum part on a piano — the exact opposite of DAW-agnostic.
 */

import type { StemName } from "../types/blueprint";

/** The five stems TrackDraft renders, in the order the UI lists them. */
export const STEM_IDS = ["drums", "bass", "chords", "color", "melody"] as const;

export type StemId = StemName;

export const STEM_LABELS: Record<StemId, string> = {
  drums: "Drums",
  bass: "Bass",
  chords: "Chords",
  color: "Color",
  melody: "Melody",
};

/** General MIDI reserves channel 10 for percussion — the only channel where
 *  a drum part reads as drums without a program change. */
export const GM_DRUM_CHANNEL = 10;

export interface StemRouting {
  /** 1-based MIDI channel (1-16), matching how a DAW's UI numbers them. */
  channel: number;
  /** Instrument to load on the receiving track. Not enforced by anything —
   *  it's the human's note-to-self, written into the .mid as an
   *  instrument-name meta event so the DAW shows it on import. */
  instrumentName?: string;
  /** General MIDI program number (1-128), written as a program change so a
   *  GM-compatible DAW assigns the sound on import. Never set for drums:
   *  channel 10 is percussion by definition and a program change there is
   *  ignored or actively wrong. */
  gmProgram?: number;
}

export type StemRoutingMap = Record<StemId, StemRouting>;

export type RoutingProfileId = "gm" | "live";

export interface RoutingProfile {
  id: RoutingProfileId;
  label: string;
  description: string;
  stems: StemRoutingMap;
}

/**
 * General MIDI — the export default. Channels are the canonical GM
 * assignments, so a .mid opens sounding like the arrangement in Logic,
 * Reaper, Cubase, Studio One, GarageBand, or a hardware module.
 */
export const GM_ROUTING: RoutingProfile = {
  id: "gm",
  label: "General MIDI",
  description: "Drums on channel 10, each other stem on its own channel — what any DAW expects from a .mid file.",
  stems: {
    drums: { channel: GM_DRUM_CHANNEL, instrumentName: "Drums (GM kit)" },
    bass: { channel: 2, instrumentName: "Electric Bass (finger)", gmProgram: 34 },
    chords: { channel: 1, instrumentName: "Acoustic Grand Piano", gmProgram: 1 },
    color: { channel: 3, instrumentName: "Electric Piano 1", gmProgram: 5 },
    melody: { channel: 5, instrumentName: "Flute", gmProgram: 74 },
  },
};

/**
 * Live template — the live-out default. Channel number is the template
 * track's position (kit 1, crave 2, chord 3, color 4, melody 5), which is
 * what makes "MIDI From = this port, channel N" line up with the .als
 * without repointing anything. No GM programs: the template's own devices
 * are the instruments.
 */
export const LIVE_ROUTING: RoutingProfile = {
  id: "live",
  label: "Live template",
  description: "Channel = the Live template track's position (kit 1, crave 2, chord 3, color 4, melody 5).",
  stems: {
    drums: { channel: 1 },
    bass: { channel: 2 },
    chords: { channel: 3 },
    color: { channel: 4 },
    melody: { channel: 5 },
  },
};

export const ROUTING_PROFILES: Record<RoutingProfileId, RoutingProfile> = {
  gm: GM_ROUTING,
  live: LIVE_ROUTING,
};

export function clampChannel(channel: number): number {
  if (!Number.isFinite(channel)) return 1;
  return Math.max(1, Math.min(16, Math.round(channel)));
}

/** GM program numbers are 1-128 in every UI and 0-127 on the wire. */
export function clampProgram(program: number): number {
  if (!Number.isFinite(program)) return 1;
  return Math.max(1, Math.min(128, Math.round(program)));
}

/** A mutable copy of a profile's map, so per-user edits (channels, latency)
 *  never mutate the shared preset object. */
export function routingFromProfile(profile: RoutingProfile): StemRoutingMap {
  return STEM_IDS.reduce((map, stem) => {
    const route = profile.stems[stem];
    map[stem] = { ...route, channel: clampChannel(route.channel) };
    return map;
  }, {} as StemRoutingMap);
}
