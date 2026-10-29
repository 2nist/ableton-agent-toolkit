import { ABLETON_SAFE_NOTES } from "./ableton.js";
import { buildMeterOutline } from "./meter.js";
import type { MeterOutline } from "./meter.js";
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
  b.hit(groupStarts[2] * 0.5, kick, 104);

  for (let i = 0; i < 7; i++) {
    const isGroupStart = groupStarts.includes(i);
    b.hit(i * 0.5, closedHat, isGroupStart ? 84 : 58);
  }
  if (random() < 0.4) b.hit(3, snare, 40); // ghost on the final eighth-pair
  if (variantIndex % 4 === 3) b.hit(3.25, rim, 72);

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
// Curated acoustic vocabulary
// ---------------------------------------------------------------------------

/**
 * The acoustic family, AUTHORED rather than mined.
 *
 * The corpus bake packed 60-80 *performances* into every acoustic pattern:
 * loop lengths of 1, 2, 4 and 8 bars in one pool, densities from 6 to 73
 * hits per bar in one pool, and — for `intense` — toms in 81% of variants,
 * because those takes are drum FILLS. Choosing "variant 37" was therefore
 * not choosing a pattern; it was choosing an arbitrary performance. That is
 * why a repeated verse changed groove, length and density together, why a
 * groove could fail to repeat inside its own section, and why a chorus
 * could arrive as a 45-hits-per-bar roll.
 *
 * These are the patterns. Every one is one or two bars, its density is
 * fixed by construction, and its lanes are the ones the idiom actually
 * plays — no toms, because a tom run is a fill and fills come from
 * `FILL_DATA`. The corpus keeps its real job: it supplies the *feel*
 * (timing and velocity contour) that `presetData.ts` imposes on these via
 * `extractGroove` -> `applyGroove`, so the drums still sound played rather
 * than programmed.
 *
 * `variantIndex` therefore means "a different written pattern", not "a
 * different performance" — and `presetData.ts` crosses these with feel
 * donors so the pool still has depth.
 */

/**
 * Ghost-note velocity. Deliberately below TrackDraft's `GHOST_MAX` (45) so a
 * ghost is drawn as a ghost in the step grid — the same number the UI uses to
 * decide a hit is quiet — and low enough that the feel layer's velocity
 * contour can push it around without ever promoting it to a full hit.
 */
const GHOST = 34;

/** A soft snare "ghost" — the quiet filler between backbeats that makes a
 *  groove breathe. Never on a beat, never loud. */
function ghosts(b: PatternBuilder, beats: readonly number[]): void {
  for (const beat of beats) b.hit(beat, snare, GHOST);
}

/** Closed-hat grid over the whole loop, accented every `accentStride`th hit. */
function hatGrid(b: PatternBuilder, lengthBeats: number, step: number, strong: number, soft: number, accentStride = 2): void {
  b.run(0, step, Math.max(1, Math.round(lengthBeats / step)), closedHat, (i) => (i % accentStride === 0 ? strong : soft));
}

/** Snare on 2 and 4, one hit per bar-pair — the backbeat every variant shares. */
function backbeat(b: PatternBuilder, lengthBeats: number, velocity = 104): void {
  for (let beat = 1; beat < lengthBeats - 1e-9; beat += 2) {
    b.hit(beat, snare, beat % 4 === 1 ? velocity + 2 : velocity);
  }
}

/**
 * The acoustic ladder — one authored bank per energy level, in strictly
 * increasing order of density:
 *
 *   kick_only 2-4 < bridge_sparse 6-7 < half_time 10-11 < standard 12-14
 *              < driving 20-22 < intense 24-27
 *
 * The ORDER is the contract (see `test/drumMusicality.test.ts`). Without it
 * the banks overlapped — `driving` shipped variants at 12 hits/bar and
 * `standard` ones at 20 — so a chorus could come out SPARSER than the verse
 * it was supposed to lift, which reads as the arrangement falling apart
 * rather than building.
 *
 * Each bank also has its own identity, not just a density: `standard` is the
 * 8th-note backbeat, `driving` is the same backbeat on 16ths, `intense` adds
 * four-on-the-floor and open hats, `half_time` moves the backbeat to beat 3
 * alone. Nothing uses toms — a tom run is a fill and fills come from
 * `FILL_DATA`.
 */

