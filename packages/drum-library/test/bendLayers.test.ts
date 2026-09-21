import { describe, expect, it } from "vitest";
import { bassProfileFromBend, resolveBassProfile, DEFAULT_BASS_PROFILE } from "../src/bass.js";
import { DEFAULT_STYLE_PROFILE, styleArticulation, styleQualityFor, styleTension } from "../src/style.js";
import { styleMelodyLine } from "../src/melody.js";

describe("bassProfileFromBend — Bend Bass layer mapping", () => {
  it("maps register/motion/rhythm zones and the velocity scale", () => {
    expect(
      bassProfileFromBend({ bassRegister: 0.1, bassMotion: 0.5, bassRhythm: 0.9, bassVelocity: 1 }),
    ).toEqual({ octave: 2, motion: "root_fifth", rhythm: "eighth", velocity: 127 });
    expect(bassProfileFromBend({ bassRegister: 0.9 })).toEqual({ octave: 4 });
    expect(bassProfileFromBend({ bassVelocity: 0 })).toEqual({ velocity: 70 });
  });

  it("omits axes the bend does not set (never shadows authored values)", () => {
    expect(bassProfileFromBend({})).toEqual({});
  });
});

describe("resolveBassProfile — precedence", () => {
  it("defaults ← explicit profile ← bend axes (bend tints on top)", () => {
    const resolved = resolveBassProfile(
      { octave: 3, motion: "walking", rhythm: "half", velocity: 60 },
      { ...DEFAULT_STYLE_PROFILE, bassVelocity: 1 },
    );
    expect(resolved.motion).toBe("walking"); // bend has no motion axis set → explicit wins
    expect(resolved.rhythm).toBe("half");
    expect(resolved.velocity).toBe(127); // bend velocity wins over explicit
  });

  it("neutral (no bass axes set) reproduces the historical profile exactly", () => {
    expect(resolveBassProfile(undefined, DEFAULT_STYLE_PROFILE)).toEqual(DEFAULT_BASS_PROFILE);
    expect(resolveBassProfile({ motion: "walking" }, DEFAULT_STYLE_PROFILE)).toEqual({
      ...DEFAULT_BASS_PROFILE,
      motion: "walking",
    });
  });
});

describe("styleTension — three deterministic zones", () => {
  it("no-op through the middle band; consonant below, dissonant above", () => {
    expect(styleTension("maj", 0.5)).toBe("maj");
    expect(styleTension("aug", 0.1)).toBe("maj");
    expect(styleTension("min", 0.9)).toBe("dim");
    expect(styleTension("maj", 1)).toBe("aug");
  });

  it("an authored extendedSuffix always wins in styleQualityFor", () => {
    expect(styleQualityFor({ quality: "maj", extendedSuffix: "maj9" }, 1, 1)).toBe("maj");
  });

  it("Color then Tension compose (triad → 7th → m7b5 at extremes)", () => {
    expect(styleQualityFor({ quality: "min" }, 0.9, 0.5)).toBe("min7");
    expect(styleQualityFor({ quality: "min" }, 0.9, 0.9)).toBe("m7b5");
  });
});

describe("styleArticulation — block → strum → arp", () => {
  it("0.5 and below stays a block chord (undefined = engine default)", () => {
    expect(styleArticulation(0.2)).toBeUndefined();
    expect(styleArticulation(0.5)).toBeUndefined();
  });

  it("above mid strums (widening); the far end arpeggiates", () => {
    const mid = styleArticulation(0.62)!;
    expect(mid.style).toBe("strum");
    expect(mid.params!.strumMs).toBeGreaterThan(60);
    const top = styleArticulation(1)!;
    expect(top.style).toBe("arp");
    expect(top.params!.subdivision).toBe(8);
  });
});

describe("styleMelodyLine — Bend Melody contour", () => {
  const line = [{ pitch: 60 }, { pitch: 72 }, { pitch: 60 }, { pitch: 62 }];

  it("0.5 and above leaves the captured line untouched (same array, no copies)", () => {
    expect(styleMelodyLine(line, 0.5)).toBe(line);
    expect(styleMelodyLine(line, 0.9)).toBe(line);
    expect(styleMelodyLine(line, undefined)).toBe(line);
  });

  it("toward conjunct folds leaps toward steps, preserving direction", () => {
    const smoothed = styleMelodyLine(line, 0);
    expect(smoothed[1]!.pitch).toBe(62); // +12 st leap → +2 st
    expect(smoothed[2]!.pitch).toBe(60); // −12 st leap → −2 st
    expect(smoothed[3]!.pitch).toBe(62); // a step stays a step
  });

  it("does not mutate the input notes", () => {
    const snapshot = line.map((n) => n.pitch);
    styleMelodyLine(line, 0);
    expect(line.map((n) => n.pitch)).toEqual(snapshot);
  });
});
