import {
  bandEnergies, fitBeatGrid, onsetStrength, pickPeaks, quantile,
  type Band,
} from "./dsp";

/**
 * The grid transcriber — audio samples + a known song grid (bpm, meter,
 * section bars) in, per-step per-lane velocities out. This is the piece
 * that turns an mp3 into the `DrumGrid` the importer runner consumes.
 *
 * Architecture: ONSET-DRIVEN lane decisions (learned the hard way):
 *   1. per-frame band energies, per-band log1p onset strength;
 *   2. onsets = adaptive peaks of the TOTAL flux (one peak per drum
 *      event, regardless of which drum it was);
 *   3. each onset's BODY energies (max in the 40 ms after it) decide the
 *      lanes — body energies separate kick from snare by >1000×, whereas
 *      flux alone does not (a sharp low attack splashes upward into the
 *      higher bands, so every flux band spikes at every onset);
 *   4. hats additionally pass a SHAPE test (upper HF 8–10k vs mid HF
 *      3.5–5.5k): real hats carry strong 8–10k energy, a kick's attack
 *      splash rolls off with frequency — without this, every kick reads
 *      as a hat;
 *   5. every onset is assigned to its nearest grid step (center-corrected
 *      time — a flux peak fires on the window that first CONTAINS the
 *      attack, so the event lies up to a window-hop later than the frame
 *      time), and velocities come from body energy relative to the lane's
 *      own p90;
 *   6. a per-SECTION phase vote re-labels each arrangement region to the
 *      backbeat-optimal step family — a band's phase relative to a rigid
 *      grid wanders across a song, and where it crosses a rounding
 *      boundary the steps flip family mid-song (the snare reading 5,13
 *      in the first verse then 4,12 after the first chorus — real Drive
 *      My Car behaviour).
 *
 * Pure + deterministic — see analysis.test.ts for the synthetic-signal
 * pinning.
 */

export type LaneName = "kick" | "snare" | "hat";
export const LANE_NAMES: LaneName[] = ["kick", "snare", "hat"];

/** The analysis band set: three lane bodies + the HF shape pair for hats. */
export const ANALYSIS_BANDS = {
  kick: [30, 120],
  snare: [150, 500],
  hat: [6000, 10000],
  hatHi: [8000, 10000],
  hatLo: [3500, 5500],
} satisfies Record<string, Band> as Record<string, Band>;

export interface TranscribeOptions {
  sampleRate: number;
  /** Blueprint tempo. The fit corrects a few ‰ either way. */
  bpm: number;
  beatsPerBar: number;
  /** 16 for straight 16ths, 12 for triplet feel (per the importer format). */
  stepsPerBar: number;
  /** Beats the grid spans — sum of the arrangement's bars × beatsPerBar. */
  totalBeats: number;
  bands?: Record<string, Band>;
  /** Onset-peak sensitivity (median + k·σ, floored at p99.5·0.2). Default 6. */
  peakK?: number;
  /** Onset→step tolerance as a fraction of a step. Default 0.4. */
  tolerancePct?: number;
  /** Skip the grid fit and use these (seconds / tempo multiplier). */
  fixed?: { offset: number; scale: number };
  /** Body window (seconds) after an onset for the lane decisions. Default 0.04. */
  bodySec?: number;
  /** Tail probe window (seconds) — the decay test that separates impulsive
   *  hits (kicks, snares) from sustained notes (bass). Default 0.18. */
  tailSec?: number;
  /** Lane decision threshold as a fraction of that lane's p90 body level.
   *  Default 0.25. */
  laneThresholdPct?: number;
  /** Hat shape gate: hatHi must exceed this × hatLo. Default 0.15 — tape-era
   *  recordings (1960s masters) carry little 8–10k, so the gate only needs
   *  to reject obvious downward rolloff. */
  hatShapeRatio?: number;
  /** Tail gates: an event whose body energy is still this loud at +tailSec
   *  is a SUSTAINED note, not a drum. Defaults: kick 0.5, snare 0.8. */
  kickTailPct?: number;
  snareTailPct?: number;
  /** Arrangement regions (global bar spans). When given (16-step grids
   *  only), each region's onsets are re-labeled by the phase vote so its
   *  pattern reads the backbeat-optimal step family. */
  sectionSpans?: { startBar: number; bars: number }[];
}

