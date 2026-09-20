/**
 * Minimal SMF (Standard MIDI File) reader + GM drum-map quantization —
 * the MIDI half of the drum importer toolchain, no npm dependencies.
 *
 * Sources this serves: Songsterr/GuitarPro-style drum transcriptions,
 * vendor drum-MIDI packs, and Ableton's "Convert Drums to MIDI" output
 * (all write kick/snare/hat on the standard GM notes below). The parsed
 * notes are quantized straight onto the 16th-step grid the importer's
 * analysis format uses — no velocity or timing heuristics needed: MIDI
 * already IS the grid.
 */

import type { LaneName } from "./transcribe";

export interface MidiNote { tick: number; note: number; velocity: number }

export interface Smf {
  format: number;
  /** Pulses per quarter note (SMPTE-division files are not supported). */
  division: number;
  notes: MidiNote[];
}

/** Standard GM drum notes → the importer's three lanes. */
export const GM_DRUM_LANES: Record<number, LaneName> = {
  35: "kick", 36: "kick",
  37: "snare", 38: "snare", 39: "snare", 40: "snare",
  42: "hat", 44: "hat", 46: "hat",
};

/** Read a variable-length quantity. */
function readVlq(bytes: Uint8Array, i: number): [value: number, next: number] {
  let v = 0;
  for (;;) {
    const b = bytes[i++];
    v = (v << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return [v, i];
  }
}

/** Parse the note-on events of an SMF (formats 0 and 1; tracks merged). */
export function parseSmf(bytes: Uint8Array): Smf {
  const dv = (o: number): number =>
    (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
  const tag = (o: number): string =>
    String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 14 || tag(0) !== "MThd") throw new Error("not a MIDI file (missing MThd)");
  const format = (bytes[8] << 8) | bytes[9];
  const division = (bytes[12] << 8) | bytes[13];
  if (division & 0x8000) throw new Error("SMPTE-division MIDI files are not supported");
  const notes: MidiNote[] = [];
  let i = 8 + dv(4);
  while (i + 8 <= bytes.length) {
    if (tag(i) !== "MTrk") break;
    const size = dv(i + 4);
    let pos = i + 8;
    const end = pos + size;
    let tick = 0;
    let status = 0;
    while (pos < end) {
      const [delta, next] = readVlq(bytes, pos);
      tick += delta;
      pos = next;
      if (bytes[pos] & 0x80) status = bytes[pos++];
      if (status === 0xff) {
        pos++; // meta type
        const [len, after] = readVlq(bytes, pos);
        pos = after + len;
      } else if (status === 0xf0 || status === 0xf7) {
        const [len, after] = readVlq(bytes, pos);
        pos = after + len;
      } else {
        const hi = status & 0xf0;
        if (hi === 0x90 || hi === 0x80) {
          const note = bytes[pos];
          const vel = bytes[pos + 1];
          pos += 2;
          if (hi === 0x90 && vel > 0) notes.push({ tick, note, velocity: vel });
        } else if (hi === 0xc0 || hi === 0xd0) {
          pos += 1;
        } else {
          pos += 2;
        }
      }
    }
    i = end;
  }
  notes.sort((a, b) => a.tick - b.tick);
  return { format, division, notes };
}

export interface QuantizedDrums {
  /** Bars covered by the MIDI (after barOffset). */
  bars: number;
  /** [lane][bar][step] → velocity 1..127 (0 = rest). */
  lanes: Record<LaneName, number[][]>;
  /** Notes landing on a mapped lane. */
  mapped: number;
  /** Notes before song bar 0 (dropped — they pre-date the arrangement). */
  beforeStart: number;
  /** Non-drum notes encountered, note number → count. */
  unmapped: Record<number, number>;
}

/**
 * Quantize MIDI notes onto the step grid. `barOffset` maps the file's bar
 * numbering onto the song's: songBar = midiBar + barOffset (vendor files
 * often number bars from their first notated bar, not the recording's).
 */
export function quantizeToGrid(
  notes: MidiNote[],
  division: number,
  stepsPerBar: number,
  barOffset: number,
): QuantizedDrums {
  const barTicks = division * 4;
  const stepTicks = barTicks / stepsPerBar;
  const cells = new Map<string, { bar: number; step: number; lane: LaneName; vel: number }>();
  const unmapped: Record<number, number> = {};
  let mapped = 0;
  let beforeStart = 0;
  let maxBar = -1;
  for (const n of notes) {
    const lane = GM_DRUM_LANES[n.note];
    if (!lane) {
      unmapped[n.note] = (unmapped[n.note] ?? 0) + 1;
      continue;
    }
    const g = Math.round(n.tick / stepTicks) + barOffset * stepsPerBar;
    const bar = Math.floor(g / stepsPerBar);
    if (bar < 0) {
      beforeStart++;
      continue;
    }
    const step = g - bar * stepsPerBar;
    mapped++;
    if (bar > maxBar) maxBar = bar;
    const key = `${bar}:${step}:${lane}`;
    const prev = cells.get(key);
    if (!prev || n.velocity > prev.vel) cells.set(key, { bar, step, lane, vel: n.velocity });
  }
  const bars = Math.max(1, maxBar + 1);
  const lanes = {
    kick: Array.from({ length: bars }, () => new Array<number>(stepsPerBar).fill(0)),
    snare: Array.from({ length: bars }, () => new Array<number>(stepsPerBar).fill(0)),
    hat: Array.from({ length: bars }, () => new Array<number>(stepsPerBar).fill(0)),
  } as Record<LaneName, number[][]>;
  for (const c of cells.values()) {
    lanes[c.lane][c.bar][c.step] = Math.max(lanes[c.lane][c.bar][c.step], c.vel);
  }
  return { bars, lanes, mapped, beforeStart, unmapped };
}
