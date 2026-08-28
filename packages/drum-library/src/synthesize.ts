import { ABLETON_SAFE_NOTES } from "./ableton.js";
import type { DrumPattern } from "./presets.js";
import type { PackedNote, PackedVariant } from "./presetData.js";

/**
 * Programmed patterns for the idioms E-GMD cannot supply.
 *
 * The corpus is human kit performances, which is exactly wrong for two
 * families of material:
 *
 * - **Machine idioms** (house four-on-the-floor, trap hat grids, dnb
 *   two-step, breakbeat chops): these genres were *born* programmed, so a
 *   grid-tight synthesized pattern is the authentic article, not a
 *   compromise. No timing humanization is applied here on purpose — the
 *   variation engine (`vary.ts`) adds controlled per-bar life at clip time,
 *   which is also how these genres actually breathe (velocity, dropouts),
 *   not via loose microtiming.
 * - **Odd meters** the corpus is thin or empty on: 7/8 has zero takes,
 *   5/4 baked down to a single usable variant. Synthesized patterns fill
 *   those out so an odd-meter section is never silently empty.
 *
 * Everything is generated deterministically at module load — a few KB of
 * notes, no corpus, no I/O — so the extension bundle gets these for free
 * and a re-bake of the corpus JSON never changes them.
 */

const { kick, snare, clap, closedHat, openHat, tomMid, tomHigh, crash, rim } = ABLETON_SAFE_NOTES;

/** Mulberry32 over an FNV-1a seed — same determinism story as `selectGroove`. */
function prng(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class PatternBuilder {
  readonly notes: PackedNote[] = [];

  hit(beat: number, pitch: number, velocity: number): this {
    this.notes.push([round4(beat), pitch, clampVelocity(velocity)]);
    return this;
  }

  /** A run of evenly spaced hits — hat grids, rolls, ramps. */
  run(startBeat: number, step: number, count: number, pitch: number, velocity: (i: number) => number): this {
    for (let i = 0; i < count; i++) this.hit(startBeat + i * step, pitch, velocity(i));
    return this;
  }

  build(lengthBeats: number, beatsPerBar: number, generator: string): PackedVariant {
    this.notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      lengthBeats,
      beatsPerBar,
      notes: this.notes,
      source: { origin: "synth", generator },
    };
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clampVelocity(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity)));
}

/** Alternating-accent velocity for hat grids: strong on the accent stride, soft between. */
function accentEvery(stride: number, strong: number, soft: number): (i: number) => number {
  return (i) => (i % stride === 0 ? strong : soft);
}

// ---------------------------------------------------------------------------
// Machine idioms — 4/4
// ---------------------------------------------------------------------------

/**
 * House / techno four-on-the-floor. One bar, knobs per variant: hat
 * resolution, offbeat open hats, clap vs snare backbeat, ghost kick.
 */
function fourOnFloor(variantIndex: number): PackedVariant {
  const random = prng(`four_on_floor:${variantIndex}`);
  const b = new PatternBuilder();

  for (let beat = 0; beat < 4; beat++) b.hit(beat, kick, beat === 0 ? 122 : 116);

  const backbeat = random() < 0.5 ? clap : snare;
  b.hit(1, backbeat, 104).hit(3, backbeat, 106);

  const hatStyle = variantIndex % 3;
  if (hatStyle === 0) {
    // Classic offbeat open hats only.
    b.run(0.5, 1, 4, openHat, () => 88 + Math.floor(random() * 8));
  } else if (hatStyle === 1) {
    // 8th closed hats with offbeat accent.
    b.run(0, 0.5, 8, closedHat, (i) => (i % 2 === 1 ? 84 : 62));
    if (random() < 0.6) b.hit(3.5, openHat, 90);
  } else {
    // 16th hat grid, accented on the 8ths.
    b.run(0, 0.25, 16, closedHat, accentEvery(2, 76, 48));
    b.hit(2.5, openHat, 86);
  }

  if (random() < 0.4) b.hit(3.75, kick, 72); // pickup ghost kick into the next bar
  if (random() < 0.35) b.hit(2.75, rim, 58);

  return b.build(4, 4, `four_on_floor#${variantIndex}`);
}

/**
 * Trap: half-time backbeat over two bars, sparse syncopated kick, 16th hat
 * grid with 32nd-note roll bursts — the rolls are the genre signature.
 */
