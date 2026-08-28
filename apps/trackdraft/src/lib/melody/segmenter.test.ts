import { describe, it, expect } from "vitest";
import { NoteSegmenter, DEFAULT_SEGMENTER_CONFIG, type SegmenterConfig } from "./segmenter";

/** A fast-cadence config so tests don't need many frames to trigger the
 *  unvoiced-break and jump thresholds (each frame = 1/60s here). */
const cfg: SegmenterConfig = { ...DEFAULT_SEGMENTER_CONFIG, unvoicedBreakSec: 0.05, pitchJumpFrames: 2 };

function seg(c: SegmenterConfig = cfg): NoteSegmenter {
  return new NoteSegmenter(c);
}

describe("NoteSegmenter", () => {
  it("turns a held tone into one note with the median pitch", () => {
    const s = seg();
    for (let i = 0; i < 20; i++) s.feed(60, i / 60, 0.95); // 20 frames of C4
    const notes = s.finish(20 / 60);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(60);
    expect(notes[0].durationSec).toBeGreaterThan(0.1);
  });

  it("splits two tones separated by silence into two notes", () => {
    const s = seg();
    // 10 frames of E4, then 6 frames of silence, then 10 frames of G4.
    for (let i = 0; i < 10; i++) s.feed(64, i / 60, 0.95);
    for (let i = 0; i < 6; i++) s.feed(null, (10 + i) / 60, 0.1);
    for (let i = 0; i < 10; i++) s.feed(67, (16 + i) / 60, 0.95);
    const notes = s.finish(26 / 60);
    expect(notes).toHaveLength(2);
    expect(notes[0].pitch).toBe(64);
    expect(notes[1].pitch).toBe(67);
    expect(notes[1].startSec).toBeGreaterThan(notes[0].startSec + notes[0].durationSec);
  });

  it("treats a sustained melodic leap as a new note", () => {
    const s = seg();
    // 10 frames of C4, then 12 frames leaping to E4 (a >1.4-semitone leap
    // held long enough to survive the glitch-length filter).
    for (let i = 0; i < 10; i++) s.feed(60, i / 60, 0.95);
    for (let i = 0; i < 12; i++) s.feed(64, (10 + i) / 60, 0.95);
    const notes = s.finish(22 / 60);
    expect(notes).toHaveLength(2);
    expect(notes[0].pitch).toBe(60);
    expect(notes[1].pitch).toBe(64);
  });

  it("ignores a single-frame pitch blip in the middle of a held note", () => {
    const s = seg();
    for (let i = 0; i < 8; i++) s.feed(60, i / 60, 0.95);
    s.feed(66, 8 / 60, 0.9); // one outlier frame
    for (let i = 9; i < 18; i++) s.feed(60, i / 60, 0.95);
    const notes = s.finish(18 / 60);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(60); // median survives the blip
  });

  it("drops glitch-short notes below minNoteMs", () => {
    const s = seg();
    // One frame voiced then silence — far under 120ms → dropped.
    s.feed(60, 0, 0.95);
    for (let i = 1; i < 5; i++) s.feed(null, i / 60, 0.1);
    const notes = s.finish(5 / 60);
    expect(notes).toHaveLength(0);
  });

  it("treats low-clarity frames as unvoiced (breath between syllables)", () => {
    const s = seg();
    for (let i = 0; i < 10; i++) s.feed(62, i / 60, 0.95);
    for (let i = 0; i < 5; i++) s.feed(62, (10 + i) / 60, 0.2); // breathy → unvoiced
    for (let i = 0; i < 10; i++) s.feed(62, (15 + i) / 60, 0.95);
    const notes = s.finish(25 / 60);
    expect(notes).toHaveLength(2);
  });

  it("clear() resets between takes", () => {
    const s = seg();
    for (let i = 0; i < 10; i++) s.feed(60, i / 60, 0.95);
    s.finish(10 / 60);
    s.clear();
    for (let i = 0; i < 10; i++) s.feed(64, i / 60, 0.95);
    const notes = s.finish(10 / 60);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(64);
  });
});
