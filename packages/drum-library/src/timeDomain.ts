import type { TimeDomain } from "@music-theory/song-blueprint";

/**
 * A section's local clock, applied to resolved notes.
 *
 * This lives in the shared package rather than in the app because three
 * different consumers have to agree about it: the app's MIDI export, the
 * Ableton bridge, and the canvas's own view of the pocket. A local clock that
 * only one of them honoured would be the worst kind of bug in this app — the
 * picture and the audio disagreeing about where a hit is.
 *
 * The mapping is deliberately 1:1: every local beat lands on exactly one global
 * beat, and a hit mapped outside the section is dropped rather than wrapped.
 * Looping a pattern into a shorter window is a different feature (one that adds
 * notes) and is not smuggled in here.
 */

/** A rate outside this range is a data error, not an intention. */
export const RATE_MIN = 1 / 8;
export const RATE_MAX = 8;

/** Full swing pushes the off-eighth to 0.75 of the beat — a triplet feel. */
const SWING_MAX_OFFSET = 0.25;

export interface NormalDomain {
  rate: number;
  phase: number;
  swing: number;
  quantizeTo: number;
  /** Loop length in LOCAL beats. 0 = the material plays once. */
  cycle: number;
}

/**
 * A folded pattern is copied until it fills the section, so a cycle of a
 * sixteenth over an eight-bar section is 128 copies of everything. This is the
 * ceiling — past it the ask is a mistake, not a rhythm.
 */
export const MAX_CYCLE_COPIES = 256;

/**
 * The domain as numbers, or `null` when it cannot change anything.
 *
 * "Cannot change anything" matters: `{ rate: 1 }` and `{}` both mean the song's
 * own beats, and callers should be able to test for that with one `=== null`
 * instead of re-deriving it at every call site.
 */
export function normaliseTimeDomain(
  domain: TimeDomain | null | undefined,
): NormalDomain | null {
  if (!domain) return null;
  const rawRate = Number(domain.rate);
  const rate = Number.isFinite(rawRate)
    ? Math.min(RATE_MAX, Math.max(RATE_MIN, rawRate))
    : 1;
  const rawPhase = Number(domain.phase ?? 0);
  const phase = Number.isFinite(rawPhase) ? rawPhase : 0;
  const rawSwing = Number(domain.swing ?? 0);
  const swing = Number.isFinite(rawSwing)
    ? Math.min(1, Math.max(0, rawSwing))
    : 0;
  const rawQuantize = Number(domain.quantizeTo ?? 0);
  const quantizeTo = Number.isFinite(rawQuantize)
    ? Math.max(0, rawQuantize)
    : 0;
  const rawCycle = Number(domain.cycle ?? 0);
  const cycle = Number.isFinite(rawCycle) ? Math.max(0, rawCycle) : 0;
  if (
    rate === 1 &&
    phase === 0 &&
    swing === 0 &&
    quantizeTo === 0 &&
    cycle === 0
  ) {
    return null;
  }
  return { rate, phase, swing, quantizeTo, cycle };
}

/** How far the second eighth of a beat pair is pushed, in beats. */
export function swingOffset(localBeat: number, swing: number): number {
  if (swing <= 0) return 0;
  // Only the second eighth of each pair moves; the downbeat and the beat stay.
  const eighth = Math.round(localBeat * 2);
  if (eighth % 2 === 0) return 0;
  return swing * SWING_MAX_OFFSET;
}

/**
 * One local beat → the global (section-relative) beat it sounds on.
 *
 * `rate` first (the material is compressed or stretched), then swing, then
 * phase, then the grid snap — in that order, because a snap after a phase is
 * what a quantise button means.
 */
export function mapDomainBeat(
  localBeat: number,
  domain: NormalDomain | null,
): number {
  if (!domain) return localBeat;
  const scaled = localBeat / domain.rate;
  const swung = scaled + swingOffset(scaled, domain.swing);
  const shifted = swung + domain.phase;
  if (domain.quantizeTo > 0) {
    return Math.round(shifted / domain.quantizeTo) * domain.quantizeTo;
  }
  return shifted;
}

/** Anything with a beat — a drum note, a melody note, a chord onset. */
export interface ClockedNote {
  beat: number;
}

/**
 * Map a list of notes onto the section's span.
 *
 * Hits that land outside `[0, durationBeats)` are dropped: a half-time section
 * whose material is twice as long as its span genuinely has notes that no
 * longer fit, and shipping them past the end would leak them into the next
 * section in every export path.
 */