function trapPattern(variantIndex: number): PackedVariant {
  const random = prng(`trap:${variantIndex}`);
  const b = new PatternBuilder();

  const kickPatterns: number[][] = [
    [0, 2.75, 4, 5.5],
    [0, 1.75, 4, 6.75],
    [0, 3.5, 4.75, 6],
    [0, 2.25, 3.75, 4, 6.5],
  ];
  for (const beat of kickPatterns[variantIndex % kickPatterns.length]) b.hit(beat, kick, 118);

  // Half-time: snare on beat 3 of each 4-beat bar.
  b.hit(2, snare, 110).hit(6, snare, 112);

  for (let sixteenth = 0; sixteenth < 32; sixteenth++) {
    const beat = sixteenth * 0.25;
    b.hit(beat, closedHat, sixteenth % 4 === 0 ? 74 : 52 + Math.floor(random() * 10));
  }

  // One or two roll bursts per 2-bar loop, on a 32nd grid with a velocity ramp.
  const rollCount = 1 + (variantIndex % 2);
  for (let roll = 0; roll < rollCount; roll++) {
    const rollStart = [1.5, 3.5, 5.5, 7.0][Math.floor(random() * 4)];
    b.run(rollStart, 0.125, 4, closedHat, (i) => 58 + i * 12);
  }
  if (random() < 0.5) b.hit(7.5, openHat, 84);

  return b.build(8, 4, `trap#${variantIndex}`);
}

/**
 * Breakbeat: displaced funk kick, backbeat with ghost snares, 8th hats.
 * Grid-tight but syncopated — the classic sampled-break skeleton.
 */
function breakbeat(variantIndex: number): PackedVariant {
  const random = prng(`breakbeat:${variantIndex}`);
  const b = new PatternBuilder();

  const kickPatterns: number[][] = [
    [0, 2.5],
    [0, 1.75, 2.5],
    [0, 2.5, 3.25],
    [0, 1.5, 2.75],
  ];
  for (const beat of kickPatterns[variantIndex % kickPatterns.length]) b.hit(beat, kick, 115);

  b.hit(1, snare, 108).hit(3, snare, 110);
  // Ghost snares are what make a break feel played rather than stamped.
  const ghosts = [0.75, 1.75, 2.25, 3.5, 3.75].filter(() => random() < 0.5);
  for (const beat of ghosts) b.hit(beat, snare, 34 + Math.floor(random() * 14));

  b.run(0, 0.5, 8, closedHat, (i) => (i % 2 === 0 ? 82 : 60));
  if (random() < 0.4) b.hit(3.5, openHat, 88);

  return b.build(4, 4, `breakbeat#${variantIndex}`);
}

/**
 * Drum'n'bass two-step over two bars at the genre's implied double-time:
 * kick 1, snare 2, syncopated kick, snare 4 — with a shifted second bar.
 */
function dnbPattern(variantIndex: number): PackedVariant {
  const random = prng(`dnb:${variantIndex}`);
  const b = new PatternBuilder();

  // Bar 1: canonical two-step.
  b.hit(0, kick, 120).hit(1, snare, 112).hit(2.5, kick, 108).hit(3, snare, 114);
  // Bar 2: displaced variant of the same skeleton.
  const bar2Kicks = [
    [4, 6.5],
    [4, 5.75, 6.5],
    [4, 6.25],
  ][variantIndex % 3];
  for (const beat of bar2Kicks) b.hit(beat, kick, 112);
  b.hit(5, snare, 110).hit(7, snare, 116);
  if (random() < 0.5) b.hit(7.75, snare, 46); // pickup ghost into the loop

  // Light 16th shuffle on the hats, well under the kick/snare.
  for (let sixteenth = 0; sixteenth < 32; sixteenth++) {
    if (sixteenth % 4 === 2 && random() < 0.35) continue; // breathe
    b.hit(sixteenth * 0.25, closedHat, sixteenth % 4 === 0 ? 58 : 38 + Math.floor(random() * 8));
  }

  return b.build(8, 4, `dnb#${variantIndex}`);
}

// ---------------------------------------------------------------------------
// Odd meters
// ---------------------------------------------------------------------------

/**
 * 7/8, one bar = 3.5 quarter-note beats, on an eighth grid of 7. Variants
 * alternate the two standard groupings (2+2+3 and 3+2+2); hats accent the
 * group starts, which is what makes 7/8 readable instead of lopsided 4/4.
 */