/** `kick_only` — the kick pulse, and nothing else. */
function kickOnlyPattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 4;
  if (i === 0) b.hit(0, kick, 118).hit(2, kick, 108);
  else if (i === 1) b.run(0, 1, 4, kick, (n) => (n === 0 ? 120 : 106));
  else if (i === 2) b.hit(0, kick, 118).hit(2, kick, 108).hit(3.5, kick, 92);
  else b.hit(0, kick, 120).hit(1.5, kick, 96).hit(2, kick, 108);
  return b.build(4, 4, `kick_only#${i}`);
}

/** `bridge_sparse` — space is the point: a kick anchor, one answer, quarter hats. */
function bridgeSparsePattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 3;
  b.hit(0, kick, 116);
  b.hit(i === 0 ? 2 : 3, i === 0 ? rim : snare, 88);
  b.run(0, 1, 4, closedHat, (n) => (n === 0 ? 70 : 52));
  if (i === 2) b.hit(0, crash, 92);
  return b.build(4, 4, `bridge_sparse#${i}`);
}

/** `half_time` — ONE backbeat per bar (beat 3), 8th hats. Laid back, not faster. */
function halfTimePattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 3;
  b.hit(0, kick, 118);
  b.hit(2, snare, 106);
  hatGrid(b, 4, 0.5, 76, 54);
  if (i === 1) b.hit(2.5, kick, 96);
  if (i === 2) b.hit(1.5, openHat, 82);
  if (i !== 2) ghosts(b, [1.75]);
  return b.build(4, 4, `half_time#${i}`);
}

/** `standard` — the workhorse backbeat on 2 & 4, 8th hats. */
function standardPattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 4;
  backbeat(b, 4);
  hatGrid(b, 4, 0.5, 78, 56);
  if (i === 0) {
    b.hit(0, kick, 118).hit(2, kick, 108);
    ghosts(b, [1.75, 3.75]);
  } else if (i === 1) {
    b.hit(0, kick, 118).hit(1.5, kick, 92).hit(2, kick, 108).hit(3.5, openHat, 84);
    ghosts(b, [1.75]);
  } else if (i === 2) {
    b.hit(0, kick, 118).hit(1.75, kick, 90).hit(2, kick, 108).hit(0, crash, 104);
    ghosts(b, [0.75, 2.75]);
  } else {
    b.hit(0, kick, 118).hit(2, kick, 108).hit(3.5, openHat, 92);
    ghosts(b, [1.75, 3.25]);
  }
  return b.build(4, 4, `standard#${i}`);
}

/** `driving` — the same backbeat pushed onto 16th hats, more kick movement. */
function drivingPattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 4;
  backbeat(b, 4);
  hatGrid(b, 4, 0.25, 78, 48);
  if (i === 0) b.hit(0, kick, 118).hit(2, kick, 108);
  else if (i === 1) b.hit(0, kick, 118).hit(1.5, kick, 94).hit(2, kick, 108);
  else if (i === 2) b.hit(0, kick, 118).hit(2, kick, 108).hit(3.5, openHat, 88);
  else b.hit(0, kick, 118).hit(1.5, kick, 94).hit(2, kick, 108).hit(3.5, kick, 92);
  ghosts(b, i === 2 ? [1.75] : [1.75, 3.75]);
  return b.build(4, 4, `driving#${i}`);
}

/** `intense` — four on the floor, 16th hats, open hats and crashes. */
function intensePattern(variantIndex: number): PackedVariant {
  const b = new PatternBuilder();
  const i = variantIndex % 4;
  b.run(0, 1, 4, kick, (n) => (n === 0 ? 122 : 112));
  backbeat(b, 4, 108);
  hatGrid(b, 4, 0.25, 82, 50);
  if (i === 0) b.run(0.5, 1, 4, openHat, (n) => (n === 0 ? 92 : 86));
  else if (i === 1) {
    b.hit(3.5, kick, 96).hit(0, crash, 108);
    b.run(0.5, 1, 2, openHat, () => 88);
  } else if (i === 2) b.hit(0, crash, 110).hit(2.75, snare, 62);
  else {
    b.hit(2.75, snare, 60);
    b.run(0.5, 1, 4, openHat, () => 90);
  }
  return b.build(4, 4, `intense#${i}`);
}

