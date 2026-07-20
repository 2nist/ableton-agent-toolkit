import { toSkeleton } from "./skeleton.js";
import { similarity } from "./distance.js";
import type { FormMatch, NarrativeForm, SectionToken } from "./types.js";

export interface ClassifyOptions {
  /** Minimum similarity (0-1) to accept a match. Default 0.66 = 1 - the
   *  0.34 distance threshold mining clusters at, so a song classifies
   *  against the taxonomy with the same tolerance the taxonomy was built
   *  with. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.66;

/**
 * Classify a song's section sequence against the current narrative-form
 * taxonomy. Below `threshold`, `formId` is null and the caller should
 * treat the song as a candidate for a new form rather than force-fitting
 * it — this is the "propose, don't auto-spawn" contract from the top of
 * the package.
 */
export function classifyNarrative(
  tokens: SectionToken[],
  taxonomy: readonly NarrativeForm[],
  options: ClassifyOptions = {},
): FormMatch {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const { skeleton, tags } = toSkeleton(tokens);

  const scored = taxonomy
    .map((form) => {
      const signatures = [form.signature, ...(form.variants ?? [])];
      const best = Math.max(...signatures.map((sig) => similarity(skeleton, sig)));
      return { formId: form.id, score: best };
    })
    .sort((a, b) => b.score - a.score || a.formId.localeCompare(b.formId));

  const winner = scored[0];
  const runnerUp = scored[1];

  const evidence: string[] = [`skeleton: ${skeleton.join("-") || "(empty)"}`];
  if (winner) evidence.push(`best match ${winner.formId} @ ${winner.score.toFixed(2)}`);
  if (runnerUp) evidence.push(`runner-up ${runnerUp.formId} @ ${runnerUp.score.toFixed(2)}`);

  const runnerUpMatch = runnerUp ? { formId: runnerUp.formId, score: runnerUp.score } : undefined;

  if (!winner || winner.score < threshold) {
    return { formId: null, score: winner?.score ?? 0, skeleton, tags, evidence, runnerUp: runnerUpMatch };
  }

  return { formId: winner.formId, score: winner.score, skeleton, tags, evidence, runnerUp: runnerUpMatch };
}
