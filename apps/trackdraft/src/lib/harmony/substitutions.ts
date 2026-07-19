import { MODE_DATA, SCALE_ORDER, getSubstitutionOptions } from "@music-theory/core";
import type { ScaleType, ChordQuality } from "@music-theory/core";

/** Real chord-generation logic, filling the gap in
 *  @music-theory/core/substitutions.ts — that module only carries
 *  suggestion *text* ("Tritone sub", "V/V (secondary)"), not functions
 *  that actually build the substitute chord. These do. Written here
 *  first per the plan; worth upstreaming into music-theory once proven,
 *  since any other consumer of that package would benefit too. */

export interface GeneratedSubstitution {
  label: string;
  explanation: string;
  root: number; // pitch class 0-11
  quality: ChordQuality;
}

/** Tritone substitution: swap a dominant chord for the dominant chord a
 *  tritone (6 semitones) away — they share the same guide tones (3rd/7th
 *  a tritone apart resolve the same way). Only meaningful for dominant
 *  (quality "7") chords. */
export function tritoneSubstitution(rootPc: number): GeneratedSubstitution {
  const subRoot = (rootPc + 6) % 12;
  return {
    label: "Tritone sub",
    explanation: "Shares the same guide tones (3rd/7th), resolves the same way a tritone away.",
    root: subRoot,
    quality: "7",
  };
}

/** Secondary dominant: the dominant-7 chord that resolves TO the given
 *  target root (a perfect fifth above it) — e.g. the secondary dominant
 *  of V (in C, G) is V/V = D7. */
export function secondaryDominant(targetRootPc: number): GeneratedSubstitution {
  const subRoot = (targetRootPc + 7) % 12;
  return {
    label: "Secondary dominant",
    explanation: "The dominant of this chord's own dominant — resolves into it a fifth below.",
    root: subRoot,
    quality: "7",
  };
}

export interface BorrowedChordCandidate {
  degree: string;
  root: number;
  triad: ChordQuality;
  seventh: ChordQuality;
  sourceMode: ScaleType;
}

/** Generalizes music-theory's 5 hardcoded Ionian-only borrowed-chord
 *  entries to all 7 modes: any chord diatonic to another mode sharing
 *  the same tonic pitch class ("parallel modes") but NOT already
 *  diatonic to the current mode is a valid borrowed-chord candidate. */
export function getBorrowedChordCandidates(currentMode: ScaleType): BorrowedChordCandidate[] {
  const currentPcs = new Set(
    Object.values(MODE_DATA[currentMode].map)
      .filter((entry) => !entry.isBorrowed)
      .map((entry) => entry.pc),
  );

  const candidates: BorrowedChordCandidate[] = [];
  const seenPcs = new Set<number>();

  for (const mode of SCALE_ORDER) {
    if (mode === currentMode) continue;
    for (const [degree, entry] of Object.entries(MODE_DATA[mode].map)) {
      if (entry.isBorrowed) continue; // don't borrow another mode's already-borrowed entries
      if (currentPcs.has(entry.pc)) continue; // already diatonic here, not a "borrow"
      if (seenPcs.has(entry.pc)) continue; // dedupe across modes that share this pc/quality
      seenPcs.add(entry.pc);
      candidates.push({ degree, root: entry.pc, triad: entry.triad, seventh: entry.seventh, sourceMode: mode });
    }
  }

  return candidates.sort((a, b) => a.root - b.root);
}

/** A mode-aware substitution resolved to a concrete chord: unlike
 *  `CHORD_SUBSTITUTIONS`'s bare {degree, explanation} text pairs, this
 *  carries the target's own root/quality (resolved via `MODE_DATA`,
 *  key-relative like `getDiatonicOptions`) plus its roman numeral, so a UI
 *  can apply it in one click instead of just displaying the suggestion. */
export interface ModeAwareSubstitution extends GeneratedSubstitution {
  degreeLabel: string;
}

/** Resolve `CHORD_SUBSTITUTIONS`' degree-based suggestions for one roman
 *  numeral into applicable chords. Returns `[]` for a numeral the scale
 *  doesn't recognize — a borrowed or already-substituted chord has no
 *  scale degree to look suggestions up by, so it gets no mode-aware subs
 *  (chromatic and borrowed subs still apply to it; see `getSubstitutionMenu`). */
export function getModeAwareSubstitutions(scale: ScaleType, romanNumeral: string): ModeAwareSubstitution[] {
  const degreeIndex = MODE_DATA[scale].degrees.indexOf(romanNumeral);
  if (degreeIndex === -1) return [];

  return getSubstitutionOptions(scale, degreeIndex + 1).flatMap((option) => {
    const targetLabel = MODE_DATA[scale].degrees[option.degree - 1];
    const entry = targetLabel ? MODE_DATA[scale].map[targetLabel] : undefined;
    if (!entry) return [];
    return [
      {
        label: targetLabel,
        degreeLabel: targetLabel,
        explanation: option.explanation,
        root: entry.pc,
        quality: entry.triad,
      },
    ];
  });
}

export interface SubstitutionMenu {
  modeAware: ModeAwareSubstitution[];
  chromatic: GeneratedSubstitution[];
  borrowed: BorrowedChordCandidate[];
}

/** The full substitution menu for one chord: mode-aware suggestions (only
 *  for diatonic numerals), the two chromatic transforms (always available,
 *  computed from the chord's absolute root), and every borrowed-chord
 *  candidate for the scale. Callers apply mode-aware/borrowed roots as
 *  key-relative and chromatic roots as absolute — the two families use
 *  different pitch-class origins, matching how `getDiatonicOptions` and
 *  `tritoneSubstitution`/`secondaryDominant` already work. */
export function getSubstitutionMenu(scale: ScaleType, romanNumeral: string, absoluteRootPc: number): SubstitutionMenu {
  return {
    modeAware: getModeAwareSubstitutions(scale, romanNumeral),
    chromatic: [tritoneSubstitution(absoluteRootPc), secondaryDominant(absoluteRootPc)],
    borrowed: getBorrowedChordCandidates(scale),
  };
}