/**
 * The authored patterns, merged into `PRESET_DATA` by `presetData.ts` in
 * place of the corpus takes' note content (the takes stay on as FEEL donors).
 *
 * EVERY curated variant is ONE bar, and each bank stays inside its own
 * density band, so a pattern name now means one thing: picking `driving`
 * gets a busier groove than `standard`, and `intense` busier still.
 */
/**
 * THE IDIOM SHELF — ten named grooves, written rather than mined.
 *
 * The acoustic ladder answers "how busy is this section"; it cannot answer
 * "this is a Motown tune". These are the names a writer actually reaches for,
 * each one bar, each with its own density, each with the lanes the idiom
 * plays and no toms. They carry no corpus bake entry of their own, so
 * `presetData.ts` lends them a feel donor from a sibling (`DONOR_PATTERN`) —
 * written structure, human timing.
 */

/** `motown` — kick on the one and the "and" of two, backbeat on 2 and 4,
 *  eighth hats, ghost snares between. The vintage studio beat. */
function motownPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 116).hit(1.5, kick, 104).hit(3, kick, 98);
  backbeat(b, 4, 104);
  hatGrid(b, 4, 0.5, 78, 52);
  ghosts(b, i % 2 === 0 ? [0.75, 2.75] : [0.75, 1.75, 2.75]);
  if (i % 4 === 3) b.hit(3.5, snare, 62);
  return b.build(4, 4, `motown#${i}`);
}

/** `boom_bap` — lazy kick, backbeat on 2 and 4, fatted ghosts. */
function boomBapPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 118).hit(2.5, kick, 106);
  if (i % 2 === 1) b.hit(1.75, kick, 96);
  backbeat(b, 4, 106);
  hatGrid(b, 4, 0.5, 70, 48, 4);
  ghosts(b, [1.25, 3.25]);
  return b.build(4, 4, `boom_bap#${i}`);
}

/** `train_beat` — the country/rock train: snare ghosts on every eighth,
 *  backbeat on 2 and 4, kick on the one and three. */
function trainBeatPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 116).hit(2, kick, 108);
  backbeat(b, 4, 108);
  b.run(0, 0.5, 8, snare, (n) => (n % 2 === 0 ? GHOST : GHOST + 4));
  hatGrid(b, 4, 0.5, 76, 50);
  if (i % 2 === 1) b.hit(3.5, kick, 96);
  return b.build(4, 4, `train_beat#${i}`);
}

/** `bossa` — the clave ride: kick on one and four, rim on the offbeats. */
function bossaPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 112).hit(3, kick, 100);
  b.hit(1.5, rim, 88).hit(2.5, rim, 82);
  b.hit(1, snare, 58).hit(3.5, snare, 56);
  hatGrid(b, 4, 0.5, 68, 46, 4);
  if (i % 2 === 1) b.hit(2.75, rim, 74);
  return b.build(4, 4, `bossa#${i}`);
}

/** `reggae` — one drop: kick and snare together on the three, nothing on one. */
function reggaePattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(2, kick, 114).hit(2, snare, 102);
  if (i % 2 === 1) b.hit(3.5, kick, 92);
  b.hit(1.5, rim, 84).hit(3.5, rim, 76);
  hatGrid(b, 4, 0.5, 72, 48, 4);
  return b.build(4, 4, `reggae#${i}`);
}

/** `disco` — four on the floor, open hats on every "and". */
function discoPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.run(0, 1, 4, kick, () => 114);
  backbeat(b, 4, 106);
  for (const beat of [0.5, 1.5, 2.5, 3.5]) b.hit(beat, openHat, 84);
  hatGrid(b, 4, 1, 70, 62, 2);
  if (i % 2 === 1) b.hit(3.25, snare, 58);
  return b.build(4, 4, `disco#${i}`);
}

/** `afrobeat` — sixteenth hats against a displaced kick, backbeat on 2 and 4. */
function afrobeatPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 116).hit(2.5, kick, 104).hit(3.5, kick, 96);
  backbeat(b, 4, 106);
  hatGrid(b, 4, 0.25, 74, 46, 4);
  if (i % 2 === 1) b.hit(1.75, rim, 78);
  return b.build(4, 4, `afrobeat#${i}`);
}

