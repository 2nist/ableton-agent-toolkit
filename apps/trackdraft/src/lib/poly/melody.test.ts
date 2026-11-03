import { describe, expect, it } from "vitest";
import type { BlueprintSection } from "../../types/blueprint";
import {
  beatGrid,
  insertNote,
  moveNote,
  noteAtPoint,
  pitchForY,
  polyNoteFrame,
  quantise,
  removeNote,
  sortNotes,
  withNotes,
} from "./melody";

function section(
  notes: Array<{ pitch: number; startTime: number; duration: number }> = [],
): BlueprintSection {
  return {
    id: "s1",
    name: "Verse 1",
    role: "verse",
    bars: 2,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    melody: { notes },
  } as BlueprintSection;
}

describe("polyNoteFrame — a clocked section (§P3.7)", () => {
  it("draws the written line and ghosts where the clock puts it", () => {
    const clocked = { ...section([{ pitch: 60, startTime: 2, duration: 2 }]) };
    clocked.timeDomain = { rate: 0.5 };
    const frame = polyNoteFrame(clocked);
    // The bar is where it is stored: that is what a drag reads and writes.
    expect(frame.notes[0].startTime).toBe(2);
    expect(frame.notes[0].x).toBeCloseTo(0.25, 6);
    // The ghost is where it sounds: twice as far in, twice as long.
    expect(frame.ghost).toHaveLength(1);
    expect(frame.ghost![0].x).toBeCloseTo(0.5, 6);
    expect(frame.ghost![0].w).toBeCloseTo(0.5, 6);
  });

  it("has no ghost when the section runs with the song", () => {
    const frame = polyNoteFrame(
      section([{ pitch: 60, startTime: 2, duration: 2 }]),
    );
    expect(frame.ghost).toBeUndefined();
  });

  it("shows a note the loop dropped as unheard, not as moved", () => {
    const looped = {
      ...section([
        { pitch: 60, startTime: 0, duration: 1 },
        { pitch: 64, startTime: 6, duration: 1 },
      ]),
    };
    looped.timeDomain = { rate: 1, cycle: 4 };
    const frame = polyNoteFrame(looped);
    // Both bars stay where they were written...
    expect(frame.notes.map((note) => note.startTime)).toEqual([0, 6]);
    // ...and only the one inside the loop sounds, twice across eight beats.
    expect(frame.ghost).toHaveLength(2);
    expect(new Set(frame.ghost!.map((mark) => mark.pitch))).toEqual(
      new Set([60]),
    );
  });
});

describe("polyNoteFrame", () => {
  it("lays a note out where it sounds", () => {
    const frame = polyNoteFrame(
      section([{ pitch: 60, startTime: 2, duration: 2 }]),
    );
    expect(frame.beats).toBe(8);
    expect(frame.notes[0].x).toBeCloseTo(0.25, 6);
    expect(frame.notes[0].w).toBeCloseTo(0.25, 6);
  });

  it("pads a narrow phrase so its heights are distinguishable", () => {
    const frame = polyNoteFrame(
      section([
        { pitch: 60, startTime: 0, duration: 1 },
        { pitch: 62, startTime: 1, duration: 1 },
      ]),
    );
    expect(frame.high - frame.low).toBeGreaterThanOrEqual(7);
    expect(frame.notes[0].y).toBeGreaterThan(frame.notes[1].y);
  });

  it("widens a sliver of a note so it is still clickable", () => {
    const frame = polyNoteFrame(
      section([{ pitch: 60, startTime: 0, duration: 0.02 }]),
    );
    expect(frame.notes[0].w).toBeGreaterThan(0.02 / frame.beats);
    expect(frame.notes[0].w).toBeCloseTo(frame.beats / 64 / frame.beats, 6);
  });

  it("is empty for a section with no melody", () => {
    expect(polyNoteFrame(section([])).notes).toEqual([]);
  });
});

