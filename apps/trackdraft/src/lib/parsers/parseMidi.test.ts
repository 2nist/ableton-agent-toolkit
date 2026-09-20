import { describe, it, expect } from "vitest";
import { parseMidiBytes } from "./parseMidi";

/** Builds a minimal format-0 MIDI file with one track of raw events. */
function midiFile(eventBytes: number[]): Uint8Array {
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]; // MThd, 1 track, 480 ppq
  const len = eventBytes.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trackHeader, ...eventBytes]);
}

describe("parseMidiBytes — note pairing", () => {
  it("pairs overlapping same-pitch notes FIFO instead of dropping one", () => {
    // Snare flam: noteOn(38,v20)@0, noteOn(38,v6)@120, noteOff@240, noteOff@360.
    // The first noteOff must close the *oldest* noteOn (true span 0→240), and
    // the second note (120→360) must survive — previously the second noteOn
    // overwrote the first, mispairing ends and losing a note.
    const bytes = midiFile([
      0x00, 0x99, 0x26, 0x14, // delta 0,   ch9 noteOn 38 v20
      0x78, 0x99, 0x26, 0x06, // delta 120, noteOn 38 v6
      0x78, 0x89, 0x26, 0x00, // delta 120, noteOff 38
      0x78, 0x89, 0x26, 0x00, // delta 120, noteOff 38
      0x00, 0xff, 0x2f, 0x00, // end of track
    ]);

    const midi = parseMidiBytes(bytes);
    const snares = midi.notes.filter((n) => n.note === 38);
    expect(snares.map((n) => [n.startTick, n.endTick, n.velocity])).toEqual([
      [0, 240, 20],
      [120, 360, 6],
    ]);
  });

  it("still pairs simple sequential notes per pitch", () => {
    const bytes = midiFile([
      0x00, 0x99, 0x24, 0x40, // noteOn 36 v64 @0
      0x78, 0x89, 0x24, 0x00, // noteOff @120
      0x78, 0x99, 0x24, 0x50, // noteOn 36 v80 @240
      0x78, 0x89, 0x24, 0x00, // noteOff @360
      0x00, 0xff, 0x2f, 0x00,
    ]);
    const midi = parseMidiBytes(bytes);
    const kicks = midi.notes.filter((n) => n.note === 36);
    expect(kicks.map((n) => [n.startTick, n.endTick, n.velocity])).toEqual([
      [0, 120, 64],
      [240, 360, 80],
    ]);
  });
});
