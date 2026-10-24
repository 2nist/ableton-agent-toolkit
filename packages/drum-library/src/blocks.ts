import { voiceOf, type KitVoice } from "./kit.js";
import {
  outlineToClickPattern,
  outlineToGroovePattern,
  type CellVoice,
  type MeterOutline,
} from "./meter.js";
import { hashSeed } from "./handoffs.js";
import {
  euclidOnsetSteps,
  KIT_PITCHES,
  type EuclidLike,
  type TiledNote,
} from "./section.js";
import { synthesizeTransition, transitionFlavor, type TransitionModel } from "./transitions.js";

/**
 * Drum Blocks — the range-scoped, per-lane authoring layer behind the Drum
 * Blocks timeline (dotted step lanes, the selection's XY pad, motion
 * gestures and step FX). A block says "this lane plays THIS in this range";
 * the compiler splices the result into the section's already-tiled notes as
 * the LAST content layer, so authored material always beats the automatic
 * fills/transitions/detours underneath — and because it runs inside
 * `planSectionDrumNotes`, the app's MIDI export, live MIDI out, the preview
 * and the Ableton bridge all stay byte-identical by construction.
 *
 * Everything is pure and seeded (`hashSeed` over the occurrence seed):
 * probability keeps/drops, humanize jitter and ratchet/flam expansion bake
 * to concrete notes at plan time, so no output path needs a live random
 * source and the parity tests keep their meaning.
 *
 * Blocks are clamped to the section (`[0, durationBeats]`) — the no-bleed
 * invariant — and never mutate their inputs.
 */

/** The six lane families the timeline stages (mirrors the app's
 *  `laneStyle.ts` DRUM_LANES keys). */
export type DrumLaneId = "kick" | "snare" | "rim" | "hat" | "cym" | "tom";

/** Member voices per lane family — one definition of "what a HAT block
 *  replaces" shared by the compiler and both exporters. */
export const DRUM_LANE_VOICES: Record<DrumLaneId, KitVoice[]> = {
  kick: ["kick"],
  snare: ["snare"],
  rim: ["rim", "clap", "shaker", "cowbell"],
  hat: ["closedHat", "openHat", "pedalHat"],
  cym: ["crash", "ride", "rideBell"],
  tom: ["tomLow", "tomMid", "tomHigh"],
};

/** The voice a generated note plays when a block doesn't name one. */
export const DRUM_LANE_PRIMARY: Record<DrumLaneId, KitVoice> = {
  kick: "kick",
  snare: "snare",
  rim: "rim",
  hat: "closedHat",
  cym: "ride",
  tom: "tomMid",
};

/** Interleave priority, low index = wins the earlier onsets — the spec's
 *  Kick > Snare > Toms > Percussion. */
export const DRUM_LANE_PRIORITY: DrumLaneId[] = ["kick", "snare", "tom", "rim", "hat", "cym"];

/** One authored step (block-relative `beat`). */
export interface DrumBlockNote {
  beat: number;
  voice: KitVoice;
  velocity: number;
  /** Micro-timing nudge in beats (negative = early). */
  offsetBeats?: number;
  /** Gate / step length in beats. Absent → the context grid. */
  durBeats?: number;
  /** Keep probability 0..1 (seeded). Absent → always plays. */
  prob?: number;
  /** Sub-hits packed into the step's gate (1..4). Absent → 1. */
  ratchet?: number;
  /** Grace note a hair before the step. Absent → off. */
  flam?: boolean;
}

/** Range-level effects, applied to the block's own notes after generation. */
export interface DrumBlockFx {
  /** Delays off-8th hits toward the triplet feel (0..1). */
  swing?: number;
  /** Seeded timing/velocity jitter (0..1). */
  humanize?: number;
  /** Pull notes toward the 16th grid (0..1). */
  quantize?: number;
  /** Velocity remap, soft (-1) → hard (+1). */
  velCurve?: number;
}

/** Structurally compatible with song-blueprint's `DrumBlock`. */
export interface DrumBlock {
  id: string;
  lane: DrumLaneId;
  groupId?: string;
  startBeat: number;
  endBeat: number;
  mode: "inherit" | "euclid" | "outline" | "steps" | "motion";
  euclid?: EuclidLike;
  outline?: MeterOutline & { cellVoices?: CellVoice[] };
  notes?: DrumBlockNote[];
  motion?: { x: number; y: number };
  interleave?: boolean;
  fx?: DrumBlockFx;
}

