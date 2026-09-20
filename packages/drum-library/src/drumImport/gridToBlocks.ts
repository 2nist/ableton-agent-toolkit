/**
 * Drum grid → Track Draft `DrumBlock[]`.
 *
 * Input is a neutral, source-agnostic grid (bars × lanes × steps, velocity 0
 * = rest) so the audio-transcription route and any MIDI route share this
 * half. Output is, per section, the blocks + a velocity target, ready to be
 * merged into a section (see sectionPatch.ts) and written through the drums
 * draft store or a generated song. Ids are deterministic, so re-runs
 * overwrite rather than duplicate.
 *
 * Compiler facts this relies on (packages/drum-library/src/blocks.ts):
 *   - euclid: step s lands at startBeat + s·(range/n); no tiling, so one
 *     block per bar / segment. Every hit gets ONE flat velocity (the lane's
 *     current peak in range, else the section target) — no accents.
 *   - euclid / steps REPLACE the lane family's notes inside [start, end)
 *     (spliceLane); they never layer over the base groove.
 *   - motion REPLACES every voice in its end-anchored span with a
 *     synthesized gesture, built from the base notes in that span — so it
 *     can't share a range with fill content (it would win the id-sorted tie
 *     and erase the fill).
 *   - blocks sort by startBeat then id; adjacent [a,b) [b,c) both apply.
 *
 * How a bar is encoded
 *   groove bar  → one `euclid` block per lane (n = steps in the segment)
 *   fill bar    → groove segment up to the first beat that deviates from the
 *                 section's dominant bar, then a fill segment to the bar end;
 *                 each segment is fitted separately
 *   poor fit    → `steps` block (exact hits): fit error decides the ENCODING,
 *                 deviation from the dominant bar decides what is a FILL
 *   silence     → an empty `steps` block (k=0 isn't expressible) so the
 *                 base groove can't leak through
 *   transitions → always REPORTED (`transitions`); written as a `motion`
 *                 block only when `fillEncoding: "motion"`, in which case the
 *                 motion block REPLACES that fill's own blocks
 *
 * Types below are structural copies of @drum/library's, so the output is
 * assignable to its `DrumBlock[]` without imports.
 */
import { fitEuclid, type OnsetFn } from "./euclidFit.js";

// ---- types (structural copies of @drum/library) ---------------------------

export type DrumLaneId = "kick" | "snare" | "rim" | "hat" | "cym" | "tom";
export const ALL_LANES: readonly DrumLaneId[] = ["kick", "snare", "rim", "hat", "cym", "tom"];

export type KitVoice =
  | "kick" | "snare" | "rim" | "clap" | "closedHat" | "openHat" | "pedalHat"
  | "ride" | "rideBell" | "crash" | "tomLow" | "tomMid" | "tomHigh";

/** DRUM_LANE_PRIMARY — the voice a lane's generated notes play. */
export const LANE_PRIMARY_VOICE: Record<DrumLaneId, KitVoice> = {
  kick: "kick", snare: "snare", rim: "rim", hat: "closedHat", cym: "ride", tom: "tomMid",
};

export interface DrumBlockNote { beat: number; voice: KitVoice; velocity: number }
export interface DrumBlock {
  id: string;
  lane: DrumLaneId;
  groupId?: string;
  /** Section-relative quarter-note beats. */
  startBeat: number;
  endBeat: number;
  mode: "inherit" | "euclid" | "outline" | "steps" | "motion";
  euclid?: { k: number; n: number; rotation: number };
  /** Beats are block-relative. */
  notes?: DrumBlockNote[];
  motion?: { x: number; y: number };
  interleave?: boolean;
}

// ---- input / output types -------------------------------------------------

export type StepVelocities = readonly number[];
export interface GridBar { lanes: Partial<Record<DrumLaneId, StepVelocities>> }
export interface DrumGrid {
  /** Quarter-note beats per bar (assumed constant across the song for now). */
  beatsPerBar: number;
  /** Grid steps per bar: 16 for straight 16ths in 4/4, 12 for triplet feel. */
  stepsPerBar: number;
  bars: readonly GridBar[];
}
export interface SectionInput { id: string; role?: string; startBar: number; bars: number }

