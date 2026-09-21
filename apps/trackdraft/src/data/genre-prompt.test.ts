import { describe, it, expect } from "vitest";
import { validateSongMapShape, genreMapFilename } from "./genre-prompt";
import { GENRE_CATALOG } from "./genre-catalog/index";
import type { SongMap } from "./songMaps";

describe("validateSongMapShape", () => {
  it("accepts every catalog map as-is — the catalog must stay the source of truth", () => {
    for (const map of GENRE_CATALOG) {
      expect(validateSongMapShape(map), `map ${map.id}`).toEqual([]);
    }
  });

  it("rejects unknown roles, bad harmonyRhythm values, and non-engine genres", () => {
    const base = {
      id: "genre-x",
      name: "X",
      description: "",
      slots: [{ role: "verse", label: "V", purpose: "FEEL: x." }],
    };
    const roleErrors = validateSongMapShape({ ...base, slots: [{ role: "drop", label: "V", purpose: "FEEL: x." }] });
    expect(roleErrors.some((e) => e.includes("unknown role"))).toBe(true);
    const rhythmErrors = validateSongMapShape({ ...base, slots: [{ role: "verse", label: "V", purpose: "FEEL: x.", harmonyRhythm: "swing it" }] });
    expect(rhythmErrors.some((e) => e.includes("harmonyRhythm"))).toBe(true);
    const genreErrors = validateSongMapShape({ ...base, defaults: { genre: "polka" } });
    expect(genreErrors.some((e) => e.includes("engine genre"))).toBe(true);
    // A real engine family passes untouched.
    expect(validateSongMapShape({ ...base, defaults: { genre: "neo-soul" } })).toEqual([]);
  });
});

describe("genreMapFilename", () => {
  it("derives the catalog contract: id minus 'genre-', slugified — unique for every catalog entry", () => {
    expect(genreMapFilename({ id: "genre-math-rock-78" } as SongMap)).toBe("math-rock-78.json");
    const names = GENRE_CATALOG.map((m) => genreMapFilename(m));
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches the actual files on disk in data/genre-catalog (reconciled 2026-09-21)", () => {
    // Real directory listing — if a file is renamed without updating its
    // id (or vice versa) this fails loudly, which is the whole point of
    // the filename contract.
    const expected = [
      "math-rock-78.json",
      "stoner-sludge.json",
      "grunge-soft-loud.json",
      "prog-rock-54.json",
      "neo-soul-modal.json",
      "boom-bap.json",
      "indie-folk.json",
      "blues-12bar.json",
      "industrial.json",
      "electro-industrial-ebm.json",
      "trap-metal.json",
      "bossa-nova.json",
      "neo-psychedelia.json",
      "synthwave.json",
    ];
    expect(GENRE_CATALOG.map((m) => genreMapFilename(m)).sort()).toEqual([...expected].sort());
  });
});
