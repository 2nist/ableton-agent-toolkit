/**
 * Tests for the runtime MIDI layer (src/midi.ts) added to support the step
 * sequencer: byte parsing, incoming→named-control resolution (including the
 * matrix-cell resolution getMidi() can't express), and LED/sysex encoding.
 */
import { describe, expect, it } from "vitest";
import {
  APC_MINI_MK2,
  buildCellLed,
  buildCellLedOff,
  buildLedOn,
  buildLedOff,
  buildPadModeSysex,
  cellLedChannel,
  cellNote,
  PAD_MODE,
  parseMidiMessage,
  resolveIncoming,
} from "../src/index.js";

describe("parseMidiMessage", () => {
  it("parses a note-on", () => {
    expect(parseMidiMessage([0x90, 36, 100])).toEqual({
      channel: 0,
      number: 36,
      value: 100,
      messageType: "note",
    });
  });

  it("parses a note-on with velocity 0 as a note (caller decides note-off semantics)", () => {
    expect(parseMidiMessage([0x90, 36, 0])).toEqual({
      channel: 0,
      number: 36,
      value: 0,
      messageType: "note",
    });
  });

  it("parses a note-off", () => {
    expect(parseMidiMessage([0x80, 36, 64])).toEqual({
      channel: 0,
      number: 36,
      value: 64,
      messageType: "note",
    });
  });

  it("parses a CC on channel 9 (0-based)", () => {
    expect(parseMidiMessage([0xb9, 48, 127])).toEqual({
      channel: 9,
      number: 48,
      value: 127,
      messageType: "cc",
    });
  });

  it("returns null for too-short or unknown status bytes", () => {
    expect(parseMidiMessage([0x90])).toBeNull();
    expect(parseMidiMessage([])).toBeNull();
    expect(parseMidiMessage([0xa0, 1, 2])).toBeNull(); // poly aftertouch
  });
});

describe("resolveIncoming", () => {
  it("resolves a direct control (shift button note 122)", () => {
    const msg = parseMidiMessage([0x90, 122, 127])!;
    const resolved = resolveIncoming(APC_MINI_MK2, msg);
    expect(resolved).toEqual({
      kind: "control",
      name: "shift_button",
      element: expect.objectContaining({ midi: 122 }),
    });
  });

  it("resolves the master fader (CC 56)", () => {
    const msg = parseMidiMessage([0xb0, 56, 64])!;
    const resolved = resolveIncoming(APC_MINI_MK2, msg);
    expect(resolved).toMatchObject({ kind: "control", name: "master_fader" });
  });

  it("resolves a clip-launch pad cell by (channel, note)", () => {
    const msg = parseMidiMessage([0x90, 0, 100])!;
    const resolved = resolveIncoming(APC_MINI_MK2, msg);
    // note 0 is the physical BOTTOM row (flipRows) — so physical row 7, col 0.
    expect(resolved).toMatchObject({
      kind: "pad",
      matrix: "clip_launch_buttons",
      row: 7,
      col: 0,
      note: 0,
    });
  });

  it("resolves a mid-grid clip-launch pad (note 35 → physical row 3 col 3)", () => {
    const msg = parseMidiMessage([0x90, 35, 100])!;
    const resolved = resolveIncoming(APC_MINI_MK2, msg);
    expect(resolved).toMatchObject({
      kind: "pad",
      matrix: "clip_launch_buttons",
      row: 3,
      col: 3,
    });
  });

  it("resolves a drum pad on channel 9 (note 64 → physical row 7 col 0)", () => {
    const msg = parseMidiMessage([0x99, 64, 100])!;
    const resolved = resolveIncoming(APC_MINI_MK2, msg);
    expect(resolved).toMatchObject({
      kind: "pad",
      matrix: "drum_pads",
      row: 7,
      col: 0,
      note: 64,
    });
  });

  it("resolves track buttons and scene buttons as 1×8 matrices", () => {
    const track = resolveIncoming(APC_MINI_MK2, parseMidiMessage([0x90, 100, 127])!);
    expect(track).toMatchObject({ kind: "pad", matrix: "track_buttons", row: 0, col: 0 });

    const scene = resolveIncoming(APC_MINI_MK2, parseMidiMessage([0x90, 112, 127])!);
    expect(scene).toMatchObject({ kind: "pad", matrix: "scene_launch_buttons", row: 0, col: 0 });
  });

  it("resolves faders as a CC matrix cell", () => {
    const fader = resolveIncoming(APC_MINI_MK2, parseMidiMessage([0xb0, 48, 64])!);
    expect(fader).toMatchObject({ kind: "pad", matrix: "faders", row: 0, col: 0 });
  });

  it("disambiguates note vs CC on the same number (48 is a pad note AND a fader CC)", () => {
    // CC 48 → fader matrix (msgType cc), note-on 48 → clip-launch pad (msgType note).
    const fader = resolveIncoming(APC_MINI_MK2, parseMidiMessage([0xb0, 48, 64])!);
    expect(fader).toMatchObject({ kind: "pad", matrix: "faders" });
    const pad = resolveIncoming(APC_MINI_MK2, parseMidiMessage([0x90, 48, 64])!);
    // note 48 (identifiers row 6) is the physical row 1 (flipRows).
    expect(pad).toMatchObject({ kind: "pad", matrix: "clip_launch_buttons", row: 1, col: 0 });
  });

  it("returns null for an unknown note/CC", () => {
    expect(resolveIncoming(APC_MINI_MK2, parseMidiMessage([0x90, 200, 100])!)).toBeNull();
    expect(resolveIncoming(APC_MINI_MK2, parseMidiMessage([0xb0, 99, 100])!)).toBeNull();
  });
});

describe("LED + sysex encoding", () => {
  it("builds a pad-mode sysex from the header + mode + F7", () => {
    expect(buildPadModeSysex(APC_MINI_MK2, PAD_MODE.note)).toEqual([
      0xf0, 71, 127, 79, 98, 0, 1, 2, 0xf7,
    ]);
  });

  it("builds LED note-on/note-off bytes on the LED channel", () => {
    expect(buildLedOn(6, 0, 21)).toEqual([0x96, 0, 21]);
    expect(buildLedOff(6, 0)).toEqual([0x96, 0, 0]);
  });

  it("resolves clip-launch cells to ledChannel 6", () => {
    const matrix = APC_MINI_MK2.matrices.clip_launch_buttons;
    expect(cellLedChannel(matrix, 0, 0)).toBe(6);
    // physical top row 0 = note 56; physical bottom row 7 = note 7 (flipRows).
    expect(cellNote(matrix, 0, 0)).toBe(56);
    expect(cellNote(matrix, 7, 7)).toBe(7);
  });

  it("builds a cell LED message from the matrix's led channel + note + color", () => {
    const matrix = APC_MINI_MK2.matrices.clip_launch_buttons;
    // physical row 2 → identifiers row 5 → note 5*8+3 = 43.
    expect(buildCellLed(matrix, 2, 3, 21)).toEqual([0x96, 43, 21]);
    expect(buildCellLedOff(matrix, 2, 3)).toEqual([0x96, 43, 0]);
  });

  it("returns null for out-of-range cells", () => {
    const matrix = APC_MINI_MK2.matrices.clip_launch_buttons;
    expect(cellNote(matrix, 8, 0)).toBeNull();
    expect(buildCellLed(matrix, 8, 0, 21)).toBeNull();
  });
});