function sevenEight(variantIndex: number): PackedVariant {
  const random = prng(`78:${variantIndex}`);
  const b = new PatternBuilder();
  const grouping = variantIndex % 2 === 0 ? [2, 2, 3] : [3, 2, 2];

  const groupStarts: number[] = [];
  let eighth = 0;
  for (const group of grouping) {
    groupStarts.push(eighth);
    eighth += group;
  }

  b.hit(0, kick, 118);
  b.hit(groupStarts[1] * 0.5, snare, 106);
  b.hit(groupStarts[2] * 0.5, variantIndex % 3 === 2 ? tomMid : kick, 104);

  for (let i = 0; i < 7; i++) {
    const isGroupStart = groupStarts.includes(i);
    b.hit(i * 0.5, closedHat, isGroupStart ? 84 : 58);
  }
  if (random() < 0.4) b.hit(3, snare, 40); // ghost on the final eighth-pair
  if (variantIndex % 4 === 3) b.hit(3.25, tomHigh, 72);

  return b.build(3.5, 3.5, `78#${variantIndex}`);
}

/** 5/4 as 3+2: the rock treatment, not the jazz ride pattern the corpus already covers. */
function fiveFour(variantIndex: number): PackedVariant {
  const random = prng(`54:${variantIndex}`);
  const b = new PatternBuilder();

  b.hit(0, kick, 118).hit(3, kick, 110);
  b.hit(2, snare, 106).hit(4, snare, 108);
  if (variantIndex % 2 === 1) b.hit(1.5, kick, 92);

  b.run(0, 0.5, 10, closedHat, (i) => ([0, 6].includes(i) ? 84 : 60)); // accent the 3+2 seam
  if (random() < 0.4) b.hit(4.5, openHat, 82);

  return b.build(5, 5, `54#${variantIndex}`);
}