export function applyTimeDomain<T extends ClockedNote>(
  notes: readonly T[],
  domain: NormalDomain | null,
  durationBeats: number,
): T[] {
  if (!domain) return [...notes];
  const limit = Math.max(0, durationBeats - 1e-6);
  const mapped: T[] = [];

  // A mapped note is CLIPPED to the space left in the section, not dropped and
  // not left hanging over the boundary: at half time a phrase's last note
  // doubles in length, and a loop's final copy starts before the end and would
  // otherwise ring into the next section. Kept, with its tail cut — losing the
  // attack would be the worse of the two.
  const place = (note: T, beat: number): T | null => {
    const duration = (note as { duration?: unknown }).duration;
    if (typeof duration !== "number") return { ...note, beat };
    const room = durationBeats - beat;
    if (room <= 1e-6) return null;
    return duration > room
      ? { ...note, beat, duration: room }
      : { ...note, beat };
  };

  // A rate that COMPRESSES (rate > 1) leaves the tail of its section empty —
  // the kit would play twice as fast for half the bars and then stop. So material
  // that runs short repeats to fill, exactly as an explicit loop does: the
  // section is its own loop when nothing else says otherwise.
  const cycle = domain.cycle > 0 ? domain.cycle : domain.rate > 1 ? durationBeats : 0;
  if (cycle <= 0) {
    for (const note of notes) {
      const beat = mapDomainBeat(note.beat, domain);
      if (beat < -1e-6 || beat > limit) continue;
      const placed = place(note, beat);
      if (placed) mapped.push(placed);
    }
    return mapped.sort((a, b) => a.beat - b.beat);
  }

  // Folded: only the first `cycle` local beats exist, and they repeat until
  // the section ends. A note outside the loop is not part of it — that is what
  // asking for a four-beat loop over thirty-two beats means.
  const loopGlobal = cycle / domain.rate;
  if (loopGlobal <= 0) return [];
  for (const note of notes) {
    if (note.beat < -1e-6 || note.beat >= cycle - 1e-6) continue;
    const base = mapDomainBeat(note.beat, domain);
    for (let copy = 0; copy < MAX_CYCLE_COPIES; copy += 1) {
      const beat = base + copy * loopGlobal;
      if (beat > limit) break;
      if (beat < -1e-6) continue;
      const placed = place(note, beat);
      if (placed) mapped.push(placed);
    }
  }
  return mapped.sort((a, b) => a.beat - b.beat);
}

/**
 * A span measured in SONG beats as the local span it came from.
 *
 * Positions are not linear under swing or a snap, but **deltas are**: pushing
 * the second eighth of a pair moves where a note sits, never how far apart two
 * notes are. So a drag is converted with one multiplication, which is the only
 * reason a clocked lane can be edited in song space at all.
 */
export function toLocalBeats(
  songBeats: number,
  domain: NormalDomain | null,
): number {
  if (!domain) return songBeats;
  return songBeats * domain.rate;
}

/** The other direction: a local span as the song beats it occupies. */
export function toSongBeats(
  localBeats: number,
  domain: NormalDomain | null,
): number {
  if (!domain || domain.rate === 0) return localBeats;
  return localBeats / domain.rate;
}

/** "½", "×2", "3:2" — the rate as a musician would say it, if it is one. */
export function rateLabel(rate: number): string {
  const known: [number, string][] = [
    [0.25, "¼"],
    [1 / 3, "⅓"],
    [0.5, "½"],
    [2 / 3, "⅔"],
    [0.75, "¾"],
    [1.5, "3:2"],
    [4 / 3, "4:3"],
    [2, "×2"],
    [3, "×3"],
    [4, "×4"],
  ];
  for (const [value, label] of known) {
    if (Math.abs(rate - value) < 1e-6) return label;
  }
  return `${formatRate(rate)}×`;
}

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
}

/** Everything the domain does, on one line: `½ · swing 30% · snap 1/4`. */
export function domainLabel(domain: TimeDomain | null | undefined): string {
  const normal = normaliseTimeDomain(domain);
  if (!normal) return "song time";
  const parts: string[] = [];
  if (normal.rate !== 1) parts.push(rateLabel(normal.rate));
  if (normal.phase !== 0) parts.push(`late ${normal.phase}`);
  if (normal.swing > 0) parts.push(`swing ${Math.round(normal.swing * 100)}%`);
  if (normal.quantizeTo > 0) parts.push(`snap ${normal.quantizeTo}`);
  if (normal.cycle > 0) parts.push(`loop ${normal.cycle}`);
  return parts.join(" · ");
}
