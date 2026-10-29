import { describe, expect, it } from "vitest";
import { SYNTH_VARIANTS, SYNTH_FILLS, CURATED_PATTERNS } from "../src/synthesize.js";
import { ABLETON_SAFE_NOTES } from "../src/ableton.js";

const SAFE_PITCHES = new Set<number>(Object.values(ABLETON_SAFE_NOTES));

describe("synthesized variants", () => {
  it("covers the machine idioms", () => {
    for (const pattern of ["four_on_floor", "trap", "breakbeat", "dnb"] as const) {
      expect(SYNTH_VARIANTS[pattern]!.length, pattern).toBeGreaterThanOrEqual(4);
    }
  });

  it("covers the curated family, odd meters included", () => {
    for (const pattern of ["kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "78", "54", "68"] as const) {
      expect(CURATED_PATTERNS[pattern]!.length, pattern).toBeGreaterThanOrEqual(3);
    }
  });

  it("emits only Ableton-safe pitches and legal velocities", () => {
    for (const [pattern, variants] of [...Object.entries(SYNTH_VARIANTS), ...Object.entries(CURATED_PATTERNS)]) {
      for (const variant of variants!) {
        for (const [, pitch, velocity] of variant.notes) {
          expect(SAFE_PITCHES.has(pitch), `${pattern} pitch ${pitch}`).toBe(true);
          expect(velocity).toBeGreaterThanOrEqual(1);
          expect(velocity).toBeLessThanOrEqual(127);
        }
      }
    }
  });

  it("keeps every note inside the declared loop length", () => {
    for (const [pattern, variants] of [...Object.entries(SYNTH_VARIANTS), ...Object.entries(CURATED_PATTERNS)]) {
      for (const variant of variants!) {
        for (const [beat] of variant.notes) {
          expect(beat, `${pattern} note at ${beat}`).toBeGreaterThanOrEqual(0);
          expect(beat, `${pattern} note at ${beat}`).toBeLessThan(variant.lengthBeats);
        }
      }
    }
  });

  it("declares the right meter spans", () => {
    expect(CURATED_PATTERNS["78"]![0].lengthBeats).toBe(3.5);
    expect(CURATED_PATTERNS["54"]![0].lengthBeats).toBe(5);
    expect(CURATED_PATTERNS["68"]![0].lengthBeats).toBe(3);
    expect(SYNTH_VARIANTS.four_on_floor![0].lengthBeats).toBe(4);
    // Two-bar loops still declare a 4-beat bar — that's what a fill replaces.
    expect(SYNTH_VARIANTS.trap![0].lengthBeats).toBe(8);
    expect(SYNTH_VARIANTS.trap![0].beatsPerBar).toBe(4);
    expect(SYNTH_VARIANTS.dnb![0].beatsPerBar).toBe(4);
  });

  it("keeps the four-on-the-floor skeleton on every quarter note", () => {
    const kicks = SYNTH_VARIANTS.four_on_floor![0].notes.filter(([, p]) => p === ABLETON_SAFE_NOTES.kick);
    expect(kicks.map(([beat]) => beat)).toContain(0);
    expect(kicks.map(([beat]) => beat)).toContain(1);
    expect(kicks.map(([beat]) => beat)).toContain(2);
    expect(kicks.map(([beat]) => beat)).toContain(3);
  });

  it("marks provenance as synth with a generator name", () => {
    for (const variants of Object.values(SYNTH_VARIANTS)) {
      for (const variant of variants!) {
        expect(variant.source.origin).toBe("synth");
        expect(variant.source.generator).toBeTruthy();
      }
    }
  });

  it("dnb keeps the two-step skeleton: snares on 2 and 4 of each bar", () => {
    for (const variant of SYNTH_VARIANTS.dnb!) {
      const snareBeats = variant.notes
        .filter(([, p]) => p === ABLETON_SAFE_NOTES.snare)
        .map(([beat]) => beat);
      for (const anchor of [1, 3, 5, 7]) {
        expect(snareBeats, `snare on ${anchor}`).toContain(anchor);
      }
    }
  });

  it("trap stays half-time: exactly one backbeat snare per bar", () => {
    for (const variant of SYNTH_VARIANTS.trap!) {
      const snares = variant.notes.filter(([, p]) => p === ABLETON_SAFE_NOTES.snare).map(([b]) => b);
      expect(snares).toEqual([2, 6]);
    }
  });
});

describe("synthesized fills", () => {
  it("provides fills for every meter the presets can produce", () => {
    for (const key of ["4", "3", "3.5", "5"]) {
      expect(SYNTH_FILLS[key]!.length, `fills for ${key} beats`).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps fill notes inside their single bar", () => {
    for (const [key, fills] of Object.entries(SYNTH_FILLS)) {
      const barBeats = Number(key);
      for (const fill of fills) {
        expect(fill.lengthBeats).toBe(barBeats);
        for (const [beat] of fill.notes) {
          expect(beat).toBeGreaterThanOrEqual(0);
          expect(beat).toBeLessThan(barBeats);
        }
      }
    }
  });
});
