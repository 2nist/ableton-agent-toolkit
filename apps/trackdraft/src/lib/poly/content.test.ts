import { describe, expect, it } from "vitest";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import {
  polyBass,
  polyChords,
  polyColor,
  drumCellCount,
  polyDrumPattern,
  polyDrums,
  polyLyrics,
} from "./content";
import { stepsBlockId } from "./drumSteps";

const song = { key: "C", scale: "ionian", bpm: 120 } as BlueprintSong;

function chord(
  id: string,
  root: string,
  quality: "maj" | "min" | "7",
  beats = 4,
) {
  return {
    id,
    romanNumeral: "",
    root,
    quality,
    beats,
  } as BlueprintSection["chords"][number];
}

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s1",
    name: "Verse 1",
    role: "verse",
    bars: 2,
    chords: [chord("c1", "C", "maj"), chord("c2", "G", "maj")],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

describe("polyChords", () => {
  it("derives numerals from the home key rather than trusting the stored label", () => {
    const cells = polyChords(section(), song, 8);
    expect(cells.map((cell) => cell.roman)).toEqual(["I", "V"]);
    expect(cells.map((cell) => cell.name)).toEqual(["C", "G"]);
  });

  it("loops the cell to fill the span and marks the seam", () => {
    // 2-bar cell, 4-bar span → I V I V, seam at the third cell.
    const cells = polyChords(section({ bars: 4 }), song, 16);
    expect(cells.map((cell) => cell.roman)).toEqual(["I", "V", "I", "V"]);
    expect(cells.map((cell) => cell.seam)).toEqual([false, false, true, false]);
  });

  it("shares sum to the whole span", () => {
    const cells = polyChords(section(), song, 8);
    expect(cells.reduce((sum, cell) => sum + cell.share, 0)).toBeCloseTo(1, 10);
  });

  it("collapses a very long span instead of drawing slivers", () => {
    const cells = polyChords(section({ bars: 32 }), song, 128, 6);
    expect(cells).toHaveLength(6);
    expect(cells[5].merged).toBe(true);
    expect(cells.reduce((sum, cell) => sum + cell.share, 0)).toBeCloseTo(1, 10);
  });

  it("returns nothing for an empty progression", () => {
    expect(polyChords(section({ chords: [] }), song, 8)).toEqual([]);
  });
});

describe("polyDrums", () => {
  it("returns a compact grid for a real preset", () => {
    const rows = polyDrums(section({ drumPattern: "standard" }), song);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells.length).toBeGreaterThan(0);
      expect(row.cells.length).toBeLessThanOrEqual(16);
      expect(row.cells.some(Boolean)).toBe(true);
      expect(row.count).toBeGreaterThan(0);
    }
  });

  it("returns nothing when the section has no playable groove", () => {
    expect(polyDrums(section({ drumPattern: "none" }), song)).toEqual([]);
  });

  it("draws one row per surface lane, not one per kit voice", () => {
    // Closed and open hats are two kit voices but one lane — two rows would
    // make the lane a mute field can name impossible to click.
    const rows = polyDrums(section({ drumPattern: "standard" }), song);
    const lanes = rows.map((row) => row.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
    for (const lane of lanes) {
      expect(["kick", "snare", "rim", "hat", "cym", "tom"]).toContain(lane);
    }
    expect(lanes).toContain("kick");
  });

  it("flags a muted lane but keeps its hits on screen", () => {
    const rows = polyDrums(
      section({ drumPattern: "standard", drumLaneMute: ["hat"] }),
      song,
    );
    const hat = rows.find((row) => row.lane === "hat");
    expect(hat?.muted).toBe(true);
    expect(hat?.silent).toBe(true);
    // Struck through on the canvas, so the toggle has to be reversible: the
    // cells are still there.
    expect(hat?.cells.some(Boolean)).toBe(true);
    expect(rows.find((row) => row.lane === "kick")?.silent).toBe(false);
  });

  it("silences every un-soloed lane without calling them muted", () => {
    const rows = polyDrums(
      section({ drumPattern: "standard", drumLaneSolo: ["kick"] }),
      song,
    );
    const kick = rows.find((row) => row.lane === "kick");
    expect(kick?.silent).toBe(false);
    expect(kick?.muted).toBe(false);
    for (const row of rows.filter((r) => r.lane !== "kick")) {
      expect(row.silent).toBe(true);
      expect(row.muted).toBe(false);
    }
  });
});