export interface ApplyDrumBlocksContext {
  /** The section's total beats — blocks are clamped to it. */
  durationBeats: number;
  /** The base variant's beats per bar (motion gestures are bar-anchored). */
  beatsPerBar: number;
  /** The section's velocity target (post-Bend) — generated notes land here. */
  velocityTarget: number;
  /** Subdivision grid for motion synthesis / default gates — an outline's
   *  `cellBeats`, or 0.25 for standard presets. */
  gridBeats?: number;
  /** The occurrence seed (`occurrenceSeed(sectionId, occurrenceIndex)`) —
   *  every seeded bake derives from it. */
  seed: string;
}

/** ≈31ms at 120 BPM — the grace-note distance of a flam. */
const FLAM_OFFSET_BEATS = 0.0625;
/** Max off-8th delay at swing = 1: the classic ½ → ⅔ beat shift. */
const SWING_MAX_BEATS = 1 / 6;
/** Max humanize timing jitter (±, beats) and velocity jitter (±) at 1. */
const HUMANIZE_MAX_BEATS = 0.012;
const HUMANIZE_MAX_VELOCITY = 6;
/** Motion deadzone — below this magnitude the gesture authorizes nothing. */
const MOTION_DEADZONE = 0.15;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * The full blocks pass for one section's tiled notes. Returns `tiled`
 * untouched (same reference) when there are no valid blocks, so blockless
 * songs stay byte-identical (the migration guarantee).
 */
export function applyDrumBlocks(
  tiled: TiledNote[],
  blocks: readonly DrumBlock[] | null | undefined,
  ctx: ApplyDrumBlocksContext,
): TiledNote[] {
  if (!blocks || blocks.length === 0) return tiled;

  const valid = blocks
    .filter((b) => DRUM_LANE_VOICES[b.lane] !== undefined && b.endBeat > b.startBeat)
    .map((b) => ({
      ...b,
      startBeat: Math.max(0, Math.min(b.startBeat, ctx.durationBeats)),
      endBeat: Math.max(0, Math.min(b.endBeat, ctx.durationBeats)),
    }))
    .filter((b) => b.endBeat - b.startBeat > 1e-9)
    .sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id));
  if (valid.length === 0) return tiled;

  let out = tiled;
  const done = new Set<string>();

  // Interleave clusters first — one rhythm spread across their lanes by
  // priority, replacing all the member lanes' content in the shared range.
  const groups = new Map<string, DrumBlock[]>();
  for (const b of valid) {
    if (b.groupId && b.interleave) {
      const list = groups.get(b.groupId) ?? [];
      list.push(b);
      groups.set(b.groupId, list);
    }
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    out = applyInterleaveCluster(out, members, ctx);
    for (const m of members) done.add(m.id);
  }

  // Remaining blocks in time order.
  for (const b of valid) {
    if (done.has(b.id)) continue;
    out = applyBlock(out, b, ctx);
  }

  return out.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
}

// ---------------------------------------------------------------------------
// Per-block modes
// ---------------------------------------------------------------------------

function applyBlock(tiled: TiledNote[], block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  switch (block.mode) {
    case "inherit":
      return applyFxToLane(tiled, block, ctx);
    case "euclid":
      return spliceLane(tiled, block, euclidBlockNotes(tiled, block, ctx), ctx);
    case "outline":
      return spliceLane(tiled, block, outlineBlockNotes(block, ctx), ctx);
    case "steps":
      return spliceLane(tiled, block, stepsBlockNotes(block, ctx), ctx);
    case "motion":
      return applyMotionBlock(tiled, block, ctx);
    default:
      return tiled;
  }
}

/** Removes the lane family's notes inside the block range and inserts
 *  `added` (with the block's range FX applied). Everything outside the
 *  range — and every other lane — is untouched. */
