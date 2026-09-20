import { describe, expect, it } from "vitest";
import { parseSmf, quantizeToGrid } from "./midi";

/**
 * A minimal SMF built by hand: track name meta, a running-status note pair,
 * a sysex to skip, and a non-drum note. division 96 ppq.
 */
const SMF = new Uint8Array([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x00, 0x60,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 36,
  0x00, 0xff, 0x03, 0x04, 0x74, 0x65, 0x73, 0x74, // FF 03 "test"
  0x00, 0x90, 0x24, 0x64, // kick 36 vel 100 @0
  0x18, 0x26, 0x5a,       // delta 24 · RUNNING STATUS 90 → snare 38 vel 90 @24
  0x60, 0x80, 0x26, 0x00, // delta 96 · note off (tick 120)
  0x00, 0x90, 0x2a, 0x38, // hat 42 vel 56 @120
  0x18, 0x80, 0x2a, 0x00, // note off @144
  0x00, 0x90, 0x31, 0x40, // crash 49 vel 64 @144 (not a mapped lane)
  0x00, 0xff, 0x2f, 0x00, // end of track
]);

describe("midi — SMF reader + GM quantization", () => {
  it("parses note-ons through running status, metas and sysex", () => {
    const smf = parseSmf(SMF);
    expect(smf.format).toBe(0);
    expect(smf.division).toBe(96);
    expect(smf.notes).toEqual([
      { tick: 0, note: 36, velocity: 100 },
      { tick: 24, note: 38, velocity: 90 },
      { tick: 120, note: 42, velocity: 56 },
      { tick: 144, note: 49, velocity: 64 },
    ]);
  });

  it("quantizes to the step grid: mapping, carry, offsets, merging", () => {
    const q = quantizeToGrid(parseSmf(SMF).notes, 96, 16, 0);
    expect(q.mapped).toBe(3);
    expect(q.unmapped).toEqual({ 49: 1 });
    expect(q.lanes.kick[0][0]).toBe(100);
    expect(q.lanes.snare[0][1]).toBe(90);
    expect(q.lanes.hat[0][5]).toBe(56);

    // step carry: 372 ticks = 15.5 steps → bar 1 step 0
    const carried = quantizeToGrid([{ tick: 372, note: 36, velocity: 5 }], 96, 16, 0);
    expect(carried.lanes.kick[1][0]).toBe(5);

    // barOffset shifts the file's bar numbering onto the song's
    const shifted = quantizeToGrid([{ tick: 0, note: 36, velocity: 5 }], 96, 16, 1);
    expect(shifted.lanes.kick[1][0]).toBe(5);
    expect(shifted.bars).toBe(2);

    // notes before song bar 0 are dropped, not clamped
    const late = quantizeToGrid([{ tick: 0, note: 36, velocity: 5 }], 96, 16, -1);
    expect(late.mapped).toBe(0);
    expect(late.beforeStart).toBe(1);

    // two notes on one cell keep the louder velocity
    const merged = quantizeToGrid(
      [{ tick: 0, note: 36, velocity: 40 }, { tick: 5, note: 36, velocity: 90 }],
      96, 16, 0,
    );
    expect(merged.lanes.kick[0][0]).toBe(90);

    // the pack MIDI's entry fill: tick 582 → bar 1 step 8
    const pack = quantizeToGrid([{ tick: 582, note: 42, velocity: 1 }], 96, 16, 0);
    expect(pack.lanes.hat[1][8]).toBe(1);
  });
});
