import { describe, expect, it } from "vitest";
import {
  groupStartsFromOutline, metricWeight, prosodyIssues, segmentPhrases, syllableSlots,
  type MelodyNoteLike,
} from "./melodyPhrases";

const n = (startTime: number, duration: number, pitch = 60): MelodyNoteLike => ({ pitch, startTime, duration });

describe("segmentPhrases", () => {
  const notes = [n(0, 0.5, 60), n(0.5, 0.5, 64), n(1, 1, 67), n(4, 0.5, 62), n(4.5, 2, 60)];

  it("splits on rests of a beat or more", () => {
    const p = segmentPhrases(notes);
    expect(p).toHaveLength(2);
    expect(p[0].notes).toHaveLength(3);
    expect(p[1].notes).toHaveLength(2);
    expect([p[0].startBeat, p[0].endBeat, p[1].startBeat, p[1].endBeat]).toEqual([0, 2, 4, 6.5]);
  });

  it("reports the final hold and the peak note", () => {
    const p = segmentPhrases(notes);
    expect(p[0].peakIndex).toBe(2);
    expect(p[1].finalHoldBeats).toBe(2);
  });

  it("respects a custom rest threshold and unsorted input", () => {
    expect(segmentPhrases([...notes].reverse(), { minRestBeats: 3 })).toHaveLength(1);
    expect(segmentPhrases([])).toEqual([]);
  });
});

describe("metricWeight", () => {
  it("ranks a 4/4 bar: downbeat > beat 3 > beats > eighths > sixteenths", () => {
    const m = { beatsPerBar: 4 };
    expect([0, 2, 1, 0.5, 0.25].map((b) => metricWeight(b, m))).toEqual([1, 0.7, 0.5, 0.3, 0.15]);
    expect(metricWeight(4, m)).toBe(1); // next bar's downbeat
  });

  it("uses the outline's groups in 7/8 (2+2+3)", () => {
    const groupStarts = groupStartsFromOutline([2, 2, 3], 0.5);
    expect(groupStarts).toEqual([0, 1, 2]);
    const m = { beatsPerBar: 3.5, groupStarts };
    expect([0, 1, 2, 3.5].map((b) => metricWeight(b, m))).toEqual([1, 0.7, 0.7, 1]);
    expect(metricWeight(3, m)).toBe(0.5);
  });
});

describe("syllableSlots + prosodyIssues", () => {
  const meter = { beatsPerBar: 4 };
  const phrase = segmentPhrases([n(0, 1, 60), n(1, 0.5, 62), n(1.5, 0.5, 64), n(2, 2, 67)])[0];
  const slots = syllableSlots(phrase, meter);

  it("marks strong slots, the peak and the final note", () => {
    expect(slots.map((s) => s.strong)).toEqual([true, false, false, true]);
    expect(slots[3].isPeak).toBe(true);
    expect(slots[3].isFinal).toBe(true);
  });

  it("flags a stressed syllable on a weak slot and a weak syllable held on a strong one", () => {
    const r = prosodyIssues([1, 0, 1, 0], slots);
    expect(r.issues).toEqual([
      { slot: 2, kind: "stressed-on-weak" },
      { slot: 3, kind: "unstressed-held-on-strong" },
    ]);
    expect(r.countDelta).toBe(0);
  });

  it("accepts a well-aligned line and reports crowding / melisma by count", () => {
    expect(prosodyIssues([1, 0, 0, 1], slots).issues).toEqual([]);
    expect(prosodyIssues([1, 0, 0, 0, 1], slots).countDelta).toBe(1);
    expect(prosodyIssues([1, 0], slots).countDelta).toBe(-2);
  });
});
