/* ============================================================
   HONEYCOMB WALK ENGINE — pure-logic core extracted from
   HarmonicHoneycomb.tsx.

   degree(q,r) = (3q + r) mod 7

   This module has zero React / store / audio dependencies.
   It provides:
     · Hex grid math (degree, distance, pixel conversion)
     · Chord text parser (roman numerals → HoneycombStep[])
     · Chord construction engine (intervals, voicings, bass)
     · Walk-path builder (steps → hex cell positions)
     · Display helpers (roman numerals, letter names, chord names)
     · Reference data (keys, modes, quality chips, borrowed chords)
   ============================================================ */

/* ---------------------------------------------------------------
   TYPES
   --------------------------------------------------------------- */
export interface HexCell {
  q: number;
  r: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface DiatonicChord {
  minor: boolean;
  suffix: string;
}

export interface HoneycombStep {
  deg: number;        // 0-6 scale degree index
  acc: number;        // -1=flat, 0=natural, 1=sharp
  minor: boolean;
  suffix: string;     // e.g. "maj7", "7", "7b9", ""
  bass: number | null; // 3, 5, 7 or null (root position)
}

export interface WalkLoop {
  dq: number;
  dr: number;
  translated: boolean; // true when first ≠ last hex cell
}

export type ModeName =
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian";

export interface ContentBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ---------------------------------------------------------------
   CONSTANTS — hex math
   --------------------------------------------------------------- */
export const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
];

export function mod7(n: number): number {
  return ((n % 7) + 7) % 7;
}

/** The core invariant: each hex cell's scale degree is
 *  (3q + r) mod 7. */
export function degreeAt(q: number, r: number): number {
  return mod7(3 * q + r);
}

/** Axial hex distance. */
export function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

/* ---------------------------------------------------------------
   CONSTANTS — geometry
   --------------------------------------------------------------- */
export const HEX_SIZE = 46;

/** Pointy-top axial → pixel centre — the degree axis (q) runs
 *  horizontally, so the diatonic ring reads left-to-right (wide) instead
 *  of top-to-bottom (tall), matching the app's horizontal layout. */
