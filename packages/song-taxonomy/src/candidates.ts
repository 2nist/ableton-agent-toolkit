import type { CanonicalRole } from "./types.js";

export type CandidateStatus = "pending" | "accepted" | "rejected";

export interface NarrativeCandidate {
  id: string;
  kind: "narrative";
  status: CandidateStatus;
  proposedName: string;
  proposedDefinition: string;
  signature: CanonicalRole[];
  support: number;
  exemplars: { corpus: string; songId: string; title: string }[];
  nearestExisting?: { formId: string; score: number };
  proposedAt: string;
}

/**
 * Deterministic id from the skeleton itself, so re-running classification
 * against the same corpus always resolves to the same candidate record
 * (increment support, don't duplicate) rather than depending on run order
 * or wall-clock time.
 */
export function candidateIdFor(signature: readonly CanonicalRole[]): string {
  return `cand-${signature.join("-") || "empty"}`;
}

/**
 * Merge a newly observed skeleton into a candidate list: increments
 * support and appends an exemplar (capped) for an existing record with
 * the same signature, or appends a fresh pending record. Rejected
 * candidates still get their support/exemplars updated but their status
 * is left alone — that's what "archived, not re-proposed forever" means:
 * the record stays current without popping back into the pending queue.
 */
export function recordCandidateObservation(
  candidates: NarrativeCandidate[],
  observation: {
    signature: CanonicalRole[];
    exemplar: { corpus: string; songId: string; title: string };
    nearestExisting?: { formId: string; score: number };
  },
  maxExemplars = 5,
): NarrativeCandidate[] {
  const id = candidateIdFor(observation.signature);
  const existing = candidates.find((c) => c.id === id);

  if (existing) {
    existing.support += 1;
    if (existing.exemplars.length < maxExemplars) existing.exemplars.push(observation.exemplar);
    if (observation.nearestExisting && !existing.nearestExisting) existing.nearestExisting = observation.nearestExisting;
    return candidates;
  }

  candidates.push({
    id,
    kind: "narrative",
    status: "pending",
    proposedName: "",
    proposedDefinition: "",
    signature: observation.signature,
    support: 1,
    exemplars: [observation.exemplar],
    nearestExisting: observation.nearestExisting,
    proposedAt: new Date().toISOString(),
  });
  return candidates;
}
