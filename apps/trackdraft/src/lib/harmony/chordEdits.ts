import { MODE_DATA, pitchClass, type ChordQuality, type NoteName, type ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName } from "./chordBuilder";
import { getSubstitutionMenu } from "./substitutions";
import { inversionCount, toggleSpread, withVoicing } from "./voicing";
import type { HarmonyEvent } from "./analysis";

/**
 * Chord edits that belong to a single chord, kept out of any one component so
 * the floor's right-click menu and any future surface share them. Each returns
 * the replacement chord; the caller owns where it lives.
 */

export function withQuality(chord: Chord, quality: ChordQuality): Chord {
  return { ...chord, quality, extendedSuffix: undefined };
}

/** R / 1st / 2nd / 3rd — how many inversions this chord actually has. */
export function bassOptions(chord: Chord): { inversion: number; label: string }[] {
  const count = inversionCount(chord);
  return Array.from({ length: count }, (_, inversion) => ({
    inversion,
    label: inversion === 0 ? "R" : inversion === 1 ? "1st" : inversion === 2 ? "2nd" : "3rd",
  }));
}

export function withBass(chord: Chord, inversion: number): Chord {
  return withVoicing(chord, { inversion, spread: chord.voicing?.spread });
}

export function withSpreadToggled(chord: Chord): Chord {
  return toggleSpread(chord);
}

export interface SubstitutionOption {
  label: string;
  root: NoteName;
  quality: ChordQuality;
  why: string;
}

const nameFor = (rootPc: number, keyName: NoteName): NoteName => chordDisplayName(rootPc, "maj", keyName);

/**
 * The substitutions worth one click: a borrowed chord's way back, its own
 * relative replacement, and — for a dominant — the tritone sub, or else a
 * secondary dominant. Everything else is a deliberate root/quality edit.
 */
export function substitutionOptions(
  chord: Chord,
  event: HarmonyEvent,
  keyName: NoteName,
  scale: ScaleType,
): SubstitutionOption[] {
  const base = event.roman.replace(/(maj7|m7♭5|7♭5|m7|7|°|sus4)$/u, "");
  const menu = getSubstitutionMenu(scale, base, pitchClass(chord.root));
  const relative = menu.modeAware[0];
  const isDominant = /^7|^9|^13/.test(chord.quality) || chord.quality === "7sus4";
  const chromatic = isDominant ? menu.chromatic[0] : menu.chromatic[1];

  const mode = MODE_DATA[scale];
  const degreeLabel = mode.degrees[event.degree];
  const degreeEntry = degreeLabel ? mode.map[degreeLabel] : undefined;
  const restoreRoot = degreeEntry ? nameFor((pitchClass(keyName) + degreeEntry.pc) % 12, keyName) : null;

  const options: SubstitutionOption[] = [];
  if (event.borrowed && restoreRoot && degreeEntry) {
    options.push({
      label: `→ ${degreeLabel}`,
      root: restoreRoot,
      quality: degreeEntry.triad,
      why: `Back to the ${keyName} ${scale} chord on this degree`,
    });
  }
  if (relative) {
    options.push({
      label: relative.label,
      root: nameFor(relative.root, keyName),
      quality: relative.quality,
      why: relative.explanation,
    });
  }
  if (chromatic) {
    options.push({
      label: isDominant ? "tritone" : chromatic.label.split(" ")[0].toLowerCase(),
      root: nameFor(chromatic.root, keyName),
      quality: chromatic.quality,
      why: chromatic.explanation,
    });
  }
  return options;
}

/** Apply a substitution: the new root/quality, tagged so the analysis and the
 *  export know this chord was a deliberate swap rather than an authored one. */
export function withSubstitution(chord: Chord, option: SubstitutionOption): Chord {
  return {
    ...chord,
    root: option.root,
    quality: option.quality,
    isSubstitution: true,
    substitutedFrom: chord.romanNumeral,
    extendedSuffix: undefined,
  };
}