function spliceLane(
  tiled: TiledNote[],
  block: DrumBlock,
  added: TiledNote[],
  ctx: ApplyDrumBlocksContext,
): TiledNote[] {
  const voices = new Set(DRUM_LANE_VOICES[block.lane]);
  const kept = tiled.filter((n) => {
    const v = voiceOf(n.pitch);
    if (!v || !voices.has(v)) return true;
    return n.beat < block.startBeat - 1e-9 || n.beat >= block.endBeat - 1e-9;
  });
  return [...kept, ...applyRangeFx(added, block, ctx)];
}

/** The peak velocity the lane family currently plays inside the block range
 *  — generated euclid/outline material inherits it, so a block lands in the
 *  section's actual dynamic, like `applyVoiceOverrides` does upstream. */
function lanePeakVelocity(tiled: TiledNote[], block: DrumBlock): number | null {
  const voices = new Set(DRUM_LANE_VOICES[block.lane]);
  let peak: number | null = null;
  for (const n of tiled) {
    if (n.beat < block.startBeat - 1e-9 || n.beat >= block.endBeat - 1e-9) continue;
    const v = voiceOf(n.pitch);
    if (!v || !voices.has(v)) continue;
    if (peak === null || n.velocity > peak) peak = n.velocity;
  }
  return peak;
}

function euclidBlockNotes(tiled: TiledNote[], block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  const pat = block.euclid ?? { k: 4, n: 8, rotation: 0 };
  const rangeBeats = block.endBeat - block.startBeat;
  const n = Math.max(1, Math.floor(pat.n));
  const stepBeats = rangeBeats / n;
  const pitch = KIT_PITCHES[DRUM_LANE_PRIMARY[block.lane]];
  const velocity = lanePeakVelocity(tiled, block) ?? Math.round(ctx.velocityTarget);
  return euclidOnsetSteps(pat).map((step) => ({
    beat: round4(block.startBeat + step * stepBeats),
    pitch,
    velocity,
  }));
}

function outlineBlockNotes(block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  const outline = block.outline;
  if (!outline) return [];
  const raw = outline.cellVoices
    ? outlineToGroovePattern(outline, outline.cellVoices)
    : outlineToClickPattern(outline);
  const cycleBeats = outline.cells.reduce((sum, cell) => sum + cell, 0) * outline.cellBeats;
  if (cycleBeats <= 0 || raw.length === 0) return [];

  const peak = Math.max(...raw.map(([, , v]) => v), 1);
  const scale = ctx.velocityTarget / peak;
  const rangeBeats = block.endBeat - block.startBeat;
  const notes: TiledNote[] = [];
  for (let base = 0; base < rangeBeats - 1e-9; base += cycleBeats) {
    for (const [beat, pitch, velocity] of raw) {
      const pos = base + beat;
      if (pos >= rangeBeats - 1e-9) continue;
      notes.push({
        beat: round4(block.startBeat + pos),
        pitch,
        velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
      });
    }
  }
  return notes;
}

function stepsBlockNotes(block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  const notes: TiledNote[] = [];
  const src = block.notes ?? [];
  const grid = Math.max(0.01, ctx.gridBeats ?? 0.25);

  src.forEach((n, i) => {
    // Seeded probability keep/drop — bakes to concrete notes here so every
    // output path (and repeat plans of the same occurrence) is identical.
    if (n.prob !== undefined && n.prob < 1) {
      const roll = hashSeed(`${ctx.seed}:block:${block.id}:${i}`) % 1000;
      if (roll >= clamp01(n.prob) * 1000) return;
    }

    const beatBase = block.startBeat + n.beat + (n.offsetBeats ?? 0);
    const ratchet = Math.max(1, Math.min(4, Math.round(n.ratchet ?? 1)));
    const dur = Math.max(0.02, n.durBeats ?? grid);
    const pitch = KIT_PITCHES[n.voice];

    if (n.flam) {
      notes.push({
        beat: round4(Math.max(0, beatBase - FLAM_OFFSET_BEATS)),
        pitch,
        velocity: Math.max(1, Math.round(n.velocity * 0.6)),
        duration: round4(dur),
      });
    }
    for (let r = 0; r < ratchet; r++) {
      const sub = (dur / ratchet) * r;
      const velocity = r === 0 ? n.velocity : Math.max(1, Math.round(n.velocity * 0.75));
      notes.push({
        beat: round4(beatBase + sub),
        pitch,
        velocity: Math.max(1, Math.min(127, velocity)),
        duration: round4(dur / ratchet),
      });
    }
  });

  return notes.filter(
    (n) => n.beat >= block.startBeat - 1e-9 && n.beat < block.endBeat - 1e-9,
  );
}

