import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPanels, resetStudyBoardForTests, useStudyStore } from "./studyStore";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

vi.stubGlobal("localStorage", new MemoryStorage());

beforeEach(() => {
  resetStudyBoardForTests();
});

describe("study store", () => {
  it("seeds a board instead of a blank query form", () => {
    const kinds = useStudyStore.getState().panels.map((panel) => panel.kind);
    expect(kinds).toContain("leads");
    expect(kinds).toContain("matrix");
  });

  it("drops the filter stack when the scope changes", () => {
    const store = useStudyStore.getState();
    store.addFilter({ field: "role", op: "eq", value: "chorus", grain: "common" });
    expect(useStudyStore.getState().filters).toHaveLength(1);
    store.setScope("library");
    expect(useStudyStore.getState().filters).toHaveLength(0);
    expect(useStudyStore.getState().scope).toBe("library");
  });

  it("does not stack the same filter twice", () => {
    const filter = { field: "role", op: "eq" as const, value: "verse", grain: "common" as const };
    useStudyStore.getState().addFilter(filter);
    useStudyStore.getState().addFilter(filter);
    expect(useStudyStore.getState().filters).toHaveLength(1);
  });

  it("selects an added panel and clears the selection when it is removed", () => {
    const panel = { ...defaultPanels("song")[0]!, id: "new", title: "New" };
    useStudyStore.getState().addPanel(panel);
    expect(useStudyStore.getState().selectedPanelId).toBe("new");
    useStudyStore.getState().removePanel("new");
    expect(useStudyStore.getState().selectedPanelId).toBeNull();
  });

  it("keeps a separate board per scope, with a catalogue that matches its data", () => {
    const catalogue = defaultPanels("catalogue");
    expect(catalogue.map((panel) => panel.grain)).toContain("chord");
    expect(catalogue.some((panel) => panel.dimension === "role")).toBe(false);

    useStudyStore.getState().setScope("catalogue");
    const before = useStudyStore.getState().panels.map((panel) => panel.id);
    useStudyStore.getState().addPanel({ ...catalogue[0]!, id: "extra", title: "Extra" });
    useStudyStore.getState().setScope("song");
    expect(useStudyStore.getState().panels.some((panel) => panel.id === "extra")).toBe(false);
    useStudyStore.getState().setScope("catalogue");
    expect(useStudyStore.getState().panels.some((panel) => panel.id === "extra")).toBe(true);
    expect(before).not.toContain("extra");
  });

  it("keeps a panel edit isolated to that panel", () => {
    const [first, second] = defaultPanels("song");
    useStudyStore.setState({ panels: [first!, second!], selectedPanelId: null });
    useStudyStore.getState().updatePanel(first!.id, { grain: "chord" });
    const panels = useStudyStore.getState().panels;
    expect(panels[0]!.grain).toBe("chord");
    expect(panels[1]!.grain).toBe(second!.grain);
  });
});
