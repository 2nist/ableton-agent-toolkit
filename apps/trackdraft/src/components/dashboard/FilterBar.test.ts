import { describe, expect, it } from "vitest";
import { NOTE_TO_PC } from "@music-theory/core";
import { defaultFilters } from "./FilterBar";

/**
 * The default filter must admit every song the app can hold.
 *
 * It did not: the key list was hand-written with sharps only, so the eight
 * Beatles catalogue songs in Eb / Bb / Db / Ab were filtered out of the
 * dashboard with no chip to select them — 174 rows for a 182-song library.
 * Caught by loading a real catalogue into the desktop build.
 */
describe("dashboard default filters", () => {
  it("admits every note name the theory engine can store", () => {
    const admitted = defaultFilters().keys;
    const missing = Object.keys(NOTE_TO_PC).filter((key) => !admitted.has(key));
    expect(missing, `these keys would be silently hidden: ${missing.join(", ")}`).toEqual([]);
  });

  it("admits the flat spellings the catalogue actually uses", () => {
    const admitted = defaultFilters().keys;
    for (const key of ["Eb", "Bb", "Db", "Ab"]) {
      expect(admitted.has(key), key).toBe(true);
    }
  });

  it("admits every scale the app can store, and every confidence tier", () => {
    const filters = defaultFilters();
    for (const scale of ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"]) {
      expect(filters.scales.has(scale), scale).toBe(true);
    }
    expect(filters.confidence.size).toBeGreaterThan(0);
  });
});