describe("polyDrumPattern — the grid a paint writes into", () => {
  const clocked = { timeDomain: { rate: 0.5 as const } };

  it("draws the pattern, so a click edits the cell it looks like", () => {
    // §P3.6: `polyDrums` shows where the hits SOUND. Under a clock that is not
    // where the cells are, so the lane paints against this instead — the two
    // agree exactly when there is no clock.
    const plain = polyDrumPattern(section({ drumPattern: "standard" }), song);
    expect(plain).toEqual(
      polyDrums(section({ drumPattern: "standard" }), song),
    );
  });

  it("does not move the cells when the section has a clock", () => {
    const rows = polyDrumPattern(
      section({ drumPattern: "standard", ...clocked }),
      song,
    );
    const unclocked = polyDrumPattern(
      section({ drumPattern: "standard" }),
      song,
    );
    expect(rows.map((row) => row.cells)).toEqual(
      unclocked.map((row) => row.cells),
    );
    // Nothing was mapped, so nothing can be off-grid or lost.
    for (const row of rows) {
      expect(row.offGrid).toBe(0);
      expect(row.dropped).toBe(0);
    }
  });

  it("while polyDrums still reports what the clock did", () => {
    const rows = polyDrums(
      section({ drumPattern: "standard", ...clocked }),
      song,
    );
    const plain = polyDrums(section({ drumPattern: "standard" }), song);
    // Half time halves the number of cells a hit can land in, so the drawing
    // changes even when the pattern does not.
    expect(rows).not.toEqual(plain);
  });
});

describe("polyBass", () => {
  it("places the generated line inside the column, on the twelve-step axis", () => {
    const notes = polyBass(section(), song);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.x).toBeGreaterThanOrEqual(0);
      expect(note.x).toBeLessThanOrEqual(1);
      expect(note.w).toBeGreaterThan(0);
      expect(note.step).toBeGreaterThanOrEqual(0);
      expect(note.step).toBeLessThan(12);
      expect(note.label.length).toBeGreaterThan(0);
    }
  });

  it("is empty without a progression to ride", () => {
    expect(polyBass(section({ chords: [] }), song)).toEqual([]);
  });
});

describe("polyColor", () => {
  it("marks one colour chord per chord", () => {
    const marks = polyColor(section(), song);
    expect(marks).toHaveLength(section().chords.length);
    for (const mark of marks) {
      expect(mark.label.length).toBeGreaterThan(0);
      expect(mark.w).toBeGreaterThan(0);
    }
  });

  it("is empty without a progression to sit above", () => {
    expect(polyColor(section({ chords: [] }), song)).toEqual([]);
  });
});

describe("polyLyrics", () => {
  it("keeps non-empty lines only", () => {
    expect(
      polyLyrics(section({ lyrics: "  when the night\n\n comes \r\n" })),
    ).toEqual(["when the night", "comes"]);
  });
});

describe("polyDrums + painted steps", () => {
  const drums = (overrides: Partial<BlueprintSection> = {}) =>
    section({ drumPattern: "standard", ...overrides });

  it("draws the authored blocks, so a painted step is a cell that changes", () => {
    const base = polyDrums(drums(), song);
    expect(base.length).toBeGreaterThan(0);

    // Silence the kick for the whole section: the row has nothing left to draw,
    // which is exactly what `applyDrumBlocks` does with an empty steps block.
    const cleared = polyDrums(
      drums({
        drumBlocks: [
          {
            id: "blk-kick-0-8-steps",
            lane: "kick",
            startBeat: 0,
            endBeat: 8,
            mode: "steps",
            notes: [],
          },
        ],
      }),
      song,
    );
    expect(cleared.find((row) => row.lane === "kick")).toBeUndefined();
  });

  it("clears exactly the cell the block covers and leaves the rest playing", () => {
    const baseKick = polyDrums(drums(), song).find(
      (row) => row.lane === "kick",
    )!;
    expect(baseKick.cells[0]).toBe(true);
    const before = baseKick.cells.filter(Boolean).length;

    // A block with no notes over the first half-beat silences only that slice —
    // `applyDrumBlocks` splices the lane inside the block's range and nothing
    // outside it, so one painted step is one changed cell.
    const cleared = polyDrums(
      drums({
        drumBlocks: [
          {
            id: "blk-kick-0-0.5-steps",
            lane: "kick",
            startBeat: 0,
            endBeat: 0.5,
            mode: "steps",
            notes: [],
          },
        ],
      }),
      song,
    ).find((row) => row.lane === "kick")!;

    expect(cleared.cells[0]).toBe(false);
    expect(cleared.cells.filter(Boolean).length).toBe(before - 1);
  });
});

