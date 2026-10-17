import { describe, it, expect } from "vitest";
import {
  DEFAULT_NOTE_VELOCITY,
  MAX_VELOCITY,
  MIN_NOTE_DURATION,
  addNote,
  editedMelodyTrack,
  gridStep,
  moveNote,
  nearestNoteIndex,
  removeNote,
  resizeNote,
  setVelocity,
  snapBeat,
} from "./noteEdits";
import type { MelodyNote } from "../../types/blueprint";

const note = (pitch: number, startTime: number, duration = 1): MelodyNote => ({
  pitch,
  startTime,
  duration,
  velocity: 96,
});

describe("snapBeat", () => {
  it("rounds to the nearest grid line", () => {
    expect(snapBeat(0.6, "1/8")).toBe(0.5);
    expect(snapBeat(1.3, "1/8")).toBe(1.5);
    expect(snapBeat(1.9, "1/4")).toBe(2);
    expect(snapBeat(0.4, "1/16")).toBe(0.5);
  });

  it("keeps triplet fractions readable", () => {
    expect(snapBeat(0.35, "1/8T")).toBe(0.3333);
    expect(snapBeat(0.7, "1/8T")).toBe(0.6667);
  });

  it("passes timing through when snapping is off", () => {
    expect(snapBeat(0.123456, "none")).toBe(0.1235);
  });

  it("reports the grid step in beats", () => {
    expect(gridStep("1/8")).toBe(0.5);
    expect(gridStep("1/4")).toBe(1);
    expect(gridStep("none")).toBe(0);
  });
});

