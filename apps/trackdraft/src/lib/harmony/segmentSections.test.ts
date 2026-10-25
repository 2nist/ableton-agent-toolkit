import { describe, expect, it } from "vitest";
import type { Chord } from "../../types/blueprint";
import { chordToken, segmentChordStream } from "./segmentSections";

let counter = 0;
function chord(root: string, quality: Chord["quality"], beats: number): Chord {
  counter += 1;
  return { id: `c${counter}`, root, quality, beats, romanNumeral: "" };
}

/** Four one-bar chords, the shape a riff has. */
const riff = (beats = 4): Chord[] => [
  chord("D", "min", beats),
  chord("Bb", "maj", beats),
  chord("C", "maj", beats),
  chord("F", "maj", beats),
];

const total = (chords: Chord[]) => chords.reduce((sum, c) => sum + c.beats, 0);

describe("segmentChordStream", () => {
  it("returns nothing for an empty section", () => {
    expect(segmentChordStream([], { beatsPerBar: 4 })).toEqual({
      sections: [],
      totalBeats: 0,
      barsBefore: 0,
      barsAfter: 0,
    });
  });

  it("leaves a single unrepeated phrase as one section", () => {
    const chords = [chord("D", "min", 4), chord("C", "maj", 4), chord("Bb", "maj", 8)];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ startBeat: 0, endBeat: 16, repeats: 1, label: "A" });
  });

  it("collapses a riff played four times into ONE section with repeats", () => {
    const chords = [...riff(), ...riff(), ...riff(), ...riff()];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ startBeat: 0, endBeat: 16, repeats: 4, bars: 4 });
    expect(result.totalBeats).toBe(64);
  });

  it("keeps a unique intro separate from the loop that follows", () => {
    const chords = [chord("A", "min", 4), chord("E", "maj", 4), ...riff(), ...riff(), ...riff()];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections.map((s) => [s.startBeat, s.endBeat, s.repeats])).toEqual([
      [0, 8, 1],
      [8, 24, 3],
    ]);
    expect(result.sections[1].label).not.toBe(result.sections[0].label);
  });

  it("reads a tune that alternates two blocks as the two blocks", () => {
    const verse = riff();
    // Ends on A, not Dm: a section boundary where the same chord ends one
    // block and starts the next is genuinely ambiguous, and the cell fold
    // (correctly) ate it in an earlier draft of this test.
    const chorus = [chord("Bb", "maj", 4), chord("F", "maj", 4), chord("C", "maj", 4), chord("A", "maj", 4)];
    const chords = [...verse, ...verse, ...chorus, ...chorus, ...verse, ...verse];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    const shape = result.sections.map((s) => [s.startBeat, s.endBeat, s.repeats]);
    expect(shape).toEqual([
      [0, 16, 2],
      [32, 48, 2],
      [64, 80, 2],
    ]);
    // The returning verse is the same pattern, so it wears the same letter —
    // two sections called "A" are the same material, as a chart would note it.
    expect(result.sections[2].label).toBe(result.sections[0].label);
  });

  it("treats a held first chord as the same riff but not the same tile length", () => {
    // Layla: Dm(6) then the Dm-Bb-C cell repeating at 3 beats.
    const chords = [chord("D", "min", 6)];
    for (let pass = 0; pass < 4; pass++) {
      chords.push(chord("D", "min", 3), chord("Bb", "maj", 3), chord("C", "maj", 3));
    }
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    // The held Dm and the riff's first Dm are one cell, so the opening pass is
    // 15 beats (9+3+3) and the three after it are the plain 9-beat tile.
    expect(result.sections.map((s) => [s.startBeat, s.endBeat, s.repeats])).toEqual([
      [0, 15, 1],
      [15, 24, 3],
    ]);
    // Same pattern, so the second section wears the first one's letter.
    expect(result.sections[1].label).toBe(result.sections[0].label);
  });

  it("folds consecutive copies of a chord into one cell", () => {
    const chords = [
      chord("D", "min", 4), chord("D", "min", 4), chord("D", "min", 4), chord("D", "min", 4),
      chord("C", "maj", 4), chord("C", "maj", 4), chord("C", "maj", 4), chord("C", "maj", 4),
    ];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections).toHaveLength(1);
    // Two cells of 12 beats each — one bar apart is not a repetition, so this
    // stays a single phrase rather than a one-bar loop.
    expect(result.sections[0].repeats).toBe(1);
  });

  it("matches enharmonic spellings", () => {
    expect(chordToken({ root: "A#", quality: "maj" })).toBe(chordToken({ root: "Bb", quality: "maj" }));
    const chords = [
      chord("A#", "maj", 4), chord("F", "maj", 4),
      chord("Bb", "maj", 4), chord("F", "maj", 4),
    ];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].repeats).toBe(2);
  });

  it("cuts a long unrepeating stretch so it cannot become one giant block", () => {
    const chords = Array.from({ length: 24 }, (_, index) => chord(["C", "D", "E", "F", "G", "A", "B"][index % 7], index % 3 === 0 ? "min" : "maj", 4));
    const result = segmentChordStream(chords, { beatsPerBar: 4, maxRunBars: 8 });
    expect(result.sections.length).toBeGreaterThan(1);
    for (const section of result.sections) expect(section.bars).toBeLessThanOrEqual(8);
  });

  it("covers the source exactly, with repeats", () => {
    const chords = [...riff(), ...riff(), ...riff(), chord("G", "maj", 4), chord("A", "min", 12)];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    const covered = result.sections.reduce((sum, s) => sum + (s.endBeat - s.startBeat) * s.repeats, 0);
    expect(covered).toBe(total(chords));
    expect(result.sections[result.sections.length - 1].endBeat).toBe(total(chords));
  });

  it("never overlaps and never leaves a gap", () => {
    const chords = [...riff(), ...riff(), chord("G", "maj", 4), ...riff(), ...riff(), ...riff()];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    let cursor = 0;
    for (const section of result.sections) {
      expect(section.startBeat).toBe(cursor);
      cursor = section.startBeat + (section.endBeat - section.startBeat) * section.repeats;
    }
    expect(cursor).toBe(total(chords));
  });

  it("stitches same-material neighbours whose joined span still repeats", () => {
    // X plays with a longer last chord the second time, so `sameDurations`
    // refuses a `repeats` run and the two passes read as look-alike sections.
    // The stitched span comes back, so it is the real unit: one section.
    const x = () => [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4), chord("F", "maj", 4)];
    const xLong = () => [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4), chord("F", "maj", 8)];
    // The second pair holds the last chord longer still, so the two stitched
    // spans have the same chords but different timing: they are not a cycle,
    // which is what keeps this test about the stitch and not about repeats.
    const xLonger = () => [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4), chord("F", "maj", 12)];
    const y = () => [chord("G", "maj", 4), chord("A", "min", 4), chord("E", "maj", 4), chord("B", "min", 4)];
    const chords = [...x(), ...xLong(), ...y(), ...x(), ...xLonger(), ...y()];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    expect(result.sections.map((section) => section.label)).toEqual(["A", "B", "A", "B"]);
    expect(result.sections[0].pattern).toHaveLength(8);
    expect(result.sections[0].endBeat - result.sections[0].startBeat).toBe(36);
  });

  it("keeps same-material neighbours apart when the stitched span never recurs", () => {
    const x = () => [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4), chord("F", "maj", 4)];
    const xLong = () => [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4), chord("F", "maj", 8)];
    const tail = [chord("G", "maj", 4), chord("A", "min", 4), chord("E", "maj", 4), chord("B", "min", 4)];
    const result = segmentChordStream([...x(), ...xLong(), ...tail], { beatsPerBar: 4 });
    expect(result.sections.map((section) => section.pattern.length)).toEqual([4, 4, 4]);
    expect(result.sections.slice(0, 2).map((section) => section.label)).toEqual(["A", "A"]);
  });

  it("reads a strict cycle as one section with repeats instead of its halves", () => {
    // A twelve-chord vamp and a fourteen-chord answer: 26 cells, past
    // `MAX_TILE_CELLS`, so the block finder only ever proposes the halves.
    const x = riff();
    const y = ["G", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "C", "D", "E", "F", "G"].map((root) =>
      chord(root, "maj", 4),
    );
    const cycle = [...x, ...y];
    const result = segmentChordStream([...cycle, ...cycle, ...cycle], { beatsPerBar: 4 });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].repeats).toBe(3);
    expect(result.sections[0].pattern).toHaveLength(18);
    expect(result.sections[0].bars).toBe(18);
    const covered = result.sections.reduce((sum, section) => sum + (section.endBeat - section.startBeat) * section.repeats, 0);
    expect(covered).toBe(result.totalBeats);
  });

  it("refuses a cycle whose last pass is truncated", () => {
    const x = riff();
    const y = ["G", "A", "E", "B", "F#", "C#", "G#", "D#"].map((root) => chord(root, "maj", 4));
    const cycle = [...x, ...y];
    const result = segmentChordStream([...cycle, ...cycle, ...x, ...y.slice(0, 4)], { beatsPerBar: 4 });
    // Two honest copies are a cycle; the short third pass is its own section.
    expect(result.sections[0].repeats).toBe(2);
    expect(result.sections.length).toBeGreaterThan(1);
    const covered = result.sections.reduce((sum, section) => sum + (section.endBeat - section.startBeat) * section.repeats, 0);
    expect(covered).toBe(result.totalBeats);
  });

  it("prefers the block that repeats most over the longer block containing it", () => {
    // Layla's shape: a three-chord riff nine times, with a bridge that only
    // turns up three times — always preceded by a riff pass. The long
    // "riff + bridge" block is longer, but the riff is the vocabulary.
    const riff = [chord("D", "min", 4), chord("Bb", "maj", 4), chord("C", "maj", 4)];
    const bridge = ["C#", "Ab", "C#", "C", "D", "E", "F#", "B"].map((root, index) =>
      chord(root, index === 2 ? "min7" : "min", 4),
    );
    const chords = [...riff, ...riff, ...riff, ...bridge, ...riff, ...riff, ...bridge, ...riff, ...riff, ...riff, ...bridge];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    const labels = result.sections.map((s) => s.label);
    expect(result.sections.map((s) => s.repeats)).toEqual([3, 1, 2, 1, 3, 1]);
    // Two patterns, each recurring: the riff is A wherever it turns up and
    // the bridge is B, so the form reads as a lead sheet would write it.
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toBe("A");
    expect(labels[2]).toBe("A");
    expect(labels[4]).toBe("A");
    expect(labels[1]).toBe("B");
    expect(labels[3]).toBe("B");
    expect(labels[5]).toBe("B");
    const covered = result.sections.reduce((sum, s) => sum + (s.endBeat - s.startBeat) * s.repeats, 0);
    expect(covered).toBe(total(chords));
  });

  it("measures bars from the meter it is given", () => {
    const chords = [...riff(7), ...riff(7)];
    const result = segmentChordStream(chords, { beatsPerBar: 7 });
    expect(result.sections[0].bars).toBe(4);
    expect(result.barsBefore).toBe(8);
  });

  it("folds a sub-bar sliver into the section before it", () => {
    const chords = [...riff(), ...riff(), chord("G", "maj", 2)];
    const result = segmentChordStream(chords, { beatsPerBar: 4 });
    const covered = result.sections.reduce((sum, s) => sum + (s.endBeat - s.startBeat) * s.repeats, 0);
    expect(covered).toBe(total(chords));
    expect(result.sections[result.sections.length - 1].endBeat).toBe(total(chords));
  });
});