describe("drum cells divide the bar (§S1.4)", () => {
  it("gives a 12-bar section a beat per cell", () => {
    // A Hard Day's Night's verse: 12 bars, 48 beats. The old cap of 32 produced
    // cells of 1.5 beats — no boundary on a bar line, and it read as "2.5 beats
    // per bar". Cells must be a fraction of the bar, not of the section.
    expect(drumCellCount(48, 12, 64)).toBe(48);
  });

  it("gives an 8-bar section eight cells per bar… which is 32 at a beat", () => {
    expect(drumCellCount(32, 8, 64)).toBe(32);
    expect(drumCellCount(8, 2, 64)).toBe(8);
  });

  it("drops to whole half-bars rather than fractions of one", () => {
    // 20 bars = 80 beats, over a 64 cell cap: 4/bar is 80 (too many), so it
    // halves the resolution to 2 per bar — 40 cells of two beats, every one of
    // them on a half-bar line.
    expect(drumCellCount(80, 20, 64)).toBe(40);
    expect(80 / drumCellCount(80, 20, 64)).toBe(2);
  });

  it("falls back to one cell per bar before it will break the bar", () => {
    // 100 bars: even one per bar is over the cap, so it caps and admits it.
    expect(drumCellCount(400, 100, 64)).toBe(64);
  });

  it("survives a section with no bars", () => {
    expect(drumCellCount(0, 0, 64)).toBe(1);
    expect(drumCellCount(8, 0, 64)).toBe(1);
  });
});

describe("drum gates — a hit that holds (§S1.8)", () => {
  const painted = (beats?: number) => ({
    drumPattern: "standard" as const,
    drumBlocks: [
      {
        id: stepsBlockId("kick", 0, 1),
        lane: "kick" as const,
        startBeat: 0,
        endBeat: 1,
        mode: "steps" as const,
        notes: [
          {
            beat: 0,
            voice: "kick" as const,
            velocity: 100,
            ...(beats !== undefined ? { durBeats: beats } : {}),
          },
        ],
      },
    ],
  });

  it("reports how long each hit holds, in beats", () => {
    // 2 bars / 8 beats at 4 cells per bar → 8 cells of one beat.
    const rows = polyDrumPattern(section(painted(3)), song);
    const kick = rows.find((row) => row.lane === "kick");
    expect(kick?.cells.length).toBe(8);
    expect(kick?.gates[0]).toBe(3);
  });

  it("carries a length only where the planner knows one", () => {
    // The base groove is generated from `[beat, pitch, velocity]` tuples — it
    // has no gates at all, so 0 is the truthful answer and the canvas draws
    // that hit as the one cell it fills. Inventing a length here would be the
    // canvas claiming to know something the export does not.
    const rows = polyDrumPattern(section({ drumPattern: "standard" }), song);
    const kick = rows.find((row) => row.lane === "kick");
    expect(kick?.cells.some(Boolean)).toBe(true);
    expect(kick?.gates.every((gate) => gate === 0)).toBe(true);
  });

  it("carries a painted hit's gate exactly", () => {
    const rows = polyDrumPattern(section(painted(1.5)), song);
    expect(rows.find((row) => row.lane === "kick")?.gates[0]).toBe(1.5);
  });

  it("marks only an authored step as draggable", () => {
    const rows = polyDrumPattern(section(painted(1)), song);
    const kick = rows.find((row) => row.lane === "kick");
    expect(kick?.authored[0]).not.toBeNull();
    expect(kick?.authored[1]).toBeNull();
    // The generated part of the SAME row is not draggable — re-gating one of
    // its hits would bake a block that replaces the groove under that window.
    const plain = polyDrumPattern(section({ drumPattern: "standard" }), song);
    expect(
      plain.every((row) => row.authored.every((step) => step === null)),
    ).toBe(true);
  });

  it("keeps gates and cells the same length, so a cell always has a length", () => {
    const rows = polyDrumPattern(section(painted(2)), song);
    for (const row of rows) {
      expect(row.gates).toHaveLength(row.cells.length);
      expect(row.authored).toHaveLength(row.cells.length);
    }
  });
});

describe("a ratcheted step keeps its gate (§S1.9)", () => {
  const rolled = (ratchet: number) => ({
    drumPattern: "standard" as const,
    drumBlocks: [
      {
        id: stepsBlockId("kick", 0, 1),
        lane: "kick" as const,
        startBeat: 0,
        endBeat: 1,
        mode: "steps" as const,
        notes: [
          {
            beat: 0,
            voice: "kick" as const,
            velocity: 100,
            durBeats: 3,
            ratchet,
          },
        ],
      },
    ],
  });

  it("draws the gate, not the sub-hit length", () => {
    // A ×2 roll over a 3-beat gate publishes two onsets of 1.5 beats each. The
    // bar has to stay 3 cells wide, or rolling a step would look like halving it.
    const rows = polyDrumPattern(section(rolled(2)), song);
    expect(rows.find((row) => row.lane === "kick")?.gates[0]).toBe(3);
  });

  it("reports the roll on the authored step", () => {
    const rows = polyDrumPattern(section(rolled(2)), song);
    expect(rows.find((row) => row.lane === "kick")?.authored[0]?.ratchet).toBe(
      2,
    );
  });
});
