import type {
  Degree,
  TransitionModel,
  ChordTension,
  TensionOptions,
} from "./types.js";

/**
 * Functional (diatonic) tension per degree — Riemannian-style:
 * tonic is most resolved, leading tone / altered chords most tense.
 */
const FUNCTIONAL_TENSION: Record<string, number> = {
  I: 0.0,
  vi: 0.15,
  iii: 0.3,
  IV: 0.45,
  ii: 0.55,
  V: 0.75,
  "vii°": 0.9,
  // borrowed / chromatic
  "♭II": 0.85,
  "♭III": 0.5,
  iv: 0.6,
  "♭VI": 0.55,
  "♭VII": 0.65,
};

export function functionalTension(degree: Degree): number {
  return FUNCTIONAL_TENSION[degree] ?? 0.5;
}

function entropyOf(dist: Record<string, number>, total: number, base: number): number {
  let h = 0;
  for (const c of Object.values(dist)) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  const max = Math.log2(Math.max(base, 2));
  return max > 0 ? Math.min(1, h / max) : 0;
}

/**
 * Empirical tension learned from the corpus:
 * - high entropy of a chord's successor distribution => unstable "pull"
 * - low finality (rarely ends a section) => mid-progression => tension
 */
export function empiricalTension(model: TransitionModel, degree: Degree) {
  const dist = model.firstOrder[degree];
  const total = model.totals[degree] ?? 0;
  const entropy = total > 0 ? entropyOf(dist ?? {}, total, model.degrees.length) : 0;
  const finality =
    model.sequenceCount > 0 ? (model.ends[degree] ?? 0) / model.sequenceCount : 0;
  return { entropy, finality, empirical: 0.5 * entropy + 0.5 * (1 - finality) };
}

/** Hybrid tension: blends functional + empirical (default 50/50). */
export function tension(
  model: TransitionModel | null,
  degree: Degree,
  opts: TensionOptions = {},
): ChordTension {
  const w = opts.weights ?? { functional: 0.5, empirical: 0.5 };
  const functional = functionalTension(degree);
  let empirical = 0;
  let entropy = 0;
  let finality = 0;
  if (model) {
    ({ entropy, finality, empirical } = empiricalTension(model, degree));
  }
  const total = w.functional + w.empirical || 1;
  const t = Math.max(
    0,
    Math.min(1, (w.functional * functional + w.empirical * empirical) / total),
  );
  return { degree, tension: t, functional, empirical, entropy, finality };
}

/** Tension curve across a progression. */
export function tensionCurve(
  model: TransitionModel | null,
  degrees: Degree[],
  opts?: TensionOptions,
): ChordTension[] {
  return degrees.map((d) => tension(model, d, opts));
}
