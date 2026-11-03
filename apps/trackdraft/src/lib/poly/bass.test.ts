import { describe, expect, it } from "vitest";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import {
  BASS_MIN_RANGE,
  bassFrameFor,
  bassNotesFor,
  clearBassNotes,
  withBassNotes,
} from "./bass";
import { CLOCK_LADDER } from "./drums";
import { sectionBassLine } from "../harmony/voiceLayers";

const song = {
  id: "song",
  key: "C",
  scale: "ionian",
  bpm: 120,
} as BlueprintSong;

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 2,
    chords: [
      { id: "c1", romanNumeral: "", root: "C", quality: "maj", beats: 4 },
      { id: "c2", romanNumeral: "", root: "G", quality: "maj", beats: 4 },
    ],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  } as BlueprintSection;
}

describe("bassNotesFor", () => {
  it("returns the generated profile line when nothing is authored", () => {
    const { notes, authored } = bassNotesFor(section(), song);
    expect(authored).toBe(false);
    // Default profile: one sustained root per chord, octave 3.
    expect(notes).toHaveLength(2);
    expect(notes[0].pitch).toBe(36);
    expect(notes[0].duration).toBe(4);
  });

  it("follows the section's profile", () => {
    const { notes } = bassNotesFor(
      section({ bassProfile: { rhythm: "eighth" } }),
      song,
    );
    expect(notes).toHaveLength(8);
  });

  it("prefers the authored notes, note for note", () => {
    const authored = [
      { pitch: 38, startTime: 0, duration: 3 },
      { pitch: 43, startTime: 3, duration: 1 },
    ];
    const line = bassNotesFor(section({ bassNotes: authored }), song);
    expect(line.authored).toBe(true);
    expect(line.notes.map((note) => note.pitch)).toEqual([38, 43]);
  });
});

describe("bassFrameFor", () => {
  it("draws the line over at least an octave, whatever the phrase spans", () => {
    const frame = bassFrameFor(section(), song);
    expect(frame.high - frame.low).toBeGreaterThanOrEqual(BASS_MIN_RANGE);
    expect(frame.notes).toHaveLength(2);
    expect(frame.beats).toBe(8);
  });

  it("puts the notes where they sound", () => {
    const frame = bassFrameFor(
      section({
        bassNotes: [
          { pitch: 36, startTime: 0, duration: 4 },
          { pitch: 43, startTime: 4, duration: 4 },
        ],
      }),
      song,
    );
    expect(frame.notes[0].x).toBe(0);
    expect(frame.notes[1].x).toBe(0.5);
    // A higher pitch sits higher up the lane.
    expect(frame.notes[1].y).toBeLessThan(frame.notes[0].y);
  });

  it("survives a section with no chords", () => {
    const frame = bassFrameFor(section({ chords: [] }), song);
    expect(frame.notes).toEqual([]);
    expect(frame.beats).toBe(8);
  });
});

describe("withBassNotes", () => {
  it("writes the notes onto the section", () => {
    const next = withBassNotes(section(), [
      { pitch: 36, startTime: 0, duration: 2 },
    ]);
    expect(next.bassNotes).toHaveLength(1);
  });

  it("stores nothing at all when the line is emptied", () => {
    const written = withBassNotes(section(), [
      { pitch: 36, startTime: 0, duration: 2 },
    ]);
    const cleared = withBassNotes(written, []);
    expect("bassNotes" in cleared).toBe(false);
  });

  it("hands the section back to the generator", () => {
    const written = withBassNotes(section(), [
      { pitch: 36, startTime: 0, duration: 2 },
    ]);
    const cleared = clearBassNotes(written);
    expect(cleared.bassNotes).toBeUndefined();
    expect(bassNotesFor(cleared, song).authored).toBe(false);
  });
});

