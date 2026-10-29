import { describe, expect, it, vi } from "vitest";
import { BI_TONAL_MATRIX } from "@platform/progression-engine";
import { STYLE_RECIPES } from "@drum/library";
import type { TrackDraftHost } from "./host";
import { DATA_FILES, importDataFile, loadTables, resetDataFile, tableSource } from "./dataFiles";

const colour = DATA_FILES.find((spec) => spec.id === "colour")!;
const styles = DATA_FILES.find((spec) => spec.id === "styles")!;

/** A host that behaves like the desktop one: files in a folder. */
function fakeHost(files: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...files };
  const host = {
    isElectron: true as const,
    tablesLoad: async () => ({ dir: "/lib/tables", files: { ...store }, errors: {} }),
    tablesSave: vi.fn(async (name: string, data: unknown) => {
      store[name] = data;
      return { ok: true, path: `/lib/tables/${name}` };
    }),
    tablesDelete: vi.fn(async (name: string) => {
      delete store[name];
      return { ok: true };
    }),
  };
  return { host: host as unknown as TrackDraftHost, store, save: host.tablesSave, remove: host.tablesDelete };
}

describe("tables as library files", () => {
  it("loads a table file at boot and reports where it came from", async () => {
    const custom = { ...structuredClone(BI_TONAL_MATRIX), minor: { ...BI_TONAL_MATRIX.minor, mine: { shift: 4, quality: "min", label: "m9" } } };
    const { host } = fakeHost({ [colour.filename]: custom });
    const report = await loadTables(host);
    expect(report.loaded).toContain("colour");
    expect(tableSource("colour")).toBe("library");
    expect(BI_TONAL_MATRIX.minor.mine).toBeDefined();
    await resetDataFile(colour, host);
    expect(BI_TONAL_MATRIX.minor.mine).toBeUndefined();
  });

  it("skips a file that is not that kind of table, and keeps the shipped one", async () => {
    const { host } = fakeHost({ [colour.filename]: { nope: true } });
    const report = await loadTables(host);
    expect(report.loaded).not.toContain("colour");
    expect(report.skipped.map((s) => s.id)).toContain("colour");
    expect(BI_TONAL_MATRIX.minor.neo_soul_glow).toBeDefined();
  });

  it("a merge import WRITES the merged table to the library file", async () => {
    const { host, store, save } = fakeHost();
    const oneFlavour = { minor: { mine2: { shift: 5, quality: "min", label: "m7" } } };
    const result = await importDataFile(colour, JSON.stringify(oneFlavour), "merge", host);
    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalled();
    // the file holds the merge, not just the import
    const written = store[colour.filename] as Record<string, Record<string, unknown>>;
    expect(written.minor.mine2).toBeDefined();
    expect(written.minor.neo_soul_glow).toBeDefined();
    await resetDataFile(colour, host);
  });

  it("a replace import swaps the table, and reset brings the shipped one back", async () => {
    const { host, store } = fakeHost();
    const only = { minor: { only: { shift: 1, quality: "min", label: "m" } } };
    await importDataFile(colour, JSON.stringify(only), "replace", host);
    expect((store[colour.filename] as Record<string, Record<string, unknown>>).minor.only).toBeDefined();
    expect((store[colour.filename] as Record<string, Record<string, unknown>>).major).toBeUndefined();
    await resetDataFile(colour, host);
    expect(BI_TONAL_MATRIX.major).toBeDefined();
    expect(tableSource("colour")).toBe("shipped");
  });

  it("reset deletes the file rather than rewriting a copy of the default", async () => {
    const { host, remove } = fakeHost();
    await resetDataFile(colour, host);
    expect(remove).toHaveBeenCalledWith(colour.filename);
  });

  it("merges genres by key, keeping the ones the file does not name", async () => {
    const { host } = fakeHost();
    await importDataFile(styles, JSON.stringify({ mygenre: { energy: 0.5, density: 0.5, backbeat: 0.5, feel: 0.5, kit: 0.5, harmony: 0.5, tempo: 100 } }), "merge", host);
    expect(STYLE_RECIPES.mygenre).toBeDefined();
    expect(STYLE_RECIPES.rock).toBeDefined();
    await resetDataFile(styles, host);
    expect(STYLE_RECIPES.mygenre).toBeUndefined();
  });
});
