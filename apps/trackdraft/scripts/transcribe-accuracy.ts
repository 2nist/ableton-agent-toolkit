/**
 * Measure an audio transcription against a MIDI transcription of the same
 * song, lane by lane, on the shared 16th-step grid.
 *
 *   npx tsx scripts/transcribe-accuracy.ts <ground-truth.json> <test.json> [--verbose]
 *
 * Ground truth is usually the MIDI-derived analysis (human-made); the test
 * is usually the audio-derived one. Reports per-lane precision / recall /
 * IoU, then re-scores with an optimal per-section phase shift (k steps,
 * circular within each bar) so alignment error is separated from content
 * error — the two need completely different fixes.
 */
import { readFileSync } from "node:fs";

type Analysis = {
  stepsPerBar?: number;
  bars?: Array<{ lanes?: Record<string, number[]> }>;
  sections?: Array<{ sectionId?: string; startBar: number; bars: number }>;
};

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const [gtPath, testPath] = args.filter((a) => !a.startsWith("--"));
if (!gtPath || !testPath) {
  console.error("Usage: npx tsx scripts/transcribe-accuracy.ts <ground-truth.json> <test.json> [--verbose]");
  process.exit(1);
}
const gt = JSON.parse(readFileSync(gtPath, "utf8")) as Analysis;
const test = JSON.parse(readFileSync(testPath, "utf8")) as Analysis;
const steps = gt.stepsPerBar ?? 16;
const nBars = Math.min(gt.bars?.length ?? 0, test.bars?.length ?? 0);
const lanes = ["kick", "snare", "hat"];

const cell = (a: Analysis, bar: number, lane: string, step: number): boolean => {
  const v = a.bars?.[bar]?.lanes?.[lane]?.[((step % steps) + steps) % steps];
  return (v ?? 0) > 0;
};
const shiftedCell = (a: Analysis, bar: number, lane: string, step: number, k: number): boolean =>
  cell(a, bar, lane, step - k);

function score(lane: string, k: number, from = 0, to = nBars) {
  let tp = 0, fp = 0, fn = 0;
  for (let b = from; b < to; b++) {
    for (let s = 0; s < steps; s++) {
      const g = cell(gt, b, lane, s);
      const t = shiftedCell(test, b, lane, s, k);
      if (g && t) tp++;
      else if (!g && t) fp++;
      else if (g && !t) fn++;
    }
  }
  const iou = tp / Math.max(1, tp + fp + fn);
  const p = tp / Math.max(1, tp + fp);
  const r = tp / Math.max(1, tp + fn);
  return { iou, p, r, tp, fp, fn };
}

function bestShift(lane: string, from = 0, to = nBars) {
  let best = { k: 0, iou: -1 };
  for (let k = -8; k <= 8; k++) {
    const s = score(lane, k, from, to);
    if (s.iou > best.iou + 1e-9) best = { k, iou: s.iou };
  }
  return best;
}

console.log(`GT:   ${gtPath.split("/").pop()}  (${gt.bars?.length ?? 0} bars)`);
console.log(`TEST: ${testPath.split("/").pop()}  (${test.bars?.length ?? 0} bars)`);
console.log(`compared: ${nBars} bars · ${steps} steps/bar\n`);
console.log("lane    IoU    prec   rec    | best-k  IoU@k   (phase) | content-clean IoU");
for (const lane of lanes) {
  const s0 = score(lane, 0);
  const bs = bestShift(lane);
  const contentOnly = Math.max(s0.iou, bs.iou);
  console.log(
    `${lane.padEnd(6)} ${s0.iou.toFixed(3)}  ${s0.p.toFixed(3)}  ${s0.r.toFixed(3)}  | ${String(bs.k).padStart(3)}    ${bs.iou.toFixed(3)}            | ${contentOnly.toFixed(3)}`,
  );
}
if (verbose && gt.sections?.length) {
  console.log("\nper-section best kick shift (audio side needs it; 0 = aligned):");
  const header = gt.sections.map((s) => `s@${s.startBar}`).join(" ");
  const shifts = gt.sections.map((s) => bestShift("kick", s.startBar, s.startBar + s.bars).k);
  console.log(`bars:   ${header}`);
  console.log(`kick k: ${shifts.map((k) => String(k).padStart(5)).join(" ")}`);
}

// ---- dominant-pattern mode (--sets): the "euclidean essence" view ----
if (verbose && process.argv.includes("--sets") && gt.sections?.length) {
  const dominant = (a: Analysis, lane: string, from: number, to: number): Set<number> => {
    const counts = new Array(steps).fill(0);
    for (let b = from; b < to; b++) for (let s = 0; s < steps; s++) if (cell(a, b, lane, s)) counts[s]++;
    const threshold = Math.max(2, Math.ceil(0.5 * Math.max(1, to - from)));
    const set = new Set<number>();
    counts.forEach((c, s) => { if (c >= threshold && c > 0) set.add(s); });
    return set;
  };
  const jac = (a: Set<number>, b: Set<number>): number => {
    const inter = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 1 : inter / union;
  };
  console.log("\ndominant step-sets per section (GT vs TEST) — the pattern-essence view:");
  const cols = ["kick", "snare", "hat"];
  const means: Record<string, number[]> = { kick: [], snare: [], hat: [] };
  for (const lane of cols) {
    const line = gt.sections.map((s) => {
      const a = dominant(gt, lane, s.startBar, s.startBar + s.bars);
      const b = dominant(test, lane, s.startBar, s.startBar + s.bars);
      const j = jac(a, b);
      means[lane].push(j);
      return `${[...a].map((x) => x.toString(16)).join("") || "·"}/${[...b].map((x) => x.toString(16)).join("") || "·"}=${j.toFixed(2)}`;
    });
    const mean = means[lane].reduce((x, y) => x + y, 0) / Math.max(1, means[lane].length);
    console.log(`${lane.padEnd(5)} mean ${mean.toFixed(2)}  ${line.join("  ")}`);
  }
}