describe("the bass the section SOUNDS moves with the harmony (§P3.6)", () => {
  // §P3.5 stopped the bass taking a clock, because the chords never moved and a
  // half-time line sounded the wrong root. §P3.6 conducts the harmony instead,
  // so the stronger statement is now true: the note stays the root of whatever
  // is actually sounding, at every rate, because both moved.
  const rungs = CLOCK_LADDER.filter((rung) => rung !== null);
  /** The line as it plays: the conducted resolve the export and Live use. */
  const sounded = (overrides: Partial<BlueprintSection> = {}) =>
    sectionBassLine(section(overrides), "C", song);

  /** The root the section's chord has at a beat, once the clock has moved it.
   *  The fixture is C for beats 0–3 and G for 4–7 in song time, and the
   *  progression loops when conduction makes it shorter than the section. */
  function rootAt(beat: number, rate: number): number {
    const chordSpan = 4 / rate;
    return Math.floor(beat / chordSpan + 1e-9) % 2 === 0 ? 0 : 7;
  }

  it("sounds the root of the chord that is playing, at every rate", () => {
    for (const rung of rungs) {
      const rate = rung?.rate ?? 1;
      const notes = sounded({ timeDomain: rung });
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) {
        expect(note.pitch % 12).toBe(rootAt(note.startTime, rate));
      }
    }
  });

  it("stretches each chord instead of thinning the line", () => {
    const plain = sounded();
    const half = sounded({ timeDomain: { rate: 0.5 } });
    // Two four-beat chords at half speed need sixteen beats, and the section is
    // eight — so only the first fits, and it lasts the whole section. That is
    // what "half time" means: the progression takes twice as long to come round.
    expect(half.map((note) => note.startTime)).toEqual([0]);
    expect(half[0].duration).toBe(8);
    expect(plain[0].duration).toBe(4);
  });

  it("brings the progression round twice as often at double time", () => {
    const fast = sounded({ timeDomain: { rate: 2 } });
    // Two chords over eight beats, twice as fast: four of them over the same
    // span, on the same roots, in order.
    expect(fast.map((note) => [note.startTime, note.pitch % 12])).toEqual([
      [0, 0],
      [2, 7],
      [4, 0],
      [6, 7],
    ]);
  });

  it("moves an authored line by the same factor as the chords", () => {
    const authored = [{ pitch: 38, startTime: 2, duration: 1 }];
    const slow = sounded({
      bassNotes: authored,
      timeDomain: { rate: 0.5 },
    });
    expect(slow[0].startTime).toBe(4);
    expect(slow[0].duration).toBe(2);
  });

  it("repeats the line with the harmony when the section is folded", () => {
    const looped = sounded({ timeDomain: { rate: 1, cycle: 4 } });
    // Only the first chord survives the fold, and it tiles across the section.
    expect(looped.map((note) => note.startTime)).toEqual([0, 4]);
    expect(new Set(looped.map((note) => note.pitch))).toEqual(new Set([36]));
  });
});

describe("the bass lane edits the line it draws (§P3.7)", () => {
  // A conducted line is a READING of the stored one. Drawing the reading made
  // every drag write song beats into a local field, and made an authored line
  // rewrite itself through conduction on the first edit. So the lane draws what
  // it writes, and ghosts where the clock puts it.
  const slow = () => section({ timeDomain: { rate: 0.5 } });

  it("shows the stored line, not the conducted one", () => {
    expect(bassNotesFor(slow(), song).notes).toEqual(
      bassNotesFor(section(), song).notes,
    );
  });

  it("ghosts where the clock actually puts it", () => {
    const frame = bassFrameFor(slow(), song);
    // Two four-beat chords need sixteen beats at half speed and the section is
    // eight, so one chord sounds — one ghost, at the top.
    expect(frame.ghost?.map((mark) => mark.x)).toEqual([0]);
    // The bars themselves did not move.
    expect(frame.notes.map((note) => note.startTime)).toEqual([0, 4]);
  });

  it("has no ghost without a clock", () => {
    expect(bassFrameFor(section(), song).ghost).toBeUndefined();
  });

  it("round-trips an edit without corrupting the stored line", () => {
    const authored = [{ pitch: 38, startTime: 2, duration: 1 }];
    const clocked = section({ bassNotes: authored, timeDomain: { rate: 0.5 } });
    const drawn = bassNotesFor(clocked, song).notes;
    // Timing and pitch survive untouched; the only addition is the profile's
    // velocity on a note that never named one, which sounds identical.
    const timing = (
      notes: readonly { pitch: number; startTime: number; duration: number }[],
    ) =>
      notes.map(({ pitch, startTime, duration }) => ({
        pitch,
        startTime,
        duration,
      }));
    expect(timing(withBassNotes(clocked, drawn).bassNotes ?? [])).toEqual(
      timing(clocked.bassNotes ?? []),
    );
  });
});
