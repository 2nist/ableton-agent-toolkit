/**
 * Melody → lyric slots. Pure functions over the Melody tab's notes
 * (`MelodyNote`: section-relative beats), so the Lyrics tab can bind words
 * to a hummed line instead of to bar counts.
 *
 *   segmentPhrases   rests split the line into phrases (= natural lyric lines)
 *   metricWeight     how strong a beat position is (downbeat > group starts >
 *                    beats > offbeats), meter-aware — 7/8 as 2+2+3 works
 *   syllableSlots    one slot per note, with weight / held / peak flags
 *   prosodyIssues    stressed syllables on weak slots, weak syllables held
 *                    on strong ones, and the syllable/note count delta
 *
 * Stress patterns come from a pronunciation source (Datamuse `md=r` or a
 * local CMU dictionary); this module only consumes them.
 */

export interface MelodyNoteLike { pitch: number; startTime: number; duration: number }

export interface Phrase {
  index: number;
  startBeat: number;
  endBeat: number;
  notes: MelodyNoteLike[];
  /** Length of the phrase's last note — a long one is a rhyme site. */
  finalHoldBeats: number;
  /** Index (within `notes`) of the highest pitch; first wins ties. */
  peakIndex: number;
}

/** Rests of at least `minRestBeats` split phrases (default: one beat). */
export function segmentPhrases(
  notes: readonly MelodyNoteLike[], opts: { minRestBeats?: number } = {},
): Phrase[] {
  const minRest = opts.minRestBeats ?? 1;
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const groups: MelodyNoteLike[][] = [];
  let end = -Infinity;
  for (const n of sorted) {
    if (groups.length === 0 || n.startTime - end >= minRest - 1e-9) groups.push([]);
    groups[groups.length - 1].push(n);
    end = Math.max(end, n.startTime + n.duration);
  }
  return groups.map((g, index) => {
    const last = g[g.length - 1];
    let peakIndex = 0;
    let endBeat = g[0].startTime + g[0].duration;
    g.forEach((n, i) => {
      if (n.pitch > g[peakIndex].pitch) peakIndex = i;
      endBeat = Math.max(endBeat, n.startTime + n.duration);
    });
    return {
      index,
      startBeat: g[0].startTime,
      endBeat,
      notes: g,
      finalHoldBeats: last.duration,
      peakIndex,
    };
  });
}

export interface MeterInfo {
  /** Quarter-note beats per bar (4 for 4/4, 3.5 for 7/8). */
  beatsPerBar: number;
  /** Where the meter's groups start inside the bar, in beats. Default: 0 and
   *  mid-bar for even meters, just 0 otherwise. */
  groupStarts?: number[];
}

/** Group starts for a 2s/3s outline: cells [2,2,3] at 0.5 beats → [0,1,2]. */
export function groupStartsFromOutline(cells: readonly number[], cellBeats: number): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const c of cells) { out.push(pos); pos += c * cellBeats; }
  return out;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;

/** Position strength 0..1: bar start 1 · group start .7 · beat .5 · eighth .3 · else .15
 *
 * Deliberate: a position a hair before the bar line (e.g. -0.001, the reading
 * of an anticipation written as a rounded-down onset) counts as the downbeat —
 * the note is heard on the bar line, not off it.
 */
export function metricWeight(beat: number, meter: MeterInfo): number {
  const bpb = meter.beatsPerBar;
  const pos = ((beat % bpb) + bpb) % bpb;
  if (near(pos, 0) || near(pos, bpb)) return 1;
  const groups = meter.groupStarts
    ?? (Number.isInteger(bpb) && bpb % 2 === 0 && bpb >= 4 ? [0, bpb / 2] : [0]);
  if (groups.some((g) => near(pos, g))) return 0.7;
  if (near(pos, Math.round(pos))) return 0.5;
  if (near(pos * 2, Math.round(pos * 2))) return 0.3;
  return 0.15;
}

export interface SyllableSlot {
  noteIndex: number;
  startBeat: number;
  durationBeats: number;
  weight: number;
  /** Where a stressed syllable belongs: strong position or a held note. */
  strong: boolean;
  isPeak: boolean;
  isFinal: boolean;
}

export function syllableSlots(phrase: Phrase, meter: MeterInfo): SyllableSlot[] {
  return phrase.notes.map((n, i) => {
    const weight = metricWeight(n.startTime, meter);
    return {
      noteIndex: i,
      startBeat: n.startTime,
      durationBeats: n.duration,
      weight,
      strong: weight >= 0.7 || n.duration >= 1,
      isPeak: i === phrase.peakIndex,
      isFinal: i === phrase.notes.length - 1,
    };
  });
}

/** 0 = unstressed, 1 = primary, 2 = secondary (CMU convention). */
export type Stress = 0 | 1 | 2;

export interface ProsodyIssue {
  /** Slot (= syllable) position, 0-based. */
  slot: number;
  kind: "stressed-on-weak" | "unstressed-held-on-strong";
}

export interface ProsodyReport {
  /** syllables − slots: >0 crowds words onto notes, <0 leaves notes to melisma. */
  countDelta: number;
  issues: ProsodyIssue[];
}

export function prosodyIssues(stress: readonly Stress[], slots: readonly SyllableSlot[]): ProsodyReport {
  const issues: ProsodyIssue[] = [];
  const m = Math.min(stress.length, slots.length);
  for (let i = 0; i < m; i++) {
    const s = slots[i];
    // "Stressed" here means primary (1) or secondary (2) — both want a
    // metrically strong note; a secondary stress is the milder mismatch, but
    // it is still one, so it is flagged too.
    if (stress[i] !== 0 && !s.strong && s.weight < 0.5) issues.push({ slot: i, kind: "stressed-on-weak" });
    if (stress[i] === 0 && s.strong && s.durationBeats >= 1) issues.push({ slot: i, kind: "unstressed-held-on-strong" });
  }
  return { countDelta: stress.length - slots.length, issues };
}
