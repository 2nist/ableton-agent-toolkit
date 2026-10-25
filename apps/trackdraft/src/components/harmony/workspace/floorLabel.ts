import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import { deriveEvent, rootForDegree, rootForStep } from "../../../lib/harmony/analysis";

const QUALITY_SUFFIX: Record<string, string> = {
  maj: "", min: "m", dim: "°", aug: "+", sus2: "sus2", sus4: "sus4",
  "7": "7", maj7: "maj7", min7: "m7", m7b5: "ø7", dim7: "°7",
  "9": "9", maj9: "maj9", min9: "m9", "13": "13",
};

/** The qualities the right-click menu offers, in ladder order. */
export const QUALITIES: ChordQuality[] = [
  "maj", "min", "dim", "aug", "sus2", "sus4", "7", "maj7",
  "min7", "m7b5", "dim7", "9", "maj9", "min9", "13",
];

/** `degree (+ lane) + quality` as a chord name in the section's key. */
export function chordLabel(
  keyName: NoteName,
  scale: ScaleType,
  degree: number,
  accidental: number,
  quality: ChordQuality,
): string {
  return `${rootForDegree(keyName, scale, degree, accidental)}${QUALITY_SUFFIX[quality] ?? quality}`;
}

/**
 * The two names a chromatic step can wear, as the chart would print them.
 * A reading that needs a double accidental (B in D aeolian would be ♭♭VII to
 * read it as a flattened seventh) is dropped — that is not a name anyone uses.
 */
export function spellingReadings(
  keyName: NoteName,
  scale: ScaleType,
  step: number,
  quality: ChordQuality,
): { sharp: string | null; flat: string | null } {
  const romanOf = (spelling: "sharp" | "flat") =>
    deriveEvent(
      {
        id: "reading",
        romanNumeral: "",
        root: rootForStep(keyName, scale, step, spelling),
        quality,
        beats: 1,
        spelling,
      },
      null,
      { key: keyName, scale, startBeat: 0 },
    ).roman;
  const accidents = (roman: string) => (roman.match(/[♭♯]/g) ?? []).length;
  const sharp = romanOf("sharp");
  const flat = romanOf("flat");
  // When both requests collapse onto the same name there is nothing to choose.
  if (sharp === flat) return { sharp: accidents(sharp) <= 1 ? sharp : null, flat: null };
  return {
    sharp: accidents(sharp) <= 1 ? sharp : null,
    flat: accidents(flat) <= 1 ? flat : null,
  };
}
