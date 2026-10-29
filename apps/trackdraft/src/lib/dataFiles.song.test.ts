import { beforeEach, describe, expect, it } from "vitest";
import { BI_TONAL_MATRIX } from "@platform/progression-engine";
import { STYLE_RECIPES } from "@drum/library";
import {
  DATA_FILES,
  applySongTables,
  importDataFile,
  mergeFromFile,
  resetDataFile,
  songTablesWith,
  tableSource,
} from "./dataFiles";

const colour = DATA_FILES.find((spec) => spec.id === "colour")!;
const styles = DATA_FILES.find((spec) => spec.id === "styles")!;

const flavour = { shift: 5, quality: "maj", label: "maj7#11" };

/** Every test starts and ends with the library layer cleared and no song. */
beforeEach(async () => {
  applySongTables(null);
  await resetDataFile(colour, null);
  await resetDataFile(styles, null);
});

describe("per-song table overrides", () => {
  it("merges a song's entries over the library table, not instead of it", () => {
    applySongTables({ colour: { minor: { song_only: flavour } } });
    expect(BI_TONAL_MATRIX.minor.song_only).toBeDefined();
    // everything the song did not name still comes from the library/shipped table
    expect(BI_TONAL_MATRIX.minor.neo_soul_glow).toBeDefined();
    expect(tableSource("colour")).toBe("song");
  });

  it("puts the library table back when the song closes", () => {
    applySongTables({ colour: { minor: { song_only: flavour } } });
    applySongTables(null);
    expect(BI_TONAL_MATRIX.minor.song_only).toBeUndefined();
    expect(tableSource("colour")).toBe("shipped");
  });

  it("switching songs swaps overrides — one song's palette never leaks into the next", () => {
    applySongTables({ colour: { minor: { song_a: flavour } } });
    applySongTables({ colour: { minor: { song_b: { ...flavour, shift: 7 } } } });
    expect(BI_TONAL_MATRIX.minor.song_a).toBeUndefined();
    expect(BI_TONAL_MATRIX.minor.song_b?.shift).toBe(7);
  });

  it("composes: a song override still sees a later library import", async () => {
    applySongTables({ colour: { minor: { song_only: flavour } } });
    const imported = structuredClone(BI_TONAL_MATRIX);
    imported.major = { ...imported.major, library_only: { shift: 2, quality: "maj", label: "6" } };
    expect((await importDataFile(colour, JSON.stringify(imported), "replace", null)).ok).toBe(true);
    expect(BI_TONAL_MATRIX.major.library_only).toBeDefined();
    expect(BI_TONAL_MATRIX.minor.song_only).toBeDefined();
    expect(tableSource("colour")).toBe("song");
  });

  it("a library import merges over the LIBRARY layer, never over a song's entries", async () => {
    applySongTables({ colour: { minor: { song_only: flavour } } });
    expect((await importDataFile(colour, JSON.stringify({ minor: { from_file: flavour } }), "merge", null)).ok).toBe(true);
    applySongTables(null);
    expect(BI_TONAL_MATRIX.minor.from_file).toBeDefined();
    // the song's own flavour was not promoted into the shared table
    expect(BI_TONAL_MATRIX.minor.song_only).toBeUndefined();
  });

  it("songTablesWith adds and drops one entry without touching the rest", () => {
    const first = songTablesWith(undefined, "colour", { minor: { a: flavour } });
    const second = songTablesWith(first, "styles", { rock: { energy: 0.2 } });
    expect(Object.keys(second).sort()).toEqual(["colour", "styles"]);
    const dropped = songTablesWith(second, "colour", undefined);
    expect(Object.keys(dropped)).toEqual(["styles"]);
    // the original set is not mutated
    expect(Object.keys(second)).toEqual(["colour", "styles"]);
  });

  it("mergeFromFile folds a file into whatever base it is given", () => {
    const merged = mergeFromFile(colour, JSON.stringify({ minor: { a: flavour } }), "merge", {});
    expect(merged.ok).toBe(true);
    expect((merged.value as typeof BI_TONAL_MATRIX).minor.a).toBeDefined();
    const replaced = mergeFromFile(colour, JSON.stringify({ minor: { a: flavour } }), "replace", { major: {} });
    expect(Object.keys(replaced.value as object)).toEqual(["minor"]);
  });

  it("applies the song layer to a table that ships with content of its own", () => {
    applySongTables({ styles: { rock: { ...STYLE_RECIPES.rock, energy: 0.11 } } });
    expect(STYLE_RECIPES.rock.energy).toBe(0.11);
    expect(STYLE_RECIPES.trap).toBeDefined();
    expect(tableSource("styles")).toBe("song");
  });
});