// ---------------------------------------------------------------------------
// Interleave clusters
// ---------------------------------------------------------------------------

/**
 * A group's shared rhythm — from the first member that carries `euclid`
 * params (the UI writes them together across the group) — spread across the
 * member lanes in priority order (kick > snare > toms > percussion), one
 * onset per lane by round-robin, so repeated onsets read as multi-voice
 * rolls rather than stacked hits. Replaces ALL member lanes' notes in the
 * shared range; everything else is untouched.
 */
export function applyInterleaveCluster(
  tiled: TiledNote[],
  members: readonly DrumBlock[],
  ctx: ApplyDrumBlocksContext,
): TiledNote[] {
  const source = members.find((m) => m.euclid) ?? members[0];
  if (!source) return tiled;
  const pat = source.euclid ?? { k: Math.max(2, members.length), n: 8, rotation: 0 };

  const lanes = DRUM_LANE_PRIORITY.filter((lane) => members.some((m) => m.lane === lane));
  if (lanes.length === 0) return tiled;

  const start = Math.min(...members.map((m) => m.startBeat));
  const end = Math.max(...members.map((m) => m.endBeat));
  const rangeBeats = end - start;
  const n = Math.max(1, Math.floor(pat.n));
  const stepBeats = rangeBeats / n;

  const voices = new Set<KitVoice>();
  for (const m of members) for (const v of DRUM_LANE_VOICES[m.lane]) voices.add(v);
  const kept = tiled.filter((x) => {
    const v = voiceOf(x.pitch);
    if (!v || !voices.has(v)) return true;
    return x.beat < start - 1e-9 || x.beat >= end - 1e-9;
  });

  const velocity = Math.round(ctx.velocityTarget);
  const added: TiledNote[] = euclidOnsetSteps(pat).map((step, i) => ({
    beat: round4(start + step * stepBeats),
    pitch: KIT_PITCHES[DRUM_LANE_PRIMARY[lanes[i % lanes.length]]],
    velocity,
  }));

  return [...kept, ...applyRangeFx(added, source, ctx)];
}

// ---------------------------------------------------------------------------
// Motion gestures
// ---------------------------------------------------------------------------

/** Resolve a motion vector to a transition model + catalog flavor index.
 *  Direction picks the model, magnitude the intensity (bar count), below
 *  `MOTION_DEADZONE` nothing is authorized. Mirrors the UI legend:
 *  ↗/→ build (sprint) · ↖ crescendo (slow burn) · ↓ break (drop) ·
 *  ↙ thin (long fade) · ↘ cut (kick slam). */
export function motionModelFor(vec: { x: number; y: number }): { model: TransitionModel; flavor: number } | null {
  if (Math.hypot(vec.x, vec.y) < MOTION_DEADZONE) return null;
  if (vec.y >= 0) {
    return vec.x >= 0
      ? { model: "buildUp", flavor: 2 } // "32nd sprint"
      : { model: "buildUp", flavor: 3 }; // "slow burn" — the crescendo
  }
  if (Math.abs(vec.x) <= Math.abs(vec.y) * 0.6) return { model: "dropOut", flavor: 1 }; // "drop rhythm"
  return vec.x < 0
    ? { model: "breakDown", flavor: 2 } // "long fade"
    : { model: "cut", flavor: 1 }; // "kick slam"
}

/** Motion blocks replace the range's content (all voices) with the
 *  synthesized gesture, anchored to the range's END so the arrival lands on
 *  the block boundary; the span grows to N bars with the vector's
 *  magnitude, clamped into the block. */