export interface TranscribeResult {
  offset: number;
  scale: number;
  beatsPerBar: number;
  stepsPerBar: number;
  bars: number;
  /** [lane][bar][step] → velocity 1..127 (0 = rest). */
  lanes: Record<LaneName, number[][]>;
  /** Detected onsets (flux peaks). */
  onsets: number;
  /** Onsets assigned to a step per lane. */
  hits: Record<LaneName, number>;
  /** Per-onset measurements + lane decisions — the CLI's tuning view. */
  onsetLog: OnsetLog[];
  /** Per-region step shift chosen by the phase vote (0 = kept as-is). */
  phaseShifts: { startBar: number; bars: number; shift: number }[];
}

export interface OnsetLog {
  time: number;
  body: { kick: number; snare: number; hat: number; hatHi: number; hatLo: number };
  tail: { kick: number; snare: number; hat: number };
  lanes: LaneName[];
}

/** Velocity from a body energy relative to its lane's p90. */
export function velocityFromStrength(rel: number): number {
  return Math.max(20, Math.min(120, Math.round(30 + 90 * Math.min(1, rel))));
}

/** Backbeat priors (16-step 4/4 bar): where each lane CLAIMS its steps.
 *  Kick: beats 1 & 3 plus the syncopated 16ths around them; snare: beats
 *  2 & 4, nothing else; hats: eighths (even steps) — kept flattish and
 *  low-weight so they can only break ties, never steer the vote. */
const KICK_PRIOR = [1.0, 0.05, 0.5, 0.05, 0.2, 0.05, 0.5, 0.05, 0.9, 0.05, 0.4, 0.05, 0.2, 0.05, 0.5, 0.05];
const SNARE_PRIOR = [0.05, 0.05, 0.05, 0.05, 1.0, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 1.0, 0.05, 0.05, 0.05];
const HAT_PRIOR = [0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3];
const LANE_VOTE_WEIGHT: Record<LaneName, number> = { kick: 1, snare: 1.3, hat: 0.3 };

/**
 * The per-section phase vote: for one region, score every integer step
 * shift k ∈ [−8..8] by how well the region's hit positions (raw + k)
 * match the backbeat priors, and keep the best shift only when it beats
 * the unshifted labeling by 15 %+ (and prefer the nearest shift on ties).
 */
function voteSectionPhases(
  rows: { raw: number; kick: boolean; snare: boolean; hat: boolean }[],
  spans: { startBar: number; bars: number }[],
): { startBar: number; bars: number; shift: number }[] {
  const out: { startBar: number; bars: number; shift: number }[] = [];
  for (const span of spans) {
    const lo = span.startBar * 16;
    const hi = (span.startBar + span.bars) * 16;
    const scores = new Map<number, number>();
    for (let k = -8; k <= 8; k++) scores.set(k, 0);
    let used = 0;
    for (const row of rows) {
      if (row.raw < lo || row.raw >= hi || (!row.kick && !row.snare && !row.hat)) continue;
      used++;
      const pos = ((row.raw % 16) + 16) % 16;
      for (let k = -8; k <= 8; k++) {
        const p = (pos + k + 16) % 16;
        let add = 0;
        if (row.kick) add += LANE_VOTE_WEIGHT.kick * KICK_PRIOR[p];
        if (row.snare) add += LANE_VOTE_WEIGHT.snare * SNARE_PRIOR[p];
        if (row.hat) add += LANE_VOTE_WEIGHT.hat * HAT_PRIOR[p];
        scores.set(k, (scores.get(k) ?? 0) + add);
      }
    }
    let shift = 0;
    if (used > 0) {
      const base = scores.get(0) ?? 0;
      let bestScore = -Infinity;
      for (const sc of scores.values()) if (sc > bestScore) bestScore = sc;
      if (base > 0 && bestScore >= 1.15 * base) {
        // Among near-best shifts prefer the SMALLEST |k|: a half-bar-rotated
        // representative (k ± 8) ties on symmetric patterns and would
        // otherwise relocate a section's syncopations for no gain.
        let bestK = 0;
        let bestAbs = Infinity;
        for (const [k, sc] of scores) {
          if (sc < 0.99 * bestScore) continue;
          const abs = Math.abs(k);
          if (abs < bestAbs || (abs === bestAbs && k < bestK)) {
            bestAbs = abs;
            bestK = k;
          }
        }
        shift = bestK;
      }
    }
    out.push({ startBar: span.startBar, bars: span.bars, shift });
  }
  return out;
}

