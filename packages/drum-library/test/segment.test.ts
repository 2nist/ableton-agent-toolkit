import { describe, expect, it } from "vitest";
import { notesForLimb, resolveSegment, segmentTake } from "../src/segment.js";
import { validateTake } from "../src/take.js";
import type { DrumNote, Take } from "../src/types.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;
const PEDAL_HAT = 44;
const TOM = 45;

function take(notes: DrumNote[], overrides: Partial<Take> = {}): Take {
  return {
    id: "drummer1/session1/test.midi",
    drummer: "drummer1",
    session: "drummer1/session1",
    style: "rock",
    bpm: 120,
    beatType: "beat",
    timeSignature: { numerator: 4, denominator: 4 },
    kitName: "Acoustic Kit",
    beatsPerBar: 4,
    notes,
    ...overrides,
  };
}

/** Four bars of a plain backbeat with eighth-note hats. */
function fourBarGroove(): DrumNote[] {
  const notes: DrumNote[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const base = bar * 4;
    notes.push({ beat: base, pitch: KICK, velocity: 100 });
    notes.push({ beat: base + 1, pitch: SNARE, velocity: 96 });
    notes.push({ beat: base + 2, pitch: KICK, velocity: 100 });
    notes.push({ beat: base + 3, pitch: SNARE, velocity: 96 });
    for (let eighth = 0; eighth < 8; eighth++) {
      notes.push({ beat: base + eighth * 0.5, pitch: HAT, velocity: 70 });
    }
  }
  return notes.sort((a, b) => a.beat - b.beat);
}

describe("notesForLimb", () => {
  it("routes the pedal hi-hat to the feet, not the cymbal hand", () => {
    // The left foot plays it. Grouping it with the cymbals would let a
    // recombination lift it away from the kick and produce something no
    // drummer could physically play.
    const t = take([{ beat: 0, pitch: PEDAL_HAT, velocity: 60 }]);
    expect(notesForLimb(t, "feet")).toHaveLength(1);
    expect(notesForLimb(t, "cymbals")).toHaveLength(0);
  });

  it("separates the kit into independent limbs", () => {
    const t = take(fourBarGroove());
    expect(notesForLimb(t, "feet").every((n) => n.pitch === KICK)).toBe(true);
    expect(notesForLimb(t, "snare").every((n) => n.pitch === SNARE)).toBe(true);
    expect(notesForLimb(t, "cymbals").every((n) => n.pitch === HAT)).toBe(true);
    expect(notesForLimb(t, "toms")).toHaveLength(0);
  });
});

describe("segmentTake", () => {
  it("windows a beat at several lengths, per limb", () => {
    const segments = segmentTake(take(fourBarGroove()), { lengthsInBars: [1, 2], hopInBars: 1 });
    const oneBarFeet = segments.filter((s) => s.limb === "feet" && s.lengthBars === 1);
    const twoBarFeet = segments.filter((s) => s.limb === "feet" && s.lengthBars === 2);
    // 4 bars of material yields 4 one-bar and 3 two-bar windows at a 1-bar hop.
    expect(oneBarFeet).toHaveLength(4);
    expect(twoBarFeet).toHaveLength(3);
  });

  it("takes a fill whole instead of padding it to a fixed length", () => {
    // Fills run a median of 3.5 beats across the corpus; forcing them into
    // 4-bar windows would surround a transition figure with silence.
    const fill = take(
      [
        { beat: 0, pitch: TOM, velocity: 90 },
        { beat: 0.5, pitch: TOM, velocity: 95 },
        { beat: 1, pitch: SNARE, velocity: 100 },
        { beat: 1.5, pitch: SNARE, velocity: 105 },
      ],
      { beatType: "fill" },
    );
    const segments = segmentTake(fill);
    expect(segments.every((s) => s.startBar === 0)).toBe(true);
    expect(segments.every((s) => s.lengthBars === 1)).toBe(true);
  });

  it("uses the take's own bar length for odd meters", () => {
    // 6/8 is 3 quarter notes per bar. Two bars of material is 6 beats; if the
    // segmenter assumed 4 beats/bar it would find only one bar and emit fewer
    // windows.
    const notes: DrumNote[] = [];
    for (let bar = 0; bar < 4; bar++) {
      notes.push({ beat: bar * 3, pitch: KICK, velocity: 100 });
      notes.push({ beat: bar * 3 + 1.5, pitch: SNARE, velocity: 90 });
      notes.push({ beat: bar * 3 + 2, pitch: KICK, velocity: 95 });
    }
    const sixEight = take(notes, {
      timeSignature: { numerator: 6, denominator: 8 },
      beatsPerBar: 3,
    });
    const oneBar = segmentTake(sixEight, { lengthsInBars: [1], hopInBars: 1, minNotes: 1 }).filter(
      (s) => s.limb === "feet",
    );
    expect(oneBar).toHaveLength(4);
  });

  it("drops segments too sparse to have a measurable feel", () => {
    const sparse = take([
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 12, pitch: KICK, velocity: 100 },
    ]);
    expect(segmentTake(sparse, { lengthsInBars: [1], minNotes: 3 })).toHaveLength(0);
  });

  it("rebases each window so segments are comparable regardless of origin", () => {
    const segments = segmentTake(take(fourBarGroove()), { lengthsInBars: [1], hopInBars: 1 });
    const feet = segments.filter((s) => s.limb === "feet");
    // Every bar of this groove is identical, so windows taken from different
    // points in the take must produce the same rhythm identity.
    expect(new Set(feet.map((s) => s.rhythmKey)).size).toBe(1);
  });
});