function applyMotionBlock(tiled: TiledNote[], block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  if (!block.motion) return tiled;
  const pick = motionModelFor(block.motion);
  if (!pick) return tiled;

  const mag = Math.min(1, Math.hypot(block.motion.x, block.motion.y));
  const barBeats = Math.max(0.001, ctx.beatsPerBar);
  const maxBars = Math.max(1, Math.floor(ctx.durationBeats / barBeats));
  const bars = Math.max(1, Math.min(maxBars, mag <= 0.33 ? 1 : mag <= 0.66 ? 2 : 3));
  const spanBeats = Math.min(bars * barBeats, block.endBeat - block.startBeat);
  const end = block.endBeat;
  const start = end - spanBeats;

  const baseNotes = tiled
    .filter((n) => n.beat >= start - 1e-9 && n.beat < end - 1e-9)
    .map((n): [number, number, number] => [round4(Math.max(0, n.beat - start)), n.pitch, n.velocity]);

  const generated = synthesizeTransition(pick.model, {
    spanBeats,
    gridBeats: ctx.gridBeats ?? 0.25,
    velocityTarget: ctx.velocityTarget,
    baseNotes,
    flavor: transitionFlavor(pick.model, pick.flavor),
  });

  const kept = tiled.filter((n) => n.beat < start - 1e-9 || n.beat >= end - 1e-9);
  const added: TiledNote[] = generated.map(([beat, pitch, velocity]) => ({
    beat: round4(Math.max(0, start + beat)),
    pitch,
    velocity,
  }));

  return [...kept, ...applyRangeFx(added, block, ctx)];
}

// ---------------------------------------------------------------------------
// Range FX
// ---------------------------------------------------------------------------

/** `inherit` blocks only carry FX — apply them to the lane's existing notes
 *  inside the range (a no-op when the block has none). */
function applyFxToLane(tiled: TiledNote[], block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  if (!block.fx) return tiled;
  const voices = new Set(DRUM_LANE_VOICES[block.lane]);
  const inRange: TiledNote[] = [];
  const others: TiledNote[] = [];
  for (const n of tiled) {
    const v = voiceOf(n.pitch);
    const owned = !!v && voices.has(v);
    if (owned && n.beat >= block.startBeat - 1e-9 && n.beat < block.endBeat - 1e-9) inRange.push(n);
    else others.push(n);
  }
  if (inRange.length === 0) return tiled;
  return [...others, ...applyRangeFx(inRange, block, ctx)];
}

/**
 * The block's range-level effects, in a fixed order (quantize → swing →
 * humanize → velCurve) so the result is fully deterministic. Every seeded
 * bake keys off the block id + note index, which is stable because the
 * notes were just generated in a fixed order.
 */
function applyRangeFx(notes: TiledNote[], block: DrumBlock, ctx: ApplyDrumBlocksContext): TiledNote[] {
  const fx = block.fx;
  if (!fx) return notes;
  let out = notes;

  if (fx.quantize) {
    const q = clamp01(fx.quantize);
    out = out.map((n) => ({
      ...n,
      beat: round4(n.beat + (Math.round(n.beat / 0.25) * 0.25 - n.beat) * q),
    }));
  }

  if (fx.swing) {
    const s = clamp01(fx.swing);
    out = out.map((n) => {
      const inBeat = n.beat - Math.floor(n.beat + 1e-9);
      const isOff8th = Math.abs(inBeat - 0.5) < 1e-6;
      return isOff8th ? { ...n, beat: round4(n.beat + s * SWING_MAX_BEATS) } : n;
    });
  }

  if (fx.humanize) {
    const h = clamp01(fx.humanize);
    out = out.map((n, i) => {
      const t = (hashSeed(`${ctx.seed}:hb:${block.id}:${i}`) % 1000) / 1000 - 0.5;
      const v = (hashSeed(`${ctx.seed}:hv:${block.id}:${i}`) % 1000) / 1000 - 0.5;
      return {
        ...n,
        beat: round4(n.beat + t * 2 * HUMANIZE_MAX_BEATS * h),
        velocity: Math.max(1, Math.min(127, Math.round(n.velocity + v * 2 * HUMANIZE_MAX_VELOCITY * h))),
      };
    });
  }

  if (fx.velCurve) {
    const curve = Math.max(-1, Math.min(1, fx.velCurve));
    const gamma = 1 - curve * 0.5; // -1 → 1.5 (soft), +1 → 0.5 (hard)
    out = out.map((n) => ({
      ...n,
      velocity: Math.max(1, Math.min(127, Math.round(127 * Math.pow(n.velocity / 127, gamma)))),
    }));
  }

  return out;
}
