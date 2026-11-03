/**
 * Seam facts (§P2.2) — what changes ACROSS a boundary.
 *
 * §P2.1 drew the couplings inside one section. A section boundary is the other
 * half of the same question, and the canvas said nothing about it: whether the
 * groove hands over, whether the clock keeps counting, whether the key survives.
 *
 * Everything here is a comparison of two sections' own fields. That is a
 * deliberate limit: whether the planner will ALSO add an automatic handoff fill
 * is decided inside `planSectionDrumNotes` from role, length, tempo and the
 * transition budget, and re-deriving it here would be a second implementation of
 * the planner's judgement — the exact thing this canvas is not allowed to do. So
 * the seam reports what the author DECLARED, and stays quiet about what the
 * engine will add. An empty seam list means "nothing declared", not "nothing
 * happens".
 */

/** What can change at a boundary. */
export type SeamKind = "transition" | "clock" | "key";

export interface SeamFact {
  kind: SeamKind;
  /** Why it is a seam, in the two sections' terms. The tooltip, and the thing
   *  that makes the claim falsifiable. */
  reason: string;
}

export interface SeamCable {
  kind: SeamKind;
  reason: string;
  /** World-space endpoints: the right edge of one column, the left edge of the
   *  next, on the spine. */
  x1: number;
  x2: number;
  y: number;
}

type SectionLike = {
  name?: string;
  key?: string;
  scale?: string;
  timeDomain?: {
    rate?: number;
    cycle?: number;
    phase?: number;
    swing?: number;
  };
  drumTransitionModel?: unknown;
  drumTransitionBars?: number;
};

/** The section's effective clock, as a comparable string. Absent/1×/no-cycle is
 *  "song time" — the canonical form `normaliseTimeDomain` would produce. */
export function clockFingerprint(section: SectionLike): string {
  const domain = section.timeDomain;
  const rate = domain?.rate ?? 1;
  const cycle = domain?.cycle ?? 0;
  const phase = domain?.phase ?? 0;
  // SWING COUNTS. It is micro-timing for conduction (§P3.5) but it moves every
  // off-8th in the section, so a boundary where swing starts or stops is a seam
  // a listener hears. Found by pressing the clock key and watching the seam
  // disappear at "swing 25%" — a fingerprint that ignores a field the clock
  // ladder can step to is not a fingerprint of the clock.
  const swing = domain?.swing ?? 0;
  if (rate === 1 && cycle === 0 && phase === 0 && swing === 0) return "1";
  return `${rate}|${cycle}|${phase}|${swing}`;
}

/** The section's effective key+mode, as a comparable string. A section without
 *  its own key inherits the song's. */
export function keyFingerprint(
  section: SectionLike,
  song: { key?: string; scale?: string },
): string {
  return `${section.key ?? song.key ?? "C"}/${section.scale ?? song.scale ?? "ionian"}`;
}

/**
 * What changes between two consecutive sections.
 *
 * `song` supplies the fallback key/scale, because a section that inherits the
 * song's key is not "changing key" when the next one does the same.
 */
export function seamFacts(
  from: SectionLike,
  to: SectionLike,
  song: { key?: string; scale?: string } = {},
): SeamFact[] {
  const facts: SeamFact[] = [];

  if (from.drumTransitionModel) {
    const bars = from.drumTransitionBars ?? 1;
    facts.push({
      kind: "transition",
      reason: `${from.name ?? "this section"} ends on a ${String(
        from.drumTransitionModel,
      )} transition over ${bars} bar${bars === 1 ? "" : "s"}`,
    });
  }

  const fromClock = clockFingerprint(from);
  const toClock = clockFingerprint(to);
  if (fromClock !== toClock) {
    facts.push({
      kind: "clock",
      reason: `the clock changes at this seam (${describeClock(fromClock)} → ${describeClock(toClock)})`,
    });
  }

  const fromKey = keyFingerprint(from, song);
  const toKey = keyFingerprint(to, song);
  if (fromKey !== toKey) {
    facts.push({
      kind: "key",
      reason: `the harmony changes home here (${fromKey.replace("/", " ")} → ${toKey.replace("/", " ")})`,
    });
  }

  return facts;
}

/** One boundary of the focused section, with the facts it carries. */
export interface SeamBoundary {
  /** Which side of the focused span this boundary is on. */
  side: "in" | "out";
  fromSectionId: string;
  toSectionId: string;
  /** The span indices the cable joins, so a caller can look up the columns. */
  fromIndex: number;
  toIndex: number;
  facts: SeamFact[];
}

/**
 * The boundaries either side of one span.
 *
 * Pulled out of the component because this is the part that can be quietly
 * wrong — an off-by-one here draws the focus's seam on the wrong side of the
 * arrangement, or duplicates it. A section that plays three times is three
 * spans, so the pass index is part of the address, not a detail.
 */
export function seamsAround(
  spans: readonly {
    sectionId: string;
    occurrenceIndex: number;
    section: SectionLike;
  }[],
  index: number,
  song: { key?: string; scale?: string } = {},
): SeamBoundary[] {
  const here = spans[index];
  if (!here) return [];
  const out: SeamBoundary[] = [];
  for (const [side, fromIndex, toIndex] of [
    ["in", index - 1, index],
    ["out", index, index + 1],
  ] as const) {
    const from = spans[fromIndex];
    const to = spans[toIndex];
    if (!from || !to) continue;
    out.push({
      side,
      fromSectionId: from.sectionId,
      toSectionId: to.sectionId,
      fromIndex,
      toIndex,
      facts: seamFacts(from.section, to.section, song),
    });
  }
  return out;
}

/** A clock fingerprint as words. */
export function describeClock(fingerprint: string): string {
  if (fingerprint === "1") return "song time";
  const [rate, cycle, phase, swing] = fingerprint.split("|");
  const parts = [`×${rate}`];
  if (cycle !== "0") parts.push(`loop ${cycle}`);
  if (phase !== "0") parts.push(`phase ${phase}`);
  if (swing !== undefined && swing !== "0") {
    parts.push(`swing ${Math.round(Number(swing) * 100)}%`);
  }
  return parts.join(" · ");
}

/**
 * The seam cables for one boundary, in world coordinates.
 *
 * `spineY` is the world y of the spine line — the seam is drawn AT the spine
 * rather than in a lane, because a seam belongs to the arrangement's axis, not
 * to any one material.
 */
export function seamCables(
  facts: readonly SeamFact[],
  fromRightX: number,
  toLeftX: number,
  spineY: number,
): SeamCable[] {
  if (!(toLeftX > fromRightX)) return [];
  return facts.map((fact) => ({
    kind: fact.kind,
    reason: fact.reason,
    x1: fromRightX,
    x2: toLeftX,
    y: spineY,
  }));
}