describe("point <-> pitch", () => {
  const frame = polyNoteFrame(
    section([
      { pitch: 60, startTime: 0, duration: 1 },
      { pitch: 72, startTime: 1, duration: 1 },
    ]),
  );

  it("round-trips a pitch through the lane's height", () => {
    for (const pitch of [58, 60, 66, 72, 74]) {
      const y = (frame.high - pitch) / (frame.high - frame.low);
      expect(pitchForY(frame, y)).toBe(pitch);
    }
  });

  it("clamps out-of-range heights into MIDI", () => {
    expect(pitchForY(frame, -3)).toBeLessThanOrEqual(127);
    expect(pitchForY(frame, 3)).toBeGreaterThanOrEqual(0);
  });

  it("finds the note under a point", () => {
    const first = frame.notes[0];
    expect(noteAtPoint(frame, first.x + 0.01, first.y)?.index).toBe(0);
    expect(noteAtPoint(frame, 0.9, 0.5)).toBeNull();
  });
});

describe("moveNote", () => {
  const frame = polyNoteFrame(
    section([
      { pitch: 60, startTime: 0, duration: 1 },
      { pitch: 64, startTime: 4, duration: 1 },
    ]),
  );
  const notes = section([
    { pitch: 60, startTime: 0, duration: 1 },
    { pitch: 64, startTime: 4, duration: 1 },
  ]).melody!.notes;

  it("transposes without touching the onset", () => {
    const next = moveNote(notes, 0, frame, { semitones: 3 });
    expect(next[0].pitch).toBe(63);
    expect(next[0].startTime).toBe(0);
    expect(next[1]).toEqual(notes[1]);
  });

  it("shifts the onset without touching the pitch", () => {
    const next = moveNote(notes, 1, frame, { beats: -2 });
    expect(next.find((note) => note.pitch === 64)?.startTime).toBe(2);
  });

  it("will not push a note out of the section", () => {
    const next = moveNote(notes, 1, frame, { beats: 99 });
    expect(Math.max(...next.map((note) => note.startTime))).toBe(
      frame.beats - 1,
    );
  });

  it("keeps the array in onset order when a note is dragged past a neighbour", () => {
    const next = moveNote(notes, 0, frame, { beats: 6 });
    expect(next.map((note) => note.startTime)).toEqual([4, 6]);
  });

  it("returns the phrase untouched when nothing changed", () => {
    expect(moveNote(notes, 0, frame, {})).toEqual(notes);
  });
});

describe("insert / remove", () => {
  const frame = polyNoteFrame(
    section([{ pitch: 60, startTime: 0, duration: 1 }]),
  );

  it("adds a note at the clicked point on the grid", () => {
    const next = insertNote(
      frame.notes.length ? [{ pitch: 60, startTime: 0, duration: 1 }] : [],
      frame,
      { x: 0.5, y: 0.5 },
      0.5,
    );
    expect(next).toHaveLength(2);
    expect(next[1].startTime % 0.5).toBe(0);
  });

  it("removes the note it is given", () => {
    const notes = [
      { pitch: 60, startTime: 0, duration: 1 },
      { pitch: 62, startTime: 2, duration: 1 },
    ];
    expect(removeNote(notes, 0)).toEqual([notes[1]]);
  });

  it("sorts by onset then pitch", () => {
    const sorted = sortNotes([
      { pitch: 64, startTime: 2, duration: 1 },
      { pitch: 62, startTime: 2, duration: 1 },
      { pitch: 60, startTime: 0, duration: 1 },
    ]);
    expect(sorted.map((note) => `${note.startTime}:${note.pitch}`)).toEqual([
      "0:60",
      "2:62",
      "2:64",
    ]);
  });

  it("writes notes back into the section without disturbing anything else", () => {
    const base = section([{ pitch: 60, startTime: 0, duration: 1 }]);
    const next = withNotes(base, [{ pitch: 67, startTime: 1, duration: 2 }]);
    expect(next.melody?.notes[0].pitch).toBe(67);
    expect(next.chords).toBe(base.chords);
  });
});

describe("grid", () => {
  it("is sixteenths in a 4/4 bar", () => {
    expect(beatGrid(4)).toBe(0.25);
    expect(quantise(1.37, 0.25)).toBe(1.25);
  });

  it("falls back to quarters for a tiny bar", () => {
    expect(beatGrid(1)).toBe(0.25);
    expect(beatGrid(0)).toBe(0.25);
  });
});