export interface ImportOptions {
  /** Lanes to import, default kick / snare / hat. */
  lanes?: readonly DrumLaneId[];
  /** Defaults to a verbatim copy of `euclidOnsetSteps`; pass the real one to be safe. */
  onsets?: OnsetFn;
  /** Max Hamming error to accept a Euclidean fit on a groove segment. */
  euclidTolerance?: number;
  /** Looser tolerance for fill segments (approximate is fine). */
  fillTolerance?: number;
  /** Steps of deviation from the dominant bar that make a bar a fill. */
  fillThreshold?: number;
  /** Lane that carries motion (transition) blocks. */
  motionLane?: DrumLaneId;
  /**
   * "euclid" (default): fills keep their own euclid/steps content and the
   * transition is only reported. "motion": each fill's range is replaced by
   * a single motion block (Track Draft's native gesture; loses fill detail).
   */
  fillEncoding?: "euclid" | "motion";
  /** Default true: silent stretches become empty `steps` blocks. */
  clearBase?: boolean;
  /** Lanes we don't import, cleared across the whole section. Default: the other lanes. */
  clearLanes?: readonly DrumLaneId[];
  /** Voice for `steps` notes. Default: the lane's primary voice. */
  voiceFor?: (lane: DrumLaneId) => KitVoice;
}

export type BarKind = "groove" | "fill" | "silent";
export interface BarReport {
  /** Song-global bar index. */
  bar: number;
  kind: BarKind;
  /** Section-relative beat where a fill begins, when kind === "fill". */
  fillStartBeat?: number;
}
export type TransitionGesture = "build" | "crescendo" | "break" | "thin";
export interface Transition {
  /** Song-global bar index. */
  bar: number;
  kind: "fill" | "boundary";
  /** Section-relative beats. */
  startBeat: number;
  endBeat: number;
  gesture: TransitionGesture;
  x: number;
  y: number;
}
export interface ImportedSection {
  id: string;
  blocks: DrumBlock[];
  /** Mean source velocity (1..127); see sectionPatch.ts for the preset mapping. */
  velocity: number;
  bars: BarReport[];
  transitions: Transition[];
  stats: {
    euclidBlocks: number;
    stepsBlocks: number;
    /** Empty `steps` blocks that clear the base groove. */
    clearBlocks: number;
    motionBlocks: number;
    /** Largest Hamming error among accepted Euclidean fits. */
    worstAcceptedError: number;
  };
}

// ---- helpers ------------------------------------------------------------

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Transition vector for a fill / boundary. `ratio` = next groove density ÷
 * current groove density. Quadrants follow the pad; the test suite asserts
 * each gesture through the real `motionModelFor`:
 *   build → buildUp·2 (sprint) · crescendo → buildUp·3 (slow burn)
 *   break → dropOut · thin → breakDown
 */
export function transitionVector(
  ratio: number, nextDensity: number, hasFill: boolean,
): { x: number; y: number; gesture: TransitionGesture } | null {
  if (nextDensity === 0) return { x: 0, y: -0.8, gesture: "break" };
  const m = round2(clamp(0.4 + Math.abs(ratio - 1), 0.4, 1));
  if (ratio >= 1.15) return { x: round2(0.7 * m), y: round2(0.6 * m), gesture: "build" };
  if (ratio <= 0.85) return { x: round2(-0.6 * m), y: round2(-0.6 * m), gesture: "thin" };
  if (hasFill) return { x: -0.6, y: 0.5, gesture: "crescendo" };
  return null;
}

interface BarAnalysis {
  bar: number;
  kind: BarKind;
  /** Step where the fill begins (beat-aligned when possible). */
  fillStart: number | null;
  hits: number;
}
interface SectionAnalysis {
  section: SectionInput;
  bars: BarAnalysis[];
  /** Hits per bar of the section's groove — drives transitions. */
  density: number;
}

// ---- main ---------------------------------------------------------------

