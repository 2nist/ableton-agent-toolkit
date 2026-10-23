import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The target replaced the old `clockSource` setting, so an existing user's
 * choice has to survive the upgrade: "ableton" meant following Live, and
 * "internal" meant the app's own clock with live MIDI out — which is "other"
 * now. Losing that to a default would silently change what pressing Play does.
 */

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

async function freshStore() {
  vi.resetModules();
  const mod = await import("./dawTargetStore");
  return mod.useDawTargetStore;
}

describe("dawTargetStore", () => {
  beforeEach(() => {
    backingStorage.clear();
  });

  it("starts on the other-DAW target — the app's own clock, as it always did", async () => {
    const store = await freshStore();
    expect(store.getState().target).toBe("other");
  });

  it("migrates a legacy 'ableton' clock choice to the Live target", async () => {
    backingStorage.setItem("trackdraft-clock-source", "ableton");
    const store = await freshStore();
    expect(store.getState().target).toBe("live");
  });

  it("migrates a legacy 'internal' clock choice to the other-DAW target", async () => {
    backingStorage.setItem("trackdraft-clock-source", "internal");
    const store = await freshStore();
    expect(store.getState().target).toBe("other");
  });

  it("prefers the new key once one has been written", async () => {
    backingStorage.setItem("trackdraft-clock-source", "ableton");
    backingStorage.setItem("trackdraft-daw-target", "file");
    const store = await freshStore();
    expect(store.getState().target).toBe("file");
  });

  it("persists a change", async () => {
    const store = await freshStore();
    store.getState().setTarget("live");
    const reloaded = await freshStore();
    expect(reloaded.getState().target).toBe("live");
  });
});
