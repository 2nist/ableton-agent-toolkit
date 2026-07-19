import type { Limb, Segment, Take, TimeSignature } from "./types.js";

/** In-memory view over an extracted corpus, grouped for the queries a selector needs. */
export interface LibraryIndex {
  takes: Map<string, Take>;
  /** Segments grouped by limb, so a selector never scans voices it isn't looking for. */
  byLimb: Map<Limb, Segment[]>;
}

export function buildIndex(takes: Take[], segments: Segment[]): LibraryIndex {
  const takeMap = new Map(takes.map((take) => [take.id, take]));
  const byLimb = new Map<Limb, Segment[]>();
  for (const segment of segments) {
    const list = byLimb.get(segment.limb);
    if (list) list.push(segment);
    else byLimb.set(segment.limb, [segment]);
  }
  return { takes: takeMap, byLimb };
}

export function timeSignatureOf(index: LibraryIndex, segment: Segment): TimeSignature | null {
  return index.takes.get(segment.takeId)?.timeSignature ?? null;
}