export function gridToBlocks(
  grid: DrumGrid, sections: readonly SectionInput[], opts: ImportOptions = {},
): ImportedSection[] {
  const lanes: readonly DrumLaneId[] = opts.lanes ?? ["kick", "snare", "hat"];
  const euclidTol = opts.euclidTolerance ?? 1;
  const fillTol = opts.fillTolerance ?? 2;
  const fillThreshold = opts.fillThreshold ?? 3;
  const motionLane: DrumLaneId = opts.motionLane ?? "snare";
  const voiceFor = opts.voiceFor ?? ((l: DrumLaneId): KitVoice => LANE_PRIMARY_VOICE[l]);
  const fillEncoding = opts.fillEncoding ?? "euclid";
  const clearBase = opts.clearBase ?? true;
  const clearLanes = opts.clearLanes ?? ALL_LANES.filter((l) => !lanes.includes(l));
  const S = grid.stepsPerBar;
  const stepBeats = grid.beatsPerBar / S;
  const stepsPerBeat = S / grid.beatsPerBar;
  const beatAligned = Math.abs(stepsPerBeat - Math.round(stepsPerBeat)) < 1e-9;
  const alignDown = (step: number): number =>
    beatAligned ? step - (step % Math.round(stepsPerBeat)) : step;

  const bin = (bar: GridBar, lane: DrumLaneId): boolean[] =>
    Array.from({ length: S }, (_, i) => (bar.lanes[lane]?.[i] ?? 0) > 0);
  const hitCount = (bar: GridBar): number =>
    lanes.reduce((c, l) => c + bin(bar, l).filter(Boolean).length, 0);
  const signature = (bar: GridBar): string =>
    lanes.map((l) => bin(bar, l).map((b) => (b ? 1 : 0)).join("")).join("|");

  // pass 1 — classify every bar of every section -------------------------
  const analyses: SectionAnalysis[] = sections.map((section) => {
    const barIdx = Array.from({ length: section.bars }, (_, i) => section.startBar + i)
      .filter((b) => b < grid.bars.length);

    const counts = new Map<string, number>();
    for (const b of barIdx) {
      const sig = signature(grid.bars[b]);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    // dominant bar = most frequent signature (earliest wins ties); a section
    // where nothing repeats has no dominant bar → no fill detection.
    let domSig: string | null = null;
    let domCount = 0;
    for (const b of barIdx) {
      const sig = signature(grid.bars[b]);
      const c = counts.get(sig) ?? 0;
      if (c > domCount) { domSig = sig; domCount = c; }
    }
    const dominant = domCount >= 2 && domSig !== null
      ? grid.bars[barIdx.find((b) => signature(grid.bars[b]) === domSig)!]
      : null;

    const bars: BarAnalysis[] = barIdx.map((b) => {
      const bar = grid.bars[b];
      const hits = hitCount(bar);
      if (hits === 0) return { bar: b, kind: "silent", fillStart: null, hits };
      if (!dominant) return { bar: b, kind: "groove", fillStart: null, hits };
      let deviation = 0;
      let firstDiff = S;
      for (const l of lanes) {
        const x = bin(bar, l);
        const y = bin(dominant, l);
        for (let i = 0; i < S; i++) {
          if (x[i] !== y[i]) { deviation++; if (i < firstDiff) firstDiff = i; }
        }
      }
      if (deviation < fillThreshold) return { bar: b, kind: "groove", fillStart: null, hits };
      return { bar: b, kind: "fill", fillStart: alignDown(firstDiff), hits };
    });

    const grooveBars = dominant ? [dominant] : bars.filter((x) => x.kind !== "silent").map((x) => grid.bars[x.bar]);
    const density = grooveBars.length === 0
      ? 0
      : Math.round(grooveBars.reduce((c, bar) => c + hitCount(bar), 0) / grooveBars.length);
    return { section, bars, density };
  });

  // pass 2 — emit blocks -------------------------------------------------
  return analyses.map((sa, si): ImportedSection => {
    const { section } = sa;
    const nextSection = analyses[si + 1];
    const blocks: DrumBlock[] = [];
    const stats = { euclidBlocks: 0, stepsBlocks: 0, clearBlocks: 0, motionBlocks: 0, worstAcceptedError: 0 };
    const barStartOf = (bar: number): number => (bar - section.startBar) * grid.beatsPerBar;
    const segmentsOf = (ba: BarAnalysis): { a: number; b: number; fill: boolean }[] =>
      ba.fillStart === null ? [{ a: 0, b: S, fill: false }]
      : ba.fillStart === 0 ? [{ a: 0, b: S, fill: true }]
      : [{ a: 0, b: ba.fillStart, fill: false }, { a: ba.fillStart, b: S, fill: true }];

    // transitions: every fill, plus the last bar of any non-final section.
    // Mid-section fills compare against their own section's density.
    const transitions: Transition[] = [];
    for (const ba of sa.bars) {
      const isFill = ba.kind === "fill";
      const isBoundary = nextSection !== undefined && ba.bar === section.startBar + section.bars - 1;
      if (!isFill && !isBoundary) continue;
      const nextDensity = isBoundary ? nextSection!.density : sa.density;
      const ratio = sa.density > 0 ? nextDensity / sa.density : 1;
      const vec = transitionVector(ratio, nextDensity, isFill);
      if (!vec) continue;
      const start = round4(barStartOf(ba.bar) + (ba.fillStart ?? 0) * stepBeats);
      const end = round4(barStartOf(ba.bar) + grid.beatsPerBar);
      transitions.push({
        bar: ba.bar, kind: isFill ? "fill" : "boundary",
        startBeat: start, endBeat: end, gesture: vec.gesture, x: vec.x, y: vec.y,
      });
    }
    // bars whose fill segment is handed to a motion block instead
    const motionBars = new Set(
      fillEncoding === "motion" ? transitions.filter((t) => t.kind === "fill").map((t) => t.bar) : [],
    );

    // lane-major so consecutive silent segments merge into one clear block
    for (const lane of lanes) {
      let clear: { start: number; end: number } | null = null;
      const flush = (): void => {
        if (clear && clearBase) {
          blocks.push({
            id: `blk-${lane}-${clear.start}-${clear.end}-steps`,
            lane, startBeat: clear.start, endBeat: clear.end, mode: "steps", notes: [],
          });
          stats.clearBlocks++;
        }
        clear = null;
      };
      for (const ba of sa.bars) {
        const vel = grid.bars[ba.bar].lanes[lane] ?? [];
        for (const seg of segmentsOf(ba)) {
          const start = round4(barStartOf(ba.bar) + seg.a * stepBeats);
          const end = round4(barStartOf(ba.bar) + seg.b * stepBeats);
          if (seg.fill && motionBars.has(ba.bar)) { flush(); continue; }
          const slice = Array.from({ length: seg.b - seg.a }, (_, i) => vel[seg.a + i] ?? 0);
          const on = slice.map((x) => x > 0);
          if (!on.some(Boolean)) {
            clear = clear ? { start: clear.start, end } : { start, end };
            continue;
          }
          flush();
          const fit = fitEuclid(on, { onsets: opts.onsets });
          const tol = seg.fill ? fillTol : euclidTol;
          if (fit && fit.error <= tol) {
            blocks.push({
              id: `blk-${lane}-${start}-${end}-euclid`,
              lane, startBeat: start, endBeat: end, mode: "euclid",
              euclid: { k: fit.k, n: fit.n, rotation: fit.rotation },
            });
            stats.euclidBlocks++;
            stats.worstAcceptedError = Math.max(stats.worstAcceptedError, fit.error);
          } else {
            const notes: DrumBlockNote[] = [];
            slice.forEach((x, i) => {
              if (x > 0) notes.push({ beat: round4(i * stepBeats), voice: voiceFor(lane), velocity: clamp(Math.round(x), 1, 127) });
            });
            blocks.push({
              id: `blk-${lane}-${start}-${end}-steps`,
              lane, startBeat: start, endBeat: end, mode: "steps", notes,
            });
            stats.stepsBlocks++;
          }
        }
      }
      flush();
    }

    // lanes we don't import: wipe whatever the base put there
    if (clearBase && section.bars > 0) {
      for (const lane of clearLanes) {
        if (lanes.includes(lane)) continue;
        const end = round4(section.bars * grid.beatsPerBar);
        blocks.push({ id: `blk-${lane}-0-${end}-steps`, lane, startBeat: 0, endBeat: end, mode: "steps", notes: [] });
        stats.clearBlocks++;
      }
    }

    if (fillEncoding === "motion") {
      for (const t of transitions) {
        if (!motionBars.has(t.bar) || t.kind !== "fill") continue;
        blocks.push({
          id: `blk-${motionLane}-${t.startBeat}-${t.endBeat}-motion`,
          lane: motionLane, startBeat: t.startBeat, endBeat: t.endBeat, mode: "motion",
          motion: { x: t.x, y: t.y },
        });
        stats.motionBlocks++;
      }
    }

    blocks.sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id));

    const velocities: number[] = [];
    for (const ba of sa.bars) {
      for (const lane of lanes) {
        for (const x of grid.bars[ba.bar].lanes[lane] ?? []) if (x > 0) velocities.push(x);
      }
    }
    const velocity = velocities.length
      ? clamp(Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length), 1, 127)
      : 100;

    return {
      id: section.id,
      blocks,
      velocity,
      bars: sa.bars.map((b) => ({
        bar: b.bar,
        kind: b.kind,
        ...(b.kind === "fill" && b.fillStart !== null
          ? { fillStartBeat: round4(b.fillStart * stepBeats) } : {}),
      })),
      transitions,
      stats,
    };
  });
}
