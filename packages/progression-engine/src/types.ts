import type { Degree } from "@music-theory/core";

export type { Degree };

/**
 * A trained Markov transition model over a corpus of degree sequences
 * (e.g. "I V vi IV"). Degree strings are key-invariant (relative to the
 * tonic), so the model transfers across all keys.
 */
export interface TransitionModel {
  /** All degrees seen in the corpus. */
  degrees: string[];
  /** first-order: current degree -> next degree -> count. */
  firstOrder: Record<string, Record<string, number>>;
  /** second-order: "prev prev" bigram -> next degree -> count. */
  secondOrder: Record<string, Record<string, number>>;
  /** degree -> times it starts a sequence. */
  starts: Record<string, number>;
  /** degree -> times it ends a sequence. */
  ends: Record<string, number>;
  /** degree -> total outgoing count (sum of firstOrder[degree]). */
  totals: Record<string, number>;
  /** "a b" bigram -> count. */
  pairs: Record<string, number>;
  /** Number of sequences in the corpus. */
  sequenceCount: number;
  /** Total chord (degree) tokens. */
  chordCount: number;
}

export interface BuildOptions {
  /** Drop degrees (and their transitions) with total count below this. */
  minCount?: number;
}

/** A ranked "next chord" suggestion from the model. */
export interface NextSuggestion {
  degree: Degree;
  count: number;
  /** Empirical probability 0..1 given the context. */
  probability: number;
  context: "second" | "first" | "start";
}

/** Options controlling suggestion/ranking behavior. */
export interface SuggestOptions {
  /**
   * Multiplier (0..1) applied to a candidate that repeats the current last
   * chord, so drone-y self-loops (I->I, V->V) rank lower. Default 1 (off).
   * E.g. 0.2 strongly discourages repeats.
   */
  selfLoopPenalty?: number;
}

/** A full ranked continuation path (beam search result). */
export interface RankedPath {
  degrees: Degree[];
  logProb: number;
  /** Product of step probabilities. */
  probability: number;
}

export type TensionSource = "functional" | "empirical" | "hybrid";

export interface TensionOptions {
  /** Blend weights for functional vs empirical tension (default 0.5/0.5). */
  weights?: { functional: number; empirical: number };
}

/** Per-chord tension breakdown. */
export interface ChordTension {
  degree: Degree;
  /** Final 0..1 tension (the value you color by). */
  tension: number;
  functional: number;
  empirical: number;
  /** Normalized entropy of the chord's successor distribution (0..1). */
  entropy: number;
  /** Fraction of corpus sequences that end on this degree (0..1). */
  finality: number;
}
