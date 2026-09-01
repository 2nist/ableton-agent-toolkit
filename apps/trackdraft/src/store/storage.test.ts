import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readStorage, readRawStorage, writeStorage, writeRawStorage, createDebouncedWriter } from "./storage";

/** Minimal in-memory localStorage polyfill (same pattern as
 *  songStore.repair.test.ts) — Node has no such global. */
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

describe("readStorage / writeStorage", () => {
  beforeEach(() => backing.clear());

  it("round-trips JSON values", () => {
    writeStorage("k", { a: 1, b: [2, 3] });
    expect(readStorage<{ a: number; b: number[] }>("k", { a: 0, b: [] })).toEqual({ a: 1, b: [2, 3] });
  });

  it("falls back on a missing key", () => {
    expect(readStorage("nope", 42)).toBe(42);
  });

  it("falls back on corrupt JSON instead of throwing", () => {
    backing.setItem("bad", "{not json");
    expect(readStorage("bad", "fallback")).toBe("fallback");
  });

  it("swallows write failures (quota / private mode) instead of throwing", () => {
    const original = backing.setItem;
    backing.setItem = () => {
      throw new Error("quota");
    };
    expect(() => writeStorage("k", { a: 1 })).not.toThrow();
    expect(() => writeRawStorage("k", "v")).not.toThrow();
    backing.setItem = original;
  });
});

describe("readRawStorage / writeRawStorage", () => {
  it("preserves the raw (non-JSON) format the id/clock keys use", () => {
    writeRawStorage("id", "song-1");
    expect(backing.getItem("id")).toBe("song-1");
    expect(readRawStorage("id")).toBe("song-1");
    expect(readRawStorage("missing")).toBeNull();
  });
});

describe("createDebouncedWriter", () => {
  beforeEach(() => {
    backing.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid writes into one persist after the debounce window", () => {
    const w = createDebouncedWriter<number[]>("songs", 1500);
    w.write([1]);
    w.write([1, 2]);
    w.write([1, 2, 3]);
    expect(backing.getItem("songs")).toBeNull(); // not yet persisted
    vi.advanceTimersByTime(1500);
    expect(JSON.parse(backing.getItem("songs")!)).toEqual([1, 2, 3]);
  });

  it("flush persists immediately and cancels any pending write", () => {
    const w = createDebouncedWriter<number[]>("songs", 1500);
    w.write([1]);
    w.flush([9]);
    expect(JSON.parse(backing.getItem("songs")!)).toEqual([9]);
    vi.advanceTimersByTime(5000);
    expect(JSON.parse(backing.getItem("songs")!)).toEqual([9]); // no late overwrite
  });
});
