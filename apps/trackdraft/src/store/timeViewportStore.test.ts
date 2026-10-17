import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushTimeViewportPersistence,
  resetTimeViewportForTests,
  TIME_VIEWPORT_KEY,
  useTimeViewportStore,
} from "./timeViewportStore";

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

const backing = new MemoryStorage();
vi.stubGlobal("localStorage", backing);

beforeEach(() => {
  backing.clear();
  resetTimeViewportForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("time viewport store", () => {
  it("clamps scale per depth", () => {
    const store = useTimeViewportStore.getState();
    store.setScale("song", 1);
    expect(useTimeViewportStore.getState().scales.song).toBe(2);
    store.setScale("section", 9999);
    expect(useTimeViewportStore.getState().scales.section).toBe(400);
  });

  it("walks the song ladder with zoomStep", () => {
    useTimeViewportStore.getState().setScale("song", 10);
    useTimeViewportStore.getState().zoomStep("song", 1);
    expect(useTimeViewportStore.getState().scales.song).toBe(14);
    useTimeViewportStore.getState().zoomStep("song", -1);
    expect(useTimeViewportStore.getState().scales.song).toBe(10);
  });

  it("tracks scroll in bars independently per depth", () => {
    useTimeViewportStore.getState().setScrollBar("song", 12.5);
    useTimeViewportStore.getState().setScrollBar("section", 3);
    expect(useTimeViewportStore.getState().scrollBars).toEqual({ song: 12.5, section: 3 });
  });

  it("ignores invalid snap values", () => {
    useTimeViewportStore.getState().setSnap(0.25);
    useTimeViewportStore.getState().setSnap(0.1);
    expect(useTimeViewportStore.getState().snap).toBe(0.25);
    useTimeViewportStore.getState().setSnap(1);
    expect(useTimeViewportStore.getState().snap).toBe(1);
  });

  it("persists scale and snap (not scroll) for the next session", () => {
    useTimeViewportStore.getState().setScale("section", 110);
    useTimeViewportStore.getState().setSnap(0.5);
    flushTimeViewportPersistence();
    const saved = JSON.parse(backing.getItem(TIME_VIEWPORT_KEY)!);
    expect(saved.scales.section).toBe(110);
    expect(saved.snap).toBe(0.5);
    expect(saved.scrollBars).toBeUndefined();
  });
});