/** Leading silence prepended before analysis: a hit exactly at t=0 would
 *  otherwise have no "previous frame" to rise from and vanishes from the
 *  flux. Everything runs in padded time; the REPORTED offset is mapped
 *  back to original-audio seconds. */
const LEAD_PAD_SEC = 0.05;

function withLeadPad(samples: Float32Array, sampleRate: number): Float32Array {
  const pad = Math.max(0, Math.round(LEAD_PAD_SEC * sampleRate));
  if (pad === 0) return samples;
  const out = new Float32Array(samples.length + pad);
  out.set(samples, pad);
  return out;
}

export function transcribe(samples: Float32Array, opts: TranscribeOptions): TranscribeResult {
  const bands = opts.bands ?? ANALYSIS_BANDS;
  const peakK = opts.peakK ?? 6;
  const tolPct = opts.tolerancePct ?? 0.4;
  const laneThresholdPct = opts.laneThresholdPct ?? 0.25;
  const hatShapeRatio = opts.hatShapeRatio ?? 0.15;
  const kickTailPct = opts.kickTailPct ?? 0.5;
  const snareTailPct = opts.snareTailPct ?? 0.8;
  const stepsPerBar = opts.stepsPerBar;

  const energies = bandEnergies(withLeadPad(samples, opts.sampleRate), opts.sampleRate, bands);

  const flux = {} as Record<string, Float64Array>;
  const total = new Float64Array(energies.frames);
  for (const name of Object.keys(bands)) {
    flux[name] = onsetStrength(energies.bands[name]);
    for (let i = 0; i < total.length; i++) total[i] += flux[name][i];
  }

  // fit in padded time, report in original-audio time
  const fitted = opts.fixed
    ? { offset: opts.fixed.offset + LEAD_PAD_SEC, scale: opts.fixed.scale }
    : fitBeatGrid(total, energies.hopSec, opts.bpm, opts.totalBeats);
  const offset = fitted.offset;
  const stepSec = (opts.beatsPerBar / stepsPerBar) * (60 / opts.bpm) * fitted.scale;
  const bars = Math.max(1, Math.ceil(opts.totalBeats / opts.beatsPerBar));
  const totalSteps = bars * stepsPerBar;
  const tol = tolPct * stepSec;

  // A flux peak fires on the first window that CONTAINS the attack, so the
  // event lies within (frame·hop, frame·hop + window − hop] — use the
  // interval's center as the onset time.
  const onsetCenter = (energies.windowSec - energies.hopSec) / 2;
  const bodyFrames = Math.max(1, Math.round((opts.bodySec ?? 0.04) / energies.hopSec));
  const tailShift = Math.max(1, Math.round((opts.tailSec ?? 0.18) / energies.hopSec));
  const bodyAt = (band: Float64Array, frame: number): number => {
    let m = 0;
    const end = Math.min(band.length - 1, frame + bodyFrames);
    for (let f = frame; f <= end; f++) if (band[f] > m) m = band[f];
    return m;
  };
  /** mean energy in a small window around `frame` + tailShift — how much of
   *  the event is still ringing after the attack (sustained notes stay loud). */
  const tailAt = (band: Float64Array, frame: number): number => {
    const center = frame + tailShift;
    let sum = 0;
    let n = 0;
    for (let f = center - 2; f <= center + 2; f++) {
      if (f < 0 || f >= band.length) continue;
      sum += band[f];
      n++;
    }
    return n > 0 ? sum / n : 0;
  };

  interface Onset { time: number; frame: number; kick: number; snare: number; hat: number; hatHi: number; hatLo: number; kickTail: number; snareTail: number; hatTail: number }
  const peaks = pickPeaks(total, { k: peakK });
  const hatHiBand = energies.bands.hatHi ?? energies.bands.hat;
  const hatLoBand = energies.bands.hatLo ?? energies.bands.hat;
  const onsets: Onset[] = peaks.map((p) => ({
    time: p.frame * energies.hopSec + onsetCenter,
    frame: p.frame,
    kick: bodyAt(energies.bands.kick, p.frame),
    snare: bodyAt(energies.bands.snare, p.frame),
    hat: bodyAt(energies.bands.hat, p.frame),
    hatHi: bodyAt(hatHiBand, p.frame),
    hatLo: bodyAt(hatLoBand, p.frame),
    kickTail: tailAt(energies.bands.kick, p.frame),
    snareTail: tailAt(energies.bands.snare, p.frame),
    hatTail: tailAt(energies.bands.hat, p.frame),
  }));

  const p90 = (pick: (o: Onset) => number): number =>
    quantile(Float64Array.from(onsets.map(pick).filter((v) => v > 0)), 0.9) || 1;
  const p90k = p90((o) => o.kick);
  const p90s = p90((o) => o.snare);
  const p90h = p90((o) => o.hat);

  // Phase polish: the beat fit aligns the BEAT pulse (and onset peaks carry
  // a small window bias), so it can sit up to half a 16th off — invisible at
  // beat level, fatal at step level (everything snaps to odd steps).
  // Re-center on the actual onset times with a CIRCULAR mean of their
  // residuals: when the error is exactly half a step the residuals scatter
  // ±half-step and a plain median reads zero, while the circular mean still
  // sees the lean and resolves the direction.
  let sumCos = 0;
  let sumSin = 0;
  let residualCount = 0;
  for (const o of onsets) {
    const idx = Math.round((o.time - offset) / stepSec);
    if (idx < 0 || idx >= totalSteps) continue;
    const r = o.time - (offset + idx * stepSec);
    const a = (2 * Math.PI * r) / stepSec;
    sumCos += Math.cos(a);
    sumSin += Math.sin(a);
    residualCount++;
  }
  const circularShift = residualCount > 0
    ? (Math.atan2(sumSin / residualCount, sumCos / residualCount) * stepSec) / (2 * Math.PI)
    : 0;
  const phaseShift = Math.max(-0.45 * stepSec, Math.min(0.45 * stepSec, circularShift));
  const gridOffset = offset + phaseShift;

  const lanes = {} as Record<LaneName, number[][]>;
  for (const lane of LANE_NAMES) lanes[lane] = Array.from({ length: bars }, () => new Array<number>(stepsPerBar).fill(0));
  const hits = { kick: 0, snare: 0, hat: 0 } as Record<LaneName, number>;
  const fired: Record<LaneName, number[]> = { kick: [], snare: [], hat: [] };

  interface Decision { bar: number; step: number; kick: number; snare: number; hat: number }
  const decisions: Decision[] = [];
  const onsetLog: OnsetLog[] = [];

  interface Flagged { time: number; kick: boolean; snare: boolean; hat: boolean; raw: number; kickE: number; snareE: number; hatE: number }
  const flagged: Flagged[] = [];

  for (const o of onsets) {
    const isKick = o.kick > laneThresholdPct * p90k && o.kick >= 0.3 * Math.max(o.snare, o.hat)
      && o.kickTail < kickTailPct * o.kick;
    const isSnare = o.snare > laneThresholdPct * p90s && o.snare >= 0.3 * Math.max(o.kick, o.hat)
      && o.snareTail < snareTailPct * o.snare;
    // hats: level + shape (a kick's attack splash rolls off with frequency,
    // a real hat carries the upper HF band)
    const isHat = o.hat > 0.15 * p90h && o.hatHi > hatShapeRatio * o.hatLo;
    onsetLog.push({
      time: o.time - LEAD_PAD_SEC,
      body: { kick: o.kick, snare: o.snare, hat: o.hat, hatHi: o.hatHi, hatLo: o.hatLo },
      tail: { kick: o.kickTail, snare: o.snareTail, hat: o.hatTail },
      lanes: [...(isKick ? ["kick"] : []), ...(isSnare ? ["snare"] : []), ...(isHat ? ["hat"] : [])] as LaneName[],
    });
    flagged.push({
      time: o.time,
      kick: isKick,
      snare: isSnare,
      hat: isHat,
      raw: Math.round((o.time - gridOffset) / stepSec),
      kickE: o.kick,
      snareE: o.snare,
      hatE: o.hat,
    });
  }

  // The per-section phase vote (see voteSectionPhases): regions whose hits
  // all fell onto the wrong family get an integer step shift before the
  // final assignment. Rows need a real residual (inside tolerance) or they
  // would drag the vote toward noise.
  const voteRows = flagged
    .filter((f) => (f.kick || f.snare || f.hat)
      && f.raw >= 0 && f.raw < totalSteps
      && Math.abs(f.time - (gridOffset + f.raw * stepSec)) <= tol)
    .map((f) => ({ raw: f.raw, kick: f.kick, snare: f.snare, hat: f.hat }));
  const phaseShifts = stepsPerBar === 16 && opts.sectionSpans && opts.sectionSpans.length > 0
    ? voteSectionPhases(voteRows, opts.sectionSpans)
    : [];
  const shiftAt = (raw: number): number => {
    if (phaseShifts.length === 0) return 0;
    const bar = Math.max(0, Math.min(bars - 1, Math.floor(raw / stepsPerBar)));
    for (const s of phaseShifts) {
      if (bar >= s.startBar && bar < s.startBar + s.bars) return s.shift;
    }
    return 0;
  };

  for (const f of flagged) {
    if (!f.kick && !f.snare && !f.hat) continue;
    if (f.raw < 0 || f.raw >= totalSteps) continue;
    if (Math.abs(f.time - (gridOffset + f.raw * stepSec)) > tol) continue;
    const idx = f.raw + shiftAt(f.raw);
    if (idx < 0 || idx >= totalSteps) continue;
    decisions.push({
      bar: Math.floor(idx / stepsPerBar),
      step: idx % stepsPerBar,
      kick: f.kick ? f.kickE : 0,
      snare: f.snare ? f.snareE : 0,
      hat: f.hat ? f.hatE : 0,
    });
    if (f.kick) fired.kick.push(f.kickE);
    if (f.snare) fired.snare.push(f.snareE);
    if (f.hat) fired.hat.push(f.hatE);
    hits.kick += f.kick ? 1 : 0;
    hits.snare += f.snare ? 1 : 0;
    hits.hat += f.hat ? 1 : 0;
  }

  // velocities relative to each lane's own fired p90, so quiet songs still
  // produce usable dynamics
  const vel = (values: number[], v: number): number =>
    velocityFromStrength(v / (quantile(Float64Array.from(values), 0.9) || 1));
  for (const d of decisions) {
    if (d.kick > 0) lanes.kick[d.bar][d.step] = Math.max(lanes.kick[d.bar][d.step], vel(fired.kick, d.kick));
    if (d.snare > 0) lanes.snare[d.bar][d.step] = Math.max(lanes.snare[d.bar][d.step], vel(fired.snare, d.snare));
    if (d.hat > 0) lanes.hat[d.bar][d.step] = Math.max(lanes.hat[d.bar][d.step], vel(fired.hat, d.hat));
  }

  return {
    offset: gridOffset - LEAD_PAD_SEC,
    scale: fitted.scale,
    beatsPerBar: opts.beatsPerBar,
    stepsPerBar,
    bars,
    lanes,
    onsets: onsets.length,
    hits,
    onsetLog,
    phaseShifts,
  };
}

/** ASCII view of the first bars — the CLI's debug readout. */
export function asciiBars(result: TranscribeResult, maxBars = 4, fromBar = 0): string {
  const lines: string[] = [];
  const last = Math.min(result.bars, fromBar + maxBars);
  for (let bar = fromBar; bar < last; bar++) {
    lines.push(`bar ${String(bar).padStart(2)}`);
    for (const lane of LANE_NAMES) {
      const row = result.lanes[lane][bar].map((v) => (v > 0 ? "x" : ".")).join("");
      lines.push(`  ${lane.padEnd(5)} |${row}|`);
    }
  }
  return lines.join("\n");
}