/** `punk` — straight sixteenths, kick on every beat, no ghosts. */
function punkPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.run(0, 1, 4, kick, () => 118);
  backbeat(b, 4, 112);
  hatGrid(b, 4, 0.25, 80, 54, 4);
  if (i % 2 === 1) b.hit(3.75, snare, 60);
  return b.build(4, 4, `punk#${i}`);
}

/** `ballad` — one kick, one backbeat, quarter-note hats. Space is the point. */
function balladPattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 108);
  b.hit(2, snare, 98);
  hatGrid(b, 4, 1, 64, 50, 2);
  if (i % 2 === 1) b.hit(2.5, kick, 88);
  return b.build(4, 4, `ballad#${i}`);
}

/** `second_line` — the New Orleans street beat: displaced kick, snare chatter. */
function secondLinePattern(i: number): PackedVariant {
  const b = new PatternBuilder();
  b.hit(0, kick, 114).hit(2.5, kick, 104);
  backbeat(b, 4, 104);
  ghosts(b, [1.5, 3.5]);
  hatGrid(b, 4, 0.5, 72, 48);
  if (i % 4 === 3) b.hit(3.25, rim, 70);
  return b.build(4, 4, `second_line#${i}`);
}

export const CURATED_PATTERNS: Partial<Record<DrumPattern, PackedVariant[]>> = {
  kick_only: variants(4, kickOnlyPattern),
  bridge_sparse: variants(3, bridgeSparsePattern),
  half_time: variants(3, halfTimePattern),
  standard: variants(4, standardPattern),
  driving: variants(4, drivingPattern),
  intense: variants(4, intensePattern),
  // The odd meters are written too. The corpus's handful of 5/4 and 6/8
  // takes stay as feel donors.
  "78": variants(10, sevenEight),
  "54": variants(10, fiveFour),
  "68": variants(10, sixEight),
  // The idiom shelf.
  motown: variants(4, motownPattern),
  boom_bap: variants(4, boomBapPattern),
  train_beat: variants(4, trainBeatPattern),
  bossa: variants(4, bossaPattern),
  reggae: variants(4, reggaePattern),
  disco: variants(4, discoPattern),
  afrobeat: variants(4, afrobeatPattern),
  punk: variants(4, punkPattern),
  ballad: variants(4, balladPattern),
  second_line: variants(4, secondLinePattern),
};

/**
 * A groove written FROM the meter — the last resort when a section's bar
 * length has no authored pattern at all (3/8, 9/8, 11/16, 25/16 ...).
 *
 * It tiles the meter's own 2s/3s grouping (`buildMeterOutline`): kick on the
 * first and last group, snare in the middle, a hat on every cell with a soft
 * subdivision inside. Metrically exact by construction, so it cannot drift
 * against the barline the way a 4/4 pattern played in 3/8 does — and it
 * means no section is ever left with drums in the wrong meter.
 */
export function meterGrooveVariant(numerator: number, denominator: number, variantIndex = 0): PackedVariant | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator < 2 || denominator < 1) return null;
  let outline: MeterOutline;
  try {
    outline = buildMeterOutline(numerator, denominator, variantIndex);
  } catch {
    return null;
  }

  const b = new PatternBuilder();
  const starts: number[] = [];
  let beat = 0;
  for (const cell of outline.cells) {
    starts.push(round4(beat));
    beat += cell * outline.cellBeats;
  }
  const total = round4(beat);
  const snareIndex = Math.floor(starts.length / 2);

  outline.cells.forEach((cell, i) => {
    const start = starts[i]!;
    const isFirst = i === 0;
    const isLast = i === starts.length - 1;
    if (isFirst || isLast) b.hit(start, kick, isFirst ? 118 : 106);
    if (i === snareIndex) b.hit(start, snare, 106);
    for (let sub = 0; sub < cell; sub++) {
      b.hit(round4(start + sub * outline.cellBeats), closedHat, sub === 0 ? 80 : 44);
    }
  });

  return b.build(total, total, `meter:${numerator}/${denominator}#${variantIndex}`);
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
};

/** Synthesized fills keyed by bar length in quarter-note beats. */
export const SYNTH_FILLS: Record<string, PackedVariant[]> = {
  "4": variants(8, (i) => synthFill(4, i)),
  "3": variants(4, (i) => synthFill(3, i)),
  "3.5": variants(4, (i) => synthFill(3.5, i)),
  "5": variants(4, (i) => synthFill(5, i)),
};

export const CRASH_PITCH = crash;
