import { describe, expect, it } from "vitest";
import { SONG_MAPS } from "./songMaps";
import { GENRE_CATALOG } from "./genre-catalog";
import { applySongMap } from "../lib/sections";
import type { BlueprintSong } from "../types/blueprint";

/** The three narrative archetypes. Their whole point is the ARC — a slot
 *  without a profile is a slot that silently does nothing, and nothing in
 *  the type system stops a template from losing one. */
const ARCHETYPES = ["inverted-matrix", "vignette", "cyclical-loop"];

function makeSong(): BlueprintSong {
  return {
    id: "s",
    title: "t",
    key: "C",
    scale: "ionian",
    bpm: 120,
    concept: "",
    sections: [],
    arrangement: [],
  } as unknown as BlueprintSong;
}

describe("narrative archetype templates", () => {
  it("all exist in the narrative picker's catalog", () => {
    for (const id of ARCHETYPES) {
      expect(SONG_MAPS.some((m) => m.id === id), id).toBe(true);
    }
  });

  it("give every slot a complete, in-range profile", () => {
    for (const id of ARCHETYPES) {
      const map = SONG_MAPS.find((m) => m.id === id)!;
      expect(map.slots.length).toBeGreaterThan(2);
      for (const slot of map.slots) {
        const n = slot.narrative;
        expect(n, `${id}/${slot.label} has no narrative`).toBeDefined();
        expect(n!.tension_profile).toBeGreaterThanOrEqual(0);
        expect(n!.tension_profile).toBeLessThanOrEqual(1);
        expect(n!.rhythmic_energy).toBeGreaterThanOrEqual(0);
        expect(n!.rhythmic_energy).toBeLessThanOrEqual(1);
        expect(Math.abs(n!.transition_delta)).toBeLessThanOrEqual(1);
        expect(n!.structural_warp).toBeGreaterThanOrEqual(0);
        expect(n!.structural_warp).toBeLessThanOrEqual(1);
      }
    }
  });

  it("move the way their own form says they should", () => {
    const spread = (id: string, axis: "tension_profile" | "rhythmic_energy") => {
      const values = SONG_MAPS.find((m) => m.id === id)!.slots.map((s) => s.narrative![axis]);
      return Math.max(...values) - Math.min(...values);
    };
    // An arc that never moves is not an arc.
    expect(spread("inverted-matrix", "rhythmic_energy")).toBeGreaterThan(0.4);
    expect(spread("cyclical-loop", "tension_profile")).toBeGreaterThan(0.2);
    // …and a vignette is the opposite claim: scenes at one height, so it must
    // stay flat and must not warp the grid.
    expect(spread("vignette", "tension_profile")).toBeLessThanOrEqual(0.2);
    expect(spread("vignette", "rhythmic_energy")).toBeLessThanOrEqual(0.2);
    const map = SONG_MAPS.find((m) => m.id === "vignette")!;
    expect(map.slots.every((s) => s.narrative!.structural_warp === 0)).toBe(true);
  });

  it("land on the sections through applySongMap when seeding is asked for", () => {
    const map = SONG_MAPS.find((m) => m.id === "cyclical-loop")!;
    const song = applySongMap(makeSong(), map, { seedNarrative: true });
    expect(song.sections).toHaveLength(map.slots.length);
    song.sections.forEach((section, i) => {
      expect(section.narrative).toEqual(map.slots[i].narrative);
    });
  });

  it("stays out of the genre catalog — these are forms, not genres", () => {
    for (const id of ARCHETYPES) {
      expect(GENRE_CATALOG.some((m) => m.id === id), id).toBe(false);
    }
  });
});
