import { describe, expect, it } from "vitest";
import { detectBendRatings } from "./detectBend";
import type { BlueprintSong } from "../../types/blueprint";

 

function chord(quality: string, romanNumeral = "I"): any {
  return { id: Math.random().toString(36), romanNumeral, root: "A", quality, beats: 2 };
}

function section(chords: any[] = [], extra: Record<string, unknown> = {}): any {
  return {
    id: `s${Math.random().toString(36).slice(2, 6)}`,
    name: "Verse", role: "verse", bars: 4, chords,
    beatsPerChord: 4, velocity: "mf",
    timeSignatureNumerator: 4, timeSignatureDenPower: 2,
    ...extra,
  };
}

function song(partial: Partial<BlueprintSong> = {}): BlueprintSong {
  return {
    id: "t", title: "T", key: "A", scale: "ionian", bpm: 120,
    timeSignatureNumerator: 4, timeSignatureDenominator: 4,
    sections: [], arrangement: [], createdAt: "", updatedAt: "",
    ...partial,
  } as BlueprintSong;
}

describe("detectBendRatings", () => {
  it("returns nothing for an empty song with no profiles", () => {
    expect(detectBendRatings(song())).toEqual({});
  });

  it("reads Color (extensions) and Tension (specials + accidentals) from the chord stream", () => {
    const s = song({
      sections: [section([
        chord("maj7"), chord("min7"), chord("maj7", "IV"),
        chord("dim", "bVII"),
      ])],
    });
    const r = detectBendRatings(s);
    expect(r.harmony).toBe(0.75); // 3 of 4 chords carry a 7th
    expect(r.tension).toBe(0.25); // 0.6·(1/4) specials + 0.4·(1/4) accidentals
  });

  it("maps the drum profile: energy from section dB, backbeat from 2-beat periodicity, density from hits/bar", () => {
    const r = detectBendRatings(song(), {
      drums: {
        sections: [
          { bars: 10, energyDb: -40 },
          { bars: 10, energyDb: -14 },
        ],
        global: {
          kick: { hits_per_bar: 4 },
          snare: { hits_per_bar: 6, periodicity: { twoBeat: 0.55 } },
          hat: { hits_per_bar: 10 },
        },
      },
    });
    expect(r.energy).toBe(0.5); // weighted −27 dB → (−27+40)/26
    expect(r.backbeat).toBe(0.5); // (0.55 − 0.3) / 0.5
    expect(r.density).toBe(0.8); // 20 hits/bar → 16/20
  });

  it("maps the bass profile: register, motion, rhythm", () => {
    const r = detectBendRatings(song(), {
      bass: { overall: { register_med: "D2", fifth_pct: 10, notes_per_bar: 2.75 } },
    });
    expect(r.bassRegister).toBe(0.33); // D2 = MIDI 38 → 5/15
    expect(r.bassMotion).toBe(0.4); // 0.15 + 0.5·(10/20)
    expect(r.bassRhythm).toBe(0.5); // (2.75−1)/3.5
  });

  it("derives melodyContour only when a line was captured", () => {
    const noMelody = detectBendRatings(song());
    expect(noMelody.melodyContour).toBeUndefined();

    const withMelody = detectBendRatings(song({
      sections: [section([], {
        melody: { notes: [
          { pitch: 60, startTime: 0, duration: 1 },
          { pitch: 71, startTime: 1, duration: 1 },
          { pitch: 60, startTime: 2, duration: 1 },
          { pitch: 59, startTime: 3, duration: 1 },
        ] },
      })],
    }));
    expect(withMelody.melodyContour).toBe(0.75); // leap-heavy: 0.25·1 + 0.75·(2/3)
  });

  it("clamps outliers from crazy profiles", () => {
    const r = detectBendRatings(song(), {
      bass: { overall: { register_med: "B6", fifth_pct: 100, notes_per_bar: 40 } },
      drums: { global: { kick: { hits_per_bar: 99 } } },
    });
    expect(r.bassRegister).toBe(1);
    expect(r.bassMotion).toBe(0.65);
    expect(r.bassRhythm).toBe(1);
    expect(r.density).toBe(1);
  });
});
