import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fromBlueprintSong, classifyNarrative, NARRATIVE_FORMS } from "@music-theory/song-taxonomy";
import type { BlueprintSong } from "../types/blueprint";

/**
 * Step 4 of the repair-and-measure plan: prove a real repaired catalog
 * song survives undo/redo/save/reload against the *actual* production
 * store (`songStore.ts`), not a script's approximation of it. Everything
 * up to this test exercised `sectionize.ts`'s pure functions directly or
 * through a throwaway Node script — never through the Zustand store that
 * every real edit in the app actually flows through.
 */

/** songStore.ts calls `localStorage` directly with no injection point, and
 *  Node has no such global — a minimal in-memory polyfill, shared across
 *  the "before" and "after reload" store instances below (a real reload
 *  keeps the same physical storage, just a fresh in-memory app state). */
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

const backingStorage = new MemoryStorage();
vi.stubGlobal("localStorage", backingStorage);

/** A fresh Zustand module instance — `vi.resetModules()` + a dynamic
 *  re-import discards all in-memory store state, the same way closing and
 *  reopening the app would, while `backingStorage` (module-external)
 *  persists across the reset exactly like real `localStorage` would. */
async function freshStore() {
  vi.resetModules();
  const mod = await import("./songStore");
  return mod.useSongStore;
}

describe("songStore — real repaired catalog song survives undo/redo/save/reload", () => {
  beforeEach(() => {
    backingStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a real repaired song through the actual store", async () => {
    const catalogPath = path.join(
      import.meta.dirname,
      "../../scripts/output/catalog/beatles-16-the-end.trackdraft.json",
    );
    const repairedSong: BlueprintSong = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    // Sanity: this is genuinely the repaired shape (chorus consolidation
    // ran on this exact song in Step 3), not the pre-repair single blob.
    expect(repairedSong.sections.some((s) => s.name.startsWith("Chorus"))).toBe(true);

    const store1 = await freshStore();
    store1.getState().importSong(repairedSong);
    const beforeOp = store1.getState().currentSong();
    expect(beforeOp).not.toBeNull();

    // A real store-driven edit, same mechanism any UI action uses.
    store1.getState().updateCurrentSong((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.name === "Chorus 1" ? { ...sec, velocity: "ff" as const } : sec)),
    }));
    const afterOp = store1.getState().currentSong()!;
    expect(afterOp.sections.find((s) => s.name === "Chorus 1")?.velocity).toBe("ff");

    store1.getState().undo();
    expect(store1.getState().currentSong()).toEqual(beforeOp);

    store1.getState().redo();
    expect(store1.getState().currentSong()).toEqual(afterOp);

    // autoSave is debounced 1.5s — advance fake timers past it.
    store1.getState().autoSave();
    await vi.advanceTimersByTimeAsync(2000);

    const persisted = JSON.parse(backingStorage.getItem("trackdraft-songs")!);
    const persistedSong = persisted.find((s: BlueprintSong) => s.id === repairedSong.id);
    expect(persistedSong).toEqual(afterOp);

    // A real reload: fresh module, fresh Zustand instance, same backing storage.
    const store2 = await freshStore();
    store2.getState().loadFromStorage();
    const reloaded = store2.getState().currentSong();
    expect(reloaded).toEqual(afterOp);

    // Repair didn't corrupt anything reload-side — it still classifies.
    const match = classifyNarrative(fromBlueprintSong(reloaded!), NARRATIVE_FORMS);
    expect(match.formId).not.toBeNull();
  });
});