export function hexToPixel(q: number, r: number, size = HEX_SIZE): Vec2 {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

/** SVG polygon points for a pointy-top hex centred at (0,0). */
export function hexPoints(size = HEX_SIZE - 2.5, seed?: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    // A seed nudges each corner by a fraction of a pixel, deterministically, so
    // the cell reads as drawn by hand — and is identical on every render and
    // every frame, because it is a function of the seed and nothing else.
    const wobble = seed === undefined ? 0 : (((seed * 2654435761 + i * 40503) >>> 12) % 100) / 100 - 0.5;
    const r = size + wobble * 1.6;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/* ---------------------------------------------------------------
   CONSTANTS — keys & roman numerals
   --------------------------------------------------------------- */
export const ROMAN_UP = ["I", "II", "III", "IV", "V", "VI", "VII"];

export const KEYS: Record<string, string[]> = {
  C: ["C","D","E","F","G","A","B"],
  G: ["G","A","B","C","D","E","F#"],
  D: ["D","E","F#","G","A","B","C#"],
  A: ["A","B","C#","D","E","F#","G#"],
  E: ["E","F#","G#","A","B","C#","D#"],
  B: ["B","C#","D#","E","F#","G#","A#"],
  "F#": ["F#","G#","A#","B","C#","D#","E#"],
  Db: ["Db","Eb","F","Gb","Ab","Bb","C"],
  Ab: ["Ab","Bb","C","Db","Eb","F","G"],
  Eb: ["Eb","F","G","Ab","Bb","C","D"],
  Bb: ["Bb","C","D","Eb","F","G","A"],
  F: ["F","G","A","Bb","C","D","E"],
};

export const KEY_MIDI: Record<string, number> = {
  C: 48, G: 55, D: 50, A: 45, E: 52, B: 47, "F#": 54,
  Db: 49, Ab: 44, Eb: 51, Bb: 46, F: 53,
};

/* ---------------------------------------------------------------
   CONSTANTS — modes
   --------------------------------------------------------------- */
export const MODE_ORDER: ModeName[] = [
  "ionian", "dorian", "phrygian", "lydian",
  "mixolydian", "aeolian", "locrian",
];

export const MODE_LABELS: Record<ModeName, string> = {
  ionian: "Ionian", dorian: "Dorian", phrygian: "Phrygian",
  lydian: "Lydian", mixolydian: "Mixolydian",
  aeolian: "Aeolian", locrian: "Locrian",
};

/** Maps mode name → the key used to look up intervals in
 *  SCALE_INTERVALS. */
export const MODE_TO_SCALE_KEY: Record<ModeName, string> = {
  ionian: "major", dorian: "dorian", phrygian: "phrygian",
  lydian: "lydian", mixolydian: "mixolydian",
  aeolian: "minor", locrian: "locrian",
};

/** Semitone intervals from the tonic for each of the 7 modes.
 *  Index 0 = root (always 0), then the 6 remaining scale degrees. */
export const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

/* ---------------------------------------------------------------
   CONSTANTS — colours
   The degree hues are theme data, not constants: they live beside the rest
   of the instrument palette in theme/palette.ts (`usePalette().hues`).
   --------------------------------------------------------------- */
export type { HueSet } from "../../theme/palette";

/* ---------------------------------------------------------------
   CONSTANTS — borrowed chords
   --------------------------------------------------------------- */
export interface BorrowedMove {
  label: string;
  p: Partial<HoneycombStep>;
}

/** Borrowed & secondary chord options per scale degree (0-6). */
export const BORROWED: Record<number, BorrowedMove[]> = {
  0: [
    { label: "I7 (V7/IV)", p: { minor: false, suffix: "7" } },
    { label: "i — parallel minor", p: { minor: true, suffix: "" } },
    { label: "Imaj7♯11 — lydian", p: { minor: false, suffix: "maj7#11" } },
  ],
  1: [
    { label: "II7 (V/V)", p: { minor: false, suffix: "7" } },
    { label: "♭II — Neapolitan", p: { acc: -1, minor: false, suffix: "" } },
    { label: "iiø7 — from minor", p: { minor: true, suffix: "7b5" } },
  ],
  2: [
    { label: "III7 (V/vi)", p: { minor: false, suffix: "7" } },
    { label: "♭III — borrowed", p: { acc: -1, minor: false, suffix: "" } },
  ],
  3: [
    { label: "iv — minor plagal", p: { minor: true, suffix: "" } },
    { label: "IV7 — blues", p: { minor: false, suffix: "7" } },
    { label: "ivm6", p: { minor: true, suffix: "6" } },
  ],
  4: [
    { label: "v — modal", p: { minor: true, suffix: "" } },
    { label: "V7♭9", p: { minor: false, suffix: "7b9" } },
    { label: "V7♯9 — Hendrix", p: { minor: false, suffix: "7#9" } },
  ],
  5: [
    { label: "VI7 (V/ii)", p: { minor: false, suffix: "7" } },
    { label: "♭VI — borrowed", p: { acc: -1, minor: false, suffix: "" } },
  ],
  6: [
    { label: "♭VII — borrowed", p: { acc: -1, minor: false, suffix: "" } },
    { label: "viiø7", p: { minor: true, suffix: "7b5" } },
    { label: "VII7 (V/iii)", p: { minor: false, suffix: "7" } },
  ],
};

/* ============================================================
   DIATONIC CHORD ENGINE
   ============================================================ */

/** Stacks thirds on scale degree `degIdx` (0-6) within a 7-note
 *  interval set (semitone offsets from the tonic) to get the
 *  diatonic triad + seventh chord at that degree. */
export function diatonicChordAt(
  intervals: number[],
  degIdx: number,
): { triad: DiatonicChord; seventh: DiatonicChord } {
  const abs = (offset: number) => {
    const idx = (degIdx + offset) % 7;
    const octave = Math.floor((degIdx + offset) / 7);
    return intervals[idx] + octave * 12;
  };
  const root = abs(0);
  const third = abs(2) - root;
  const fifth = abs(4) - root;
  const seventh = abs(6) - root;

  let triad: DiatonicChord;
  if (third === 4 && fifth === 7) triad = { minor: false, suffix: "" };
  else if (third === 3 && fifth === 7) triad = { minor: true, suffix: "" };
  else if (third === 3 && fifth === 6) triad = { minor: true, suffix: "°" };
  else if (third === 4 && fifth === 8) triad = { minor: false, suffix: "+" };
  else triad = { minor: third === 3, suffix: "" };

  let seventhChord: DiatonicChord;
  if (third === 4 && fifth === 7 && seventh === 11)
    seventhChord = { minor: false, suffix: "maj7" };
  else if (third === 4 && fifth === 7 && seventh === 10)
    seventhChord = { minor: false, suffix: "7" };
  else if (third === 3 && fifth === 7 && seventh === 10)
    seventhChord = { minor: true, suffix: "7" };
  else if (third === 3 && fifth === 6 && seventh === 10)
    seventhChord = { minor: true, suffix: "7b5" };
  else if (third === 3 && fifth === 6 && seventh === 9)
    seventhChord = { minor: true, suffix: "°7" };
  else if (third === 4 && fifth === 8 && seventh === 11)
    seventhChord = { minor: false, suffix: "maj7#5" };
  else seventhChord = triad;

  return { triad, seventh: seventhChord };
}

/* ============================================================
   CHORD SEMITONES / VOICING ENGINE
   ============================================================ */

export interface ChordSemitones {
  third: number;
  fifth: number;
  color: Set<number>;
}

/** Parse a chord suffix into its interval components.
 *  Returns null if the suffix is invalid / unparseable. */
export function chordSemis(step: HoneycombStep): ChordSemitones | null {
  let third = step.minor ? 3 : 4;
  let fifth = 7;
  const color = new Set<number>();
  let s = (step.suffix || "").toLowerCase();

  const eat = (re: RegExp): string | null => {
    const m = s.match(re);
    if (m) { s = s.replace(re, ""); return m[0]; }
    return null;
  };

  if (eat(/b13/)) color.add(20);
  if (eat(/#11/)) color.add(18);
  if (eat(/b9/)) color.add(13);
  if (eat(/#9/)) color.add(15);
  if (eat(/b5/)) fifth = 6;
  if (eat(/#5/)) fifth = 8;
  if (eat(/(dim|°|º|o)7/)) { third = 3; fifth = 6; color.add(9); }
  else if (eat(/dim|°|º/)) { third = 3; fifth = 6; }
  if (eat(/aug|\+/)) fifth = 8;
  if (eat(/sus4/)) third = 5;
  if (eat(/sus2/)) third = 2;
  if (eat(/^(min|m(?!aj)|-)/)) third = 3;
  if (eat(/maj13/)) { color.add(11); color.add(14); color.add(21); }
  else if (eat(/maj9/)) { color.add(11); color.add(14); }
  else if (eat(/maj7?/)) color.add(11);
  if (eat(/add9/)) color.add(14);
  if (eat(/add11/)) color.add(17);
  if (eat(/69|6\/9/)) { color.add(9); color.add(14); }
  else if (eat(/6/)) color.add(9);
  if (eat(/13/)) { color.add(10); color.add(14); color.add(21); }
  else if (eat(/11/)) { color.add(10); color.add(14); color.add(17); }
  else if (eat(/9/)) { color.add(10); color.add(14); }
  else if (eat(/7/)) color.add(10);
  if (/[a-z0-9]/.test(s)) return null;
  return { third, fifth, color };
}

/** Build a voicing (array of semitone offsets from root) for a
 *  chord step.  Includes the third, seventh (or fifth), and up
 *  to two upper extensions. */
export function voicing(step: HoneycombStep): number[] {
  const c = chordSemis(step);
  if (!c) return [0, 4, 7];
  const tones = [0, c.third];
  const seventh = [9, 10, 11].find((x) => c.color.has(x));
  tones.push(seventh !== undefined ? seventh : c.fifth);
  const uppers = [...c.color]
    .filter((x) => x > 11)
    .sort((a, b) => a - b);
  tones.push(...uppers.slice(-2));
  if (tones.length < 4)
    tones.push(!tones.includes(c.fifth) ? c.fifth : 12);
  return [...new Set(tones)];
}

/** Returns the bass interval (semitone offset from the chord root)
 *  for the given step's bass note.  0 = root position. */
export function bassInterval(step: HoneycombStep): number {
  const c = chordSemis(step);
  if (!c || !step.bass) return 0;
  if (step.bass === 3) return c.third;
  if (step.bass === 5) return c.fifth;
  const sev = [9, 10, 11].find((x) => c.color.has(x));
  return sev !== undefined ? sev : 10;
}

/* ============================================================
   PARSER — text → HoneycombStep[]
   ============================================================ */

/** Parse a single roman-numeral token (e.g. "Imaj7", "bVI7b13",
 *  "ivm7/V") into a HoneycombStep.  Returns null on failure. */
export function parseToken(raw: string): HoneycombStep | null {
  let s = raw
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/Δ/g, "maj")
    .replace(/ø/g, "m7b5")
    .replace(/[()]/g, "");
  let bass: number | null = null;
  const bm = s.match(/\/(b?)([357])$/);
  if (bm) { bass = parseInt(bm[2], 10); s = s.slice(0, bm.index); }
  let acc = 0;
  if (/^b[IViv1-7]/.test(s)) { acc = -1; s = s.slice(1); }
  else if (/^#/.test(s)) { acc = 1; s = s.slice(1); }
  const rm = s.match(
    /^(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)/,
  );
  let deg: number;
  let minor: boolean;
  let suffix: string;
  if (rm) {
    const numeral = rm[1];
    deg = ["i","ii","iii","iv","v","vi","vii"].indexOf(
      numeral.toLowerCase(),
    );
    minor = numeral === numeral.toLowerCase();
    suffix = s.slice(numeral.length);
  } else {
    const nm = s.match(/^([1-7])/);
    if (!nm) return null;
    deg = parseInt(nm[1], 10) - 1;
    suffix = s.slice(1);
    minor = /^(m(?!aj)|min|-)/.test(suffix);
  }
  return { deg, acc, minor, suffix, bass };
}

/** Parse a full progression string into validated steps.
 *  Tokens are separated by whitespace, |, ➔, →, >, –, or —.
 *  Unparseable tokens are collected in `bad`. */
export function parseProgression(text: string): {
  steps: HoneycombStep[];
  bad: string[];
} {
  const tokens = text.split(/[\s,|➔→>–—]+/).filter(Boolean);
  const steps: HoneycombStep[] = [];
  const bad: string[] = [];
  for (const t of tokens) {
    const p = parseToken(t);
    if (p && chordSemis(p)) steps.push(p);
    else bad.push(t);
  }
  return { steps, bad };
}

/** Serialise a single step back to a token string that
 *  parseToken() can round-trip. */
export function emitToken(step: HoneycombStep): string {
  const accStr = step.acc === -1 ? "b" : step.acc === 1 ? "#" : "";
  const base = ROMAN_UP[step.deg];
  return (
    accStr +
    (step.minor ? base.toLowerCase() : base) +
    (step.suffix || "") +
    (step.bass ? "/" + step.bass : "")
  );
}

/* ============================================================
   WALK BUILDER — steps → hex cell positions
   ============================================================ */

/** Given a sequence of HoneycombSteps, compute the hex-grid walk
 *  path.  Each step: if the target degree is already on the current
 *  cell, stay put (a held/repeated chord).  Otherwise, step to the
 *  adjacent hex whose degree matches the target — always taking it,
 *  even if that hex was visited earlier.  Revisiting an earlier cell
 *  is meaningful (descending lines, turnarounds, verse-after-chorus
 *  returns) and is exactly the contiguous walk the honeycomb design
 *  was built to visualize.  A step that can't find an adjacent match
 *  (shouldn't happen for diatonic degrees) stays on the current cell. */
export function buildWalk(steps: HoneycombStep[]): HexCell[] {
  if (!steps.length) return [];
  const walk: HexCell[] = [{ q: 0, r: steps[0].deg }];
  for (let i = 1; i < steps.length; i++) {
    const d = steps[i].deg;
    const { q, r } = walk[walk.length - 1];

    if (degreeAt(q, r) === d) {
      walk.push({ q, r });
      continue;
    }

    const dir = DIRS.find(([a, b]) => degreeAt(q + a, r + b) === d);
    const next = dir ? { q: q + dir[0], r: r + dir[1] } : { q, r };
    walk.push(next);
  }
  return walk;
}

/* ============================================================
   CELL VARIANTS — the chords that actually landed on a degree
   ============================================================ */

/** One distinct chord that visited a hex cell. A cell is a scale DEGREE;
 *  a variant is what was actually played there (Em vs E, VI vs bVI, I7 vs I). */
export interface CellVariant {
  /** Stable identity: degree|accidental|quality|suffix|bass. */
  key: string;
  /** Short chip label — accidental + roman numeral, cased by quality. */
  label: string;
  /** The chord's suffix ("maj7", "7", "m7b5"), used to tell two variants of
   *  the same numeral apart on the chip. */
  suffix: string;
  minor: boolean;
  acc: number;
  /** Index of the first step that used this variant. */
  firstStep: number;
}

export interface WalkVariants {
  /** "q,r" → the variants seen there, in first-visit order. */
  byCell: Map<string, CellVariant[]>;
  /** step index → variant index within that step's cell. */
  variantOfStep: number[];
  /** step index → number of steps that share its variant (repeat count). */
  visitsOfStep: number[];
}

/** A step's identity, matching the repeat detector's notion of "same chord". */
export function stepSignature(step: HoneycombStep): string {
  return `${step.deg}|${step.acc}|${step.minor}|${step.suffix}|${step.bass}`;
}

/** Short label for a variant chip: accidental + roman, cased by quality. */
export function variantLabel(step: HoneycombStep): string {
  const acc = step.acc === -1 ? "b" : step.acc === 1 ? "#" : "";
  const roman = ROMAN_UP[step.deg] ?? String(step.deg + 1);
  return `${acc}${step.minor ? roman.toLowerCase() : roman}`;
}

/**
 * Group the steps of a walk into the variants each cell holds.
 *
 * This is what makes "same degree, different chord" visible: the walk stays
 * on one hex (a degree is a position in the lattice), but the SEQUENCE still
 * moved — Em → E is a variant hop inside the same cell. Cells that only ever
 * see one chord come back with a single variant, so the ordinary diatonic
 * case renders exactly as before.
 */
export function walkVariants(walk: HexCell[], steps: HoneycombStep[]): WalkVariants {
  const byCell = new Map<string, CellVariant[]>();
  const variantOfStep: number[] = [];
  const visitsOfStep: number[] = [];
  const counts = new Map<string, number>(); // signature → visit count

  for (let i = 0; i < walk.length && i < steps.length; i++) {
    const cellKey = `${walk[i].q},${walk[i].r}`;
    const signature = stepSignature(steps[i]);
    let variants = byCell.get(cellKey);
    if (!variants) {
      variants = [];
      byCell.set(cellKey, variants);
    }
    let index = variants.findIndex((variant) => variant.key === signature);
    if (index === -1) {
      variants.push({
        key: signature,
        label: variantLabel(steps[i]),
        suffix: steps[i].suffix,
        minor: steps[i].minor,
        acc: steps[i].acc,
        firstStep: i,
      });
      index = variants.length - 1;
    }
    variantOfStep.push(index);
    const seen = (counts.get(signature) ?? 0) + 1;
    counts.set(signature, seen);
    visitsOfStep.push(seen);
  }

  return { byCell, variantOfStep, visitsOfStep };
}

/* ============================================================
   PROGRESSION VIEW — repeat-run detection & collapse
   ============================================================ */

export interface RepeatRun {
  start: number; // index of the run's first step
  period: number; // length of one lap, in steps
  laps: number; // number of complete laps (>= 2)
}

/** Find maximal, non-overlapping repeated-unit runs in a step sequence:
 *  contiguous stretches where a short pattern repeats two or more times
 *  back-to-back (e.g. "I IV I IV I IV" is one run with period 2, 3 laps).
 *  Greedy left-to-right — at each position it picks whichever period
 *  covers the most steps (laps × period), then jumps past the run and
 *  continues. Non-repeating stretches between/around runs are left alone.
 *  Chords are compared on every property (degree, accidental, quality,
 *  suffix, bass), so a I and an I7 are NOT the same repeated unit. */
export function detectRepeatRuns(steps: HoneycombStep[]): RepeatRun[] {
  const sig = (s: HoneycombStep) =>
    `${s.deg}|${s.acc}|${s.minor}|${s.suffix}|${s.bass}`;
  const sigs = steps.map(sig);
  const n = sigs.length;
  const runs: RepeatRun[] = [];
  let i = 0;
  while (i < n) {
    let best: RepeatRun | null = null;
    const maxPeriod = Math.floor((n - i) / 2);
    for (let p = 1; p <= maxPeriod; p++) {
      let laps = 1;
      while (
        i + (laps + 1) * p <= n &&
        Array.from({ length: p }, (_, k) => sigs[i + laps * p + k]).every(
          (s, k) => s === sigs[i + k],
        )
      ) {
        laps++;
      }
      if (laps >= 2 && (!best || laps * p > best.laps * best.period)) {
        best = { start: i, period: p, laps };
      }
    }
    if (best) {
      runs.push(best);
      i = best.start + best.laps * best.period;
    } else {
      i++;
    }
  }
  return runs;
}

/** Rewrite a linear walk's hex positions for the "progression" (loop)
 *  view: within each detected repeat run, every lap after the first
 *  reuses the exact hex positions of the first lap, so a repeating
 *  progression reads as one compact loop with a visit-count badge
 *  instead of a fresh hex for every repeat. The array's length and
 *  step-index order are unchanged — only the (q,r) values move — so
 *  callers can keep indexing into the original `steps`/`chords` arrays
 *  by position. Stretches outside a detected run are left untouched,
 *  matching the "straight line" walk exactly. */
export function collapseRepeatsForLoopView(
  walk: HexCell[],
  steps: HoneycombStep[],
): HexCell[] {
  const runs = detectRepeatRuns(steps);
  const out = [...walk];
  for (const { start, period, laps } of runs) {
    for (let lap = 1; lap < laps; lap++) {
      for (let k = 0; k < period; k++) {
        out[start + lap * period + k] = out[start + k];
      }
    }
  }
  return out;
}

/* ============================================================
   LOOP DETECTION
   ============================================================ */

/** If the first and last steps share the same degree (+ accidental)
 *  the progression forms a loop.  Returns the loop vector
 *  (difference between first and last hex cell) or null. */
export function detectLoop(
  steps: HoneycombStep[],
  walk: HexCell[],
): WalkLoop | null {
  if (steps.length < 3) return null;
  const a = steps[0];
  const z = steps[steps.length - 1];
  if (a.deg !== z.deg || a.acc !== z.acc) return null;
  const first = walk[0];
  const last = walk[walk.length - 1];
  return {
    dq: last.q - first.q,
    dr: last.r - first.r,
    translated: last.q !== first.q || last.r !== first.r,
  };
}

/* ============================================================
   CONTENT BOUNDS
   ============================================================ */

/** Compute the bounding box of the walk in pixel space,
 *  including the loop line if present. */
export function walkContentBounds(
  walk: HexCell[],
  loopVec: Vec2 | null,
  size = HEX_SIZE,
): ContentBounds {
  const allPts = walk.map((p) => hexToPixel(p.q, p.r, size));
  // Include loop-vector end-point (the "ghost" position)
  if (loopVec && walk.length) {
    const first = hexToPixel(walk[0].q, walk[0].r, size);
    allPts.push({
      x: first.x + loopVec.x,
      y: first.y + loopVec.y,
    });
  }
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const pad = size * 1.5;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ============================================================
   DISPLAY HELPERS
   ============================================================ */

/** Replace ASCII accidentals with Unicode in chord suffixes. */
export function prettySuffix(s: string): string {
  return (s || "")
    .replace(/b(?=[0-9])/g, "♭")
    .replace(/#(?=[0-9])/g, "♯");
}

/** Get the roman-numeral label for a step. */
export function stepLabel(step: HoneycombStep): string {
  const base = ROMAN_UP[step.deg];
  const prefix =
    step.acc === -1 ? "♭" : step.acc === 1 ? "♯" : "";
  return (
    prefix +
    (step.minor ? base.toLowerCase() : base) +
    prettySuffix(step.suffix) +
    (step.bass ? "/" + step.bass : "")
  );
}

/** Resolve a scale degree + accidental to the actual note letter
 *  name in the given key, optionally taking mode intervals into
 *  account.  When `modeIntervals` is provided the note is derived
 *  from (tonic + interval + accidental); when absent it falls back
 *  to the static Ionian `KEYS` table for backward compatibility.
 *  Uses `noteName()` from @music-theory/core so enharmonic spelling
 *  (Gb vs F#, B vs Cb) follows the key reference. */
import { noteName as noteNameFn, pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

export function letterName(
  keyName: string,
  deg: number,
  acc: number,
  modeIntervals?: number[],
): string {
  if (modeIntervals) {
    const keyPc = pitchClass(keyName);
    const pc = ((keyPc + modeIntervals[deg] + acc) % 12 + 12) % 12;
    return noteNameFn(pc, keyName).replace(/b$/, "♭").replace(/#$/, "♯");
  }
  let n = KEYS[keyName]?.[deg] ?? "C";
  if (acc === -1) n = n.endsWith("#") ? n.slice(0, -1) : n + "b";
  if (acc === 1) n = n.endsWith("b") ? n.slice(0, -1) : n + "#";
  return n.replace(/b$/, "♭").replace(/#$/, "♯");
}

/** Full chord display name (e.g. "Cmaj7", "F♯m7♭5", "G7/B"). */
export function chordDisplay(
  keyName: string,
  step: HoneycombStep,
): string {
  let out =
    letterName(keyName, step.deg, step.acc) +
    (step.minor &&
    !/^(m|min|-)/.test(step.suffix || "") &&
    !/dim|°/.test(step.suffix || "")
      ? "m"
      : "") +
    prettySuffix(step.suffix);
  if (step.bass) {
    const off =
      step.bass === 3 ? 2 : step.bass === 5 ? 4 : 6;
    out += "/" + letterName(keyName, mod7(step.deg + off), 0);
  }
  return out;
}

/** Get the MIDI root note for a step in a given key + mode. */
export function stepMidiRoot(
  keyName: string,
  modeIntervals: number[],
  step: HoneycombStep,
): number {
  return (KEY_MIDI[keyName] ?? 48) + modeIntervals[step.deg] + step.acc;
}

/** Construct the full MIDI note array for a chord (bass + voicing). */
export function stepMidiChord(
  keyName: string,
  modeIntervals: number[],
  step: HoneycombStep,
): number[] {
  const root = stepMidiRoot(keyName, modeIntervals, step);
  return [
    root + bassInterval(step) - 12,
    ...voicing(step).map((iv) => root + iv),
  ];
}

/* ============================================================
   DEGREE CELLS — static diatonic map (for the hex wheel)
   ============================================================ */

export interface DiatonicHexCell {
  q: number;
  r: number;
  degreeIndex: number; // 0-6
}

/** Return the closest-to-origin hex cell for each diatonic
 *  degree (0-6), avoiding duplicate degrees. */
export function getDiatonicHexCells(range = 3): DiatonicHexCell[] {
  const best = new Map<number, DiatonicHexCell>();
  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      const degreeIndex = degreeAt(q, r);
      const dist = hexDistance(q, r);
      const existing = best.get(degreeIndex);
      if (
        !existing ||
        dist < hexDistance(existing.q, existing.r)
      ) {
        best.set(degreeIndex, { q, r, degreeIndex });
      }
    }
  }
  return [...best.values()].sort(
    (a, b) => a.degreeIndex - b.degreeIndex,
  );
}

/* ============================================================
   WALK-CELL AGGREGATION (for rendering)
   ============================================================ */

export type CellType = "visited" | "current" | "choice";

export interface RevealedCell {
  q: number;
  r: number;
  d: number;
  type: CellType;
}

/** Build the set of cells to render for a given walk position
 *  and reveal mode.  "fog" mode only shows cells up to the
 *  current step; "full" shows the entire walk.
 *  The current cell's 6 neighbours are shown as "choice" cells. */
export function getRevealedCells(
  walk: HexCell[],
  clampedStep: number,
  revealMode: "fog" | "full",
): RevealedCell[] {
  const map = new Map<
    string,
    { q: number; r: number; d: number; type: CellType }
  >();
  const upTo =
    revealMode === "full" ? walk.length - 1 : clampedStep;
  walk.slice(0, upTo + 1).forEach((p) => {
    map.set(`${p.q},${p.r}`, {
      q: p.q,
      r: p.r,
      d: degreeAt(p.q, p.r),
      type: "visited",
    });
  });
  if (walk.length) {
    const c = walk[clampedStep];
    const existing = map.get(`${c.q},${c.r}`);
    if (existing) {
      map.set(`${c.q},${c.r}`, {
        q: c.q,
        r: c.r,
        d: degreeAt(c.q, c.r),
        type: "current",
      });
    }
    for (const [a, b] of DIRS) {
      const k = `${c.q + a},${c.r + b}`;
      if (!map.has(k))
        map.set(k, {
          q: c.q + a,
          r: c.r + b,
          d: degreeAt(c.q + a, c.r + b),
          type: "choice",
        });
    }
  }
  return [...map.values()];
}

/** Build the SVG path "d" attribute for the walk line
 *  (only moves that change hex cell). */
export function getWalkPathD(
  walk: HexCell[],
  clampedStep: number,
  revealMode: "fog" | "full",
  size = HEX_SIZE,
): string {
  const upTo =
    revealMode === "full" ? walk.length - 1 : clampedStep;
  const shown = walk
    .slice(0, upTo + 1)
    .filter(
      (_, i) =>
        i === 0 ||
        walk[i].q !== walk[i - 1].q ||
        walk[i].r !== walk[i - 1].r,
    );
  if (shown.length < 2) return "";
  return shown
    .map((p, i) => {
      const { x, y } = hexToPixel(p.q, p.r, size);
      return `${i ? "L" : "M"} ${x} ${y}`;
    })
    .join(" ");
}

/** Re-roots a section's chords to a new key/scale — root pitch only,
 *  preserving each chord's authored quality/roman-numeral label so a
 *  deliberate substitution isn't silently overwritten by a key change.
 *  Unparseable roman numerals (shouldn't normally happen) are left
 *  untouched rather than guessed at. Shared by HarmonyView (the canvas)
 *  and HarmonyDockTools (the section-rekey control living in the dock) —
 *  one implementation, not two that could drift. */
export function transposeChords(chords: Chord[], newKeyPc: number, newKeyName: NoteName, newScale: ScaleType): Chord[] {
  const scaleKey = MODE_TO_SCALE_KEY[newScale as keyof typeof MODE_TO_SCALE_KEY] ?? "major";
  const intervals = SCALE_INTERVALS[scaleKey];
  return chords.map((c) => {
    const step = parseToken(c.romanNumeral);
    if (!step) return c;
    const rootPc = ((newKeyPc + intervals[step.deg] + step.acc) % 12 + 12) % 12;
    return { ...c, root: noteNameFn(rootPc, newKeyName) };
  });
}
export interface VisitBead {
  x: number;
  y: number;
  /** 1-based step number, matching the badge numbering. */
  step: number;
}

/**
 * A chord the progression returns to cannot advance on the honeycomb: the
 * lattice only holds one cell per degree in each neighbourhood, so a repeat has
 * nowhere to go. Instead each visit gets its own bead inside the hex, and the
 * path threads the beads — the sequence stays visible in place rather than
 * collapsing into a single "×2" repeat count.
 *
 * `points` is the path vertex for every step (cell centre, or the bead when the
 * cell is revisited); `beads` holds only the revisited ones.
 */
export function visitBeads(
  walk: HexCell[],
  size: number,
): { beads: VisitBead[]; points: Vec2[] } {
  const stepsPerCell = new Map<string, number>();
  for (const { q, r } of walk) {
    const key = `${q},${r}`;
    stepsPerCell.set(key, (stepsPerCell.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const beads: VisitBead[] = [];
  const points = walk.map(({ q, r }, index) => {
    const key = `${q},${r}`;
    const visit = seen.get(key) ?? 0;
    seen.set(key, visit + 1);
    const center = hexToPixel(q, r, size);
    const total = stepsPerCell.get(key)!;
    if (total < 2) return center;
    const spread = Math.min(11, (size * 1.2) / total);
    const bead: VisitBead = {
      x: center.x + (visit - (total - 1) / 2) * spread,
      y: center.y + size * 0.6,
      step: index + 1,
    };
    beads.push(bead);
    return { x: bead.x, y: bead.y };
  });

  return { beads, points };
}
