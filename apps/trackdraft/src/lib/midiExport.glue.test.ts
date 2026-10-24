import { describe, expect, it } from "vitest";
import { planBassStem, planChordStem } from "./midiExport";
import { sectionSpans } from "./arrangement";

/**
 * GROOVE-AS-GLUE, end to end through the real export planners. The drums are
 * pushed late with a steps block's `offsetBeats` (the same field the NUDGE
 * step param writes), so the measured pocket is non-zero and the assertion
 * is a real note move rather than "it ran".
 */
const LATE = 0.1;

const song = (glue?: { bass?: boolean; chords?: boolean; strength?: number }, offset = LATE) =>
  ({
    id: "s1",
    title: "Glue probe",
    bpm: 120,
    key: "C",
    scale: "ionian",
    arrangement: [],
    sections: [
      {
        id: "sec1",
        name: "A",
        role: "verse",
        bars: 4,
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
        velocity: 100,
        drumPattern: "standard",
        chords: [
          { id: "c1", root: "C", quality: "maj", beats: 4 },
          { id: "c2", root: "F", quality: "maj", beats: 4 },
        ],
        // Every kick lands `offset` late — the pocket the bass must follow.
        drumBlocks: [
          {
            id: "blk-kick-0-4-steps",
            lane: "kick",
            startBeat: 0,
            endBeat: 4,
            mode: "steps",
            notes: [0, 1, 2, 3].map((beat) => ({ beat, voice: "kick", velocity: 100, offsetBeats: offset })),
          },
        ],
        grooveGlue: glue,
      },
    ],
  }) as any;

const bassStarts = (s: any) => planBassStem(sectionSpans(s), s).map((n) => n.startTime);
const chordStarts = (s: any) => planChordStem(sectionSpans(s), s).map((n) => n.startTime);

describe("groove-as-glue — the drums' pocket reaches the other parts", () => {
  it("leaves the bass on the grid when the section isn't glued", () => {
    expect(bassStarts(song(undefined))).toEqual([0, 4, 8, 12]);
  });

  it("moves the bass onto the pocket when glued", () => {
    const plain = bassStarts(song(undefined));
    const glued = bassStarts(song({ bass: true }));
    expect(glued).toHaveLength(plain.length);
    const deltas = glued.map((t, i) => t - plain[i]);
    // the pocket is the slot's MEAN across every voice that plays there, so
    // the move is a fraction of the kick's 0.1 — but it is late, uniform and
    // never over the kick's own offset
    for (const d of deltas) {
      expect(d).toBeGreaterThan(1e-6);
      expect(d).toBeLessThanOrEqual(LATE + 1e-9);
    }
    // same slot every bar ⇒ same shift every bar
    expect(new Set(deltas.map((d) => d.toFixed(6))).size).toBe(1);
  });

  it("moves the chords only when the chords target is on", () => {
    const plain = chordStarts(song(undefined));
    const asBassOnly = chordStarts(song({ bass: true }));
    const glued = chordStarts(song({ chords: true }));
    expect(asBassOnly).toEqual(plain); // bass target must not touch harmony
    expect(glued).toHaveLength(plain.length);
    glued.forEach((t, i) => {
      expect(t).toBeGreaterThan(plain[i]);
      expect(t - plain[i]).toBeLessThanOrEqual(LATE + 1e-9);
    });
  });

  it("is a no-op at strength 0", () => {
    expect(bassStarts(song({ bass: true, strength: 0 }))).toEqual([0, 4, 8, 12]);
  });

  it("keeps pitches and durations — only time and velocity move", () => {
    const plain = planBassStem(sectionSpans(song(undefined)), song(undefined));
    const glued = planBassStem(sectionSpans(song({ bass: true })), song({ bass: true }));
    expect(glued.map((n) => n.pitch)).toEqual(plain.map((n) => n.pitch));
    expect(glued.map((n) => n.duration)).toEqual(plain.map((n) => n.duration));
  });
});
