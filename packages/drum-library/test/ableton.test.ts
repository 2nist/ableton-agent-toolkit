import { describe, expect, it } from "vitest";
import { ABLETON_SAFE_NOTES, foldForAbleton, foldPitch } from "../src/ableton.js";
import type { DrumNote } from "../src/types.js";

function note(beat: number, pitch: number, velocity = 100): DrumNote {
  return { beat, pitch, velocity };
}

describe("foldPitch", () => {
  it("sends the pedal hi-hat to the closed hat, not a tom", () => {
    // Note 44 is 14.6% of all beat hits in E-GMD and is a LOW TOM on both the
    // 808 and 909 Core Kits. Unfolded, one hit in seven of a typical groove
    // fires a tom instead of a foot hat.
    expect(foldPitch(44)).toBe(ABLETON_SAFE_NOTES.closedHat);
  });

  it("rescues hat edge articulations that fall below the rack", () => {
    // 22 and 26 sit under note 36 and trigger nothing at all in a 16-pad
    // rack — silently, since a missing hat just sounds sparser.
    expect(foldPitch(22)).toBe(ABLETON_SAFE_NOTES.closedHat);
    expect(foldPitch(26)).toBe(ABLETON_SAFE_NOTES.openHat);
  });

  it("keeps the consistently-mapped core voices where they are", () => {
    expect(foldPitch(36)).toBe(36);
    expect(foldPitch(37)).toBe(37);
    expect(foldPitch(38)).toBe(38);
    expect(foldPitch(42)).toBe(42);
    expect(foldPitch(46)).toBe(46);
  });

  it("folds ride to the closed hat by default", () => {
    // Note 51 is claves on an 808 Core Kit. Ride and hat are both timekeeping
    // voices, so the groove survives the substitution; claves would not.
    for (const ride of [51, 53, 59]) {
      expect(foldPitch(ride)).toBe(ABLETON_SAFE_NOTES.closedHat);
    }
  });

  it("keeps ride on 51 when the rack is known to have one", () => {
    for (const ride of [51, 53, 59]) {
      expect(foldPitch(ride, { preferRide: true })).toBe(ABLETON_SAFE_NOTES.ride);
    }
  });

  it("collapses the second snare zone onto the snare", () => {
    expect(foldPitch(40)).toBe(ABLETON_SAFE_NOTES.snare);
  });

  it("collapses crash articulations onto one crash", () => {
    for (const crash of [49, 52, 55, 57]) {
      expect(foldPitch(crash)).toBe(ABLETON_SAFE_NOTES.crash);
    }
  });

  it("returns null for voices with no rack-safe home", () => {
    // Reported rather than dropped silently, so a thinned groove is visible.
    expect(foldPitch(56)).toBeNull();
    expect(foldPitch(1)).toBeNull();
  });

  it("never emits a note outside the safe set", () => {
    const safe = new Set<number>(Object.values(ABLETON_SAFE_NOTES));
    for (let pitch = 0; pitch < 128; pitch++) {
      for (const preferRide of [false, true]) {
        const folded = foldPitch(pitch, { preferRide });
        if (folded !== null) expect(safe.has(folded)).toBe(true);
      }
    }
  });
});

describe("foldForAbleton", () => {
  it("merges simultaneous hits that land on the same pad", () => {
    // A hat bow and hat edge struck together are one articulation. Stacking
    // two notes on one pad retriggers the sample in Live, producing a flam or
    // a level spike the drummer never played.
    const result = foldForAbleton([note(0, 42, 80), note(0, 22, 110)]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].velocity).toBe(110);
  });

  it("preserves genuine microtiming between separate hits", () => {
    const result = foldForAbleton([note(0, 42, 90), note(0.021, 22, 95)]);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[1].beat).toBeCloseTo(0.021, 4);
  });

  it("keeps velocities untouched — dynamics are the point", () => {
    const result = foldForAbleton([note(0, 36, 21), note(1, 38, 120)]);
    expect(result.notes.map((n) => n.velocity)).toEqual([21, 120]);
  });

  it("reports dropped hits rather than thinning the groove silently", () => {
    const result = foldForAbleton([note(0, 36, 100), note(0.5, 56, 90), note(1, 56, 90)]);
    expect(result.notes).toHaveLength(1);
    expect(result.dropped.get(56)).toBe(2);
  });

  it("returns notes in time order", () => {
    const result = foldForAbleton([note(2, 38), note(0, 36), note(1, 42)]);
    expect(result.notes.map((n) => n.beat)).toEqual([0, 1, 2]);
  });

  it("folds a realistic groove entirely onto safe notes", () => {
    // A swing bar as E-GMD records it: ride, pedal hat, kick, snare, hat edge.
    const groove = [
      note(0, 51, 95),
      note(0, 36, 60),
      note(0.66, 51, 70),
      note(1, 44, 55),
      note(1, 38, 30),
      note(2, 51, 90),
      note(2.66, 22, 65),
      note(3, 44, 58),
    ];
    const result = foldForAbleton(groove);
    const safe = new Set<number>(Object.values(ABLETON_SAFE_NOTES));
    expect(result.dropped.size).toBe(0);
    for (const n of result.notes) expect(safe.has(n.pitch)).toBe(true);
  });
});