/** 6/8 compound: kick on 1, snare on 4 (the second dotted-quarter), hats on all six eighths. */
function sixEight(variantIndex: number): PackedVariant {
  const random = prng(`68:${variantIndex}`);
  const b = new PatternBuilder();

  b.hit(0, kick, 116);
  b.hit(1.5, snare, 106);
  if (variantIndex % 2 === 1) b.hit(2.5, kick, 90);

  b.run(0, 0.5, 6, closedHat, (i) => (i === 0 || i === 3 ? 82 : 56));
  if (random() < 0.35) b.hit(1, snare, 38);

  return b.build(3, 3, `68#${variantIndex}`);
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

/**
 * One-bar synthesized fills, generated per bar length so odd meters get
 * fills too. These are the *electronic-family* fills (rolls, ramps, chops);
 * acoustic fills come from E-GMD's own `beatType: "fill"` takes at bake
 * time. `beatsPerBar` tells the caller how much groove tail to replace.
 */
function synthFill(beatsPerBar: number, variantIndex: number): PackedVariant {
  const random = prng(`fill:${beatsPerBar}:${variantIndex}`);
  const b = new PatternBuilder();
  const style = variantIndex % 4;

  if (style === 0) {
    // Snare-roll ramp over the back half of the bar.
    const start = beatsPerBar / 2;
    const count = Math.round((beatsPerBar - start) / 0.25);
    b.run(start, 0.25, count, snare, (i) => 55 + Math.round((i / Math.max(1, count - 1)) * 60));
  } else if (style === 1) {
    // Descending tom run into the downbeat.
    const start = beatsPerBar - Math.min(2, beatsPerBar / 2);
    b.hit(start, tomHigh, 96).hit(start + 0.5, tomHigh, 88).hit(start + 1, tomMid, 100);
    if (start + 1.5 < beatsPerBar) b.hit(start + 1.5, tomMid, 108);
    b.hit(0, kick, 112).hit(beatsPerBar >= 2 ? 1 : 0.5, snare, 100);
  } else if (style === 2) {
    // 32nd hat roll with a snare stamp on the last eighth — the trap build.
    b.run(0, 0.5, Math.floor(beatsPerBar * 2) - 1, closedHat, () => 60 + Math.floor(random() * 10));
    const rollStart = beatsPerBar - 1;
    b.run(rollStart, 0.125, 8, closedHat, (i) => 60 + i * 8);
    b.hit(beatsPerBar - 0.5, snare, 118);
  } else {
    // Kick-and-snare chop: sparse, punchy, leaves space before the drop.
    b.hit(0, kick, 116).hit(0.75, snare, 96).hit(1.25, kick, 104);
    if (beatsPerBar >= 3) b.hit(beatsPerBar - 1.5, snare, 90);
    b.hit(beatsPerBar - 0.5, snare, 112).hit(beatsPerBar - 0.25, snare, 120);
  }

  return b.build(beatsPerBar, beatsPerBar, `fill:${beatsPerBar}#${variantIndex}`);
}

// ---------------------------------------------------------------------------
// Clean downbeat default
// ---------------------------------------------------------------------------

export interface CleanDownbeatOptions {
  /** Closed-hat grid: 0.5 (8ths) or 0.25 (16ths). Default 8ths. */
  hatGrid?: number;
  /** Add the clean pickup kick into the next bar. Default true. */
  pickup?: boolean;
  /** Velocity lift for a louder pattern (e.g. `intense`). */
  boost?: number;
}

/**
 * A clean, grid-tight "downbeat" groove — the library's variant 0 / auto
 * default for the acoustic family. THE SNARE SITS EXACTLY ON THE DOWNBEATS
 * (beats 1 & 3 in 4/4): single hits, no flams, no ghost notes — so the
 * default snare is a clean hit on the downbeats. The corpus variants (real
 * takes with flams/ghosts/fills) and the seeded pick supply the variation
 * "where the logic dictates".
 */
export function cleanDownbeat(lengthBeats: number, beatsPerBar: number, opts: CleanDownbeatOptions = {}): PackedVariant {
  const b = new PatternBuilder();
  const stride = Math.max(0.5, beatsPerBar / 2); // downbeats every half-bar (2 in 4/4)
  const hatGrid = opts.hatGrid ?? 0.5;
  const pickup = opts.pickup ?? true;
  const boost = opts.boost ?? 0;

  // Snare exactly on the downbeats — single clean hits.
  for (let down = 0; down < lengthBeats; down += stride) {
    b.hit(round4(down), snare, 100 + boost);
  }
  // Kick: each bar's downbeat accent + a clean pickup into the next bar.
  for (let bar = 0; bar < lengthBeats; bar += beatsPerBar) {
    b.hit(round4(bar), kick, 118 + boost);
    if (pickup && bar + beatsPerBar < lengthBeats + 1e-9) {
      b.hit(round4(Math.min(lengthBeats - 1e-9, bar + beatsPerBar - 0.5)), kick, 104 + Math.round(boost * 0.5));
    }
  }
  // Closed hat across the loop, accented on the downbeats.
  const hatSteps = Math.max(1, Math.round(lengthBeats / hatGrid));
  b.run(0, hatGrid, hatSteps, closedHat, (i) => (i % 2 === 0 ? 78 + boost : 54 + Math.round(boost * 0.5)));

  return b.build(lengthBeats, beatsPerBar, "clean_downbeat");
}

/**
 * The clean downbeat default prepended as variant 0 of the acoustic
 * family — standard (verse), driving (chorus/refrain), half_time, sparse
 * and intense — so "auto" sections default to a snare on the downbeats.
 * Indexed by `DrumPattern`; `presetData.ts` merges these in front of the
 * corpus variants.
 */
export const CLEAN_DOWNBEAT: Partial<Record<DrumPattern, PackedVariant>> = {
  standard: cleanDownbeat(4, 4, { hatGrid: 0.5, pickup: true }),
  driving: cleanDownbeat(4, 4, { hatGrid: 0.25, pickup: true }),
  half_time: cleanDownbeat(8, 4, { hatGrid: 0.5, pickup: true }),
  bridge_sparse: cleanDownbeat(4, 4, { hatGrid: 0.5, pickup: false }),
  intense: cleanDownbeat(4, 4, { hatGrid: 0.25, pickup: true, boost: 6 }),
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function variants(count: number, generate: (i: number) => PackedVariant): PackedVariant[] {
  return Array.from({ length: count }, (_, i) => generate(i));
}

/**
 * Synthesized preset variants, merged with the corpus bake by
 * `presetData.ts`. Machine idioms are synth-only; `54`/`68` supplement a
 * thin corpus; `78` fills a genuine corpus hole.
 */
export const SYNTH_VARIANTS: Partial<Record<DrumPattern, PackedVariant[]>> = {
  four_on_floor: variants(9, fourOnFloor),
  trap: variants(8, trapPattern),
  breakbeat: variants(8, breakbeat),
  dnb: variants(9, dnbPattern),
  "78": variants(8, sevenEight),
  "54": variants(6, fiveFour),
  "68": variants(6, sixEight),
};

/** Synthesized fills keyed by bar length in quarter-note beats. */
export const SYNTH_FILLS: Record<string, PackedVariant[]> = {
  "4": variants(8, (i) => synthFill(4, i)),
  "3": variants(4, (i) => synthFill(3, i)),
  "3.5": variants(4, (i) => synthFill(3.5, i)),
  "5": variants(4, (i) => synthFill(5, i)),
};

export const CRASH_PITCH = crash;
