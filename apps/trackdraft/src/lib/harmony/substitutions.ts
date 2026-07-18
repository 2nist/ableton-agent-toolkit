import { MODE_DATA, SCALE_ORDER } from "@music-theory/core";
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