describe("resolveSegment", () => {
  it("returns the notes a segment refers to, rebased to its own start", () => {
    const t = take(fourBarGroove());
    const notes = resolveSegment(t, { takeId: t.id, startBar: 2, lengthBars: 1 }, "feet");
    expect(notes).toHaveLength(2);
    expect(notes[0].beat).toBe(0);
    expect(notes[1].beat).toBe(2);
  });

  it("does not double-count a note sitting exactly on a bar line", () => {
    const t = take([
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 4, pitch: KICK, velocity: 100 },
    ]);
    const first = resolveSegment(t, { takeId: t.id, startBar: 0, lengthBars: 1 }, "feet");
    const second = resolveSegment(t, { takeId: t.id, startBar: 1, lengthBars: 1 }, "feet");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("round-trips: a resolved segment matches what segmentTake measured", () => {
    const t = take(fourBarGroove());
    const segment = segmentTake(t, { lengthsInBars: [2], hopInBars: 1 }).find((s) => s.limb === "cymbals");
    expect(segment).toBeDefined();
    const notes = resolveSegment(t, segment!, "cymbals");
    expect(notes).toHaveLength(segment!.noteCount);
  });
});

describe("validateTake", () => {
  it("accepts a normal performance", () => {
    expect(validateTake(take(fourBarGroove()))).toHaveLength(0);
  });

  it("rejects the failure that corrupted the previous library", () => {
    // Every note of a 16-beat pattern crammed into a fraction of a beat —
    // the exact signature of a wrong timing unit, which shipped last time
    // alongside a quality report claiming zero issues.
    const collapsed = take(
      Array.from({ length: 24 }, (_, i) => ({ beat: i * 0.001, pitch: KICK, velocity: 90 })),
    );
    const problems = validateTake(collapsed);
    expect(problems.some((p) => /density/.test(p.problem))).toBe(true);
  });

  it("accepts a dense fill lasting less than a bar", () => {
    // Fills run a median of 3.5 beats corpus-wide. Judging takes by span
    // rather than density rejected 47% of a real sample — almost entirely
    // fills, which is exactly the material the transition UI depends on.
    const fill = take(
      Array.from({ length: 21 }, (_, i) => ({ beat: i * 0.15, pitch: SNARE, velocity: 90 })),
      { beatType: "fill" },
    );
    expect(validateTake(fill)).toHaveLength(0);
  });

  it("rejects a take with no notes", () => {
    expect(validateTake(take([]))).toHaveLength(1);
  });

  it("rejects out-of-range velocities", () => {
    const bad = take([
      { beat: 0, pitch: KICK, velocity: 200 },
      { beat: 1, pitch: SNARE, velocity: 90 },
      { beat: 2, pitch: KICK, velocity: 90 },
    ]);
    expect(validateTake(bad).some((p) => /velocity/.test(p.problem))).toBe(true);
  });
});
