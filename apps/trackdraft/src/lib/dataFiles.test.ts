import { describe, expect, it } from "vitest";
import { BI_TONAL_MATRIX } from "@platform/progression-engine";
import { STYLE_RECIPES } from "@drum/library";
import { DATA_FILES, importDataFile, resetDataFile } from "./dataFiles";

const colour = DATA_FILES.find((spec) => spec.id === "colour")!;

describe("data files — the engine's editable tables", () => {
  it("exports an envelope the importer accepts back", async () => {
    const envelope = JSON.stringify({ format: colour.format, data: colour.current() });
    const result = await importDataFile(colour, envelope);
    expect(result.ok).toBe(true);
  });

  it("accepts a bare table too — a hand-edited file is usually one", async () => {
    const bare = JSON.stringify(BI_TONAL_MATRIX);
    expect((await importDataFile(colour, bare)).ok).toBe(true);
  });

  it("replaces the LIVE table, so the engine reads the import", async () => {
    const custom = { ...structuredClone(BI_TONAL_MATRIX), minor: { ...BI_TONAL_MATRIX.minor, my_flavour: { shift: 3, quality: "min", label: "m7" } } };
    expect((await importDataFile(colour, JSON.stringify(custom))).ok).toBe(true);
    // live binding: the package's own export reflects the import
    expect(BI_TONAL_MATRIX.minor.my_flavour).toBeDefined();
    await resetDataFile(colour);
    // reset goes back to what shipped, not to what was imported
    expect(BI_TONAL_MATRIX.minor.my_flavour).toBeUndefined();
    expect(BI_TONAL_MATRIX.minor.neo_soul_glow).toBeDefined();
  });

  it("refuses a file that is not that kind of table", async () => {
    expect((await importDataFile(colour, JSON.stringify({ hello: "world" }))).ok).toBe(false);
    expect((await importDataFile(colour, "not json at all")).ok).toBe(false);
    const styles = DATA_FILES.find((spec) => spec.id === "styles")!;
    expect((await importDataFile(styles, JSON.stringify({ rock: { energy: 1 } }))).ok).toBe(true);
    expect(STYLE_RECIPES.rock.energy).toBe(1);
    await resetDataFile(styles);
  });

  it("ships a filename that is identifiable in a folder of JSON", () => {
    for (const spec of DATA_FILES) expect(spec.filename.endsWith(".json")).toBe(true);
  });
});