describe("addNote", () => {
  it("appends a snapped note selected by index", () => {
    const notes = addNote([], { pitch: 64, startTime: 0.6, grid: "1/8", sectionBeats: 8 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({ pitch: 64, startTime: 0.5, duration: 0.5, velocity: DEFAULT_NOTE_VELOCITY });
  });

  it("uses a half-beat default when the grid is off", () => {
    const notes = addNote([], { pitch: 60, startTime: 1.2, grid: "none", sectionBeats: 8 });
    expect(notes[0].startTime).toBe(1.2);
    expect(notes[0].duration).toBe(0.5);
  });

  it("keeps the new note inside the section window", () => {
    const notes = addNote([], { pitch: 60, startTime: 7.9, grid: "1/4", sectionBeats: 8 });
    expect(notes[0].startTime).toBe(7);
    expect(notes[0].duration).toBe(1);
  });

  it("never adds the note before the section start", () => {
    const notes = addNote([], { pitch: 60, startTime: -2, grid: "1/8", sectionBeats: 8 });
    expect(notes[0].startTime).toBe(0);
  });
});

describe("moveNote", () => {
  it("snaps the new onset and keeps the length", () => {
    const notes = [note(60, 0, 2), note(62, 4, 1)];
    const moved = moveNote(notes, 0, { startTime: 1.4, pitch: 67, grid: "1/8", sectionBeats: 8 });
    expect(moved[0]).toMatchObject({ startTime: 1.5, duration: 2, pitch: 67 });
    expect(moved[1]).toBe(notes[1]);
  });

  it("clamps pitch into the MIDI range", () => {
    const notes = [note(60, 1)];
    expect(moveNote(notes, 0, { startTime: 1, pitch: 140, grid: "1/8", sectionBeats: 8 })[0].pitch).toBe(127);
    expect(moveNote(notes, 0, { startTime: 1, pitch: -4, grid: "1/8", sectionBeats: 8 })[0].pitch).toBe(0);
  });

  it("stops at the section end instead of spilling past it", () => {
    const notes = [note(60, 0, 2)];
    const moved = moveNote(notes, 0, { startTime: 9, pitch: 60, grid: "1/8", sectionBeats: 8 });
    expect(moved[0].startTime).toBe(6);
    expect(moved[0].duration).toBe(2);
  });

  it("ignores an out-of-range index", () => {
    const notes = [note(60, 0)];
    expect(moveNote(notes, 5, { startTime: 1, pitch: 60, grid: "1/8", sectionBeats: 8 })).toBe(notes);
  });
});

describe("resizeNote", () => {
  it("drags the end edge and keeps the onset", () => {
    const notes = [note(60, 1, 1)];
    const resized = resizeNote(notes, 0, { edge: "end", time: 3.2, grid: "1/8", sectionBeats: 8 });
    expect(resized[0]).toMatchObject({ startTime: 1, duration: 2 });
  });

  it("never shrinks below one grid cell", () => {
    const notes = [note(60, 2, 1)];
    const resized = resizeNote(notes, 0, { edge: "end", time: 0.5, grid: "1/8", sectionBeats: 8 });
    expect(resized[0].duration).toBe(0.5);
  });

  it("never grows past the section end", () => {
    const notes = [note(60, 7, 1)];
    const resized = resizeNote(notes, 0, { edge: "end", time: 12, grid: "1/8", sectionBeats: 8 });
    expect(resized[0].startTime).toBe(7);
    expect(resized[0].duration).toBe(1);
  });

  it("drags the start edge and keeps the end fixed", () => {
    const notes = [note(60, 2, 2)];
    const resized = resizeNote(notes, 0, { edge: "start", time: 3.1, grid: "1/8", sectionBeats: 8 });
    expect(resized[0]).toMatchObject({ startTime: 3, duration: 1 });
  });

  it("won't drag the start past the end", () => {
    const notes = [note(60, 2, 1)];
    const resized = resizeNote(notes, 0, { edge: "start", time: 9, grid: "1/8", sectionBeats: 8 });
    expect(resized[0]).toMatchObject({ startTime: 2.5, duration: 0.5 });
  });

  it("falls back to a 1/16 floor when snapping is off", () => {
    const notes = [note(60, 2, 1)];
    const resized = resizeNote(notes, 0, { edge: "end", time: 2, grid: "none", sectionBeats: 8 });
    expect(resized[0].duration).toBe(MIN_NOTE_DURATION);
  });
});

describe("velocity and removal", () => {
  it("clamps velocity to 1..127", () => {
    const notes = [note(60, 0), note(62, 1)];
    expect(setVelocity(notes, 0, 400)[0].velocity).toBe(MAX_VELOCITY);
    expect(setVelocity(notes, 0, 0)[0].velocity).toBe(1);
    expect(setVelocity(notes, 1, 64.4)[1].velocity).toBe(64);
  });

  it("removes by index", () => {
    const notes = [note(60, 0), note(62, 1), note(64, 2)];
    expect(removeNote(notes, 1).map((n) => n.pitch)).toEqual([60, 64]);
    expect(removeNote(notes, 9)).toBe(notes);
  });

  it("finds the note nearest a beat for the velocity lane", () => {
    const notes = [note(60, 0), note(62, 2), note(64, 4)];
    expect(nearestNoteIndex(notes, 1.9)).toBe(1);
    expect(nearestNoteIndex(notes, 3.4)).toBe(2);
    expect(nearestNoteIndex([], 1)).toBe(-1);
  });
});

describe("editedMelodyTrack", () => {
  it("marks a hand-edited line as edited and freezes the contour", () => {
    const track = editedMelodyTrack(undefined, [note(64, 0)]);
    expect(track.source).toBe("edited");
    expect(track.contourApplied).toBe(true);
    expect(track.notes).toHaveLength(1);
  });

  it("keeps the generation provenance of the base line", () => {
    const track = editedMelodyTrack(
      {
        notes: [note(60, 0)],
        source: "generated",
        seed: 1234,
        contourApplied: true,
        params: { contour: 0.5, density: 0.7, register: 0.5, rhythm: 0.5, repetition: 0.5, rest: 0.5 },
      },
      [note(62, 1)],
    );
    expect(track.seed).toBe(1234);
    expect(track.params?.density).toBe(0.7);
    expect(track.source).toBe("edited");
    expect(track.notes[0].pitch).toBe(62);
  });
});
