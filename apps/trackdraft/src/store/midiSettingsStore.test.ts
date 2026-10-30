import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The MIDI settings store changed shape: `channels: { drums: 1, ... }` became
 * `routing: { drums: { channel: 1 }, ... }` so the file export and live MIDI
 * out can share one description per stem. A user who has already wired their
 * template must not lose that wiring to a silent reset — these prove the
 * stored blob is migrated rather than discarded.
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

const KEY = "trackdraft-midi-settings";

/** A fresh store instance, so the module-level "read once on import" logic
 *  actually re-reads `backingStorage` (same as reopening the app). */
async function freshStore() {
  vi.resetModules();
  const mod = await import("./midiSettingsStore");
  return mod.useMidiSettingsStore;
}

describe("midiSettingsStore — persisted shape", () => {
  beforeEach(() => {
    backingStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("migrates the old channels-only blob onto the Live profile", async () => {
    backingStorage.setItem(
      KEY,
      JSON.stringify({ midiOutputId: "port-1", channels: { drums: 1, bass: 7, chords: 3, color: 4, melody: 5 } }),
    );

    const store = await freshStore();
    const state = store.getState();

    expect(state.midiOutputId).toBe("port-1");
    // The user's bass channel survives...
    expect(state.routing.bass.channel).toBe(7);
    // ...and stems it never saved keep the Live template defaults.
    expect(state.routing.drums.channel).toBe(1);
    expect(state.routing.melody.channel).toBe(5);
    // Legacy blobs carried no instrument metadata, so none is invented: the
    // Live profile leaves instrument naming to the song.
    expect(state.routing.bass.instrumentName).toBeUndefined();
  });

  it("defaults to the Live template channels, not General MIDI", async () => {
    const store = await freshStore();
    const { routing } = store.getState();
    // Live out streams drum machine kits on the kit track — channel 1.
    // General MIDI's channel 10 belongs to the *export* profile only.
    expect(routing.drums.channel).toBe(1);
    expect(routing.chords.channel).toBe(3);
  });

  it("persists per-stem output ports (external hardware) and clears them", async () => {
    const store = await freshStore();
    store.getState().setStemOutput("drums", "hw-drums");
    store.getState().setStemOutput("bass", "hw-bass");

    const reloaded = await freshStore();
    expect(reloaded.getState().stemOutputs).toEqual({ drums: "hw-drums", bass: "hw-bass" });

    // Emptying an override means "follow the master" — not "remember an
    // empty port" that the resolver would have to special-case.
    reloaded.getState().setStemOutput("bass", "");
    expect(reloaded.getState().stemOutputs).toEqual({ drums: "hw-drums" });
  });

  it("ignores a saved stem key the app does not know", async () => {
    backingStorage.setItem(
      KEY,
      JSON.stringify({
        midiOutputId: "m",
        stemOutputs: { drums: "hw-drums", kazoo: "hw-kazoo" },
        latencyMs: 0,
      }),
    );
    const store = await freshStore();
    expect(store.getState().stemOutputs).toEqual({ drums: "hw-drums" });
  });

  it("keeps hardware routing when a channel preset is applied", async () => {
    // Presets rewrite channels + instrument hints; which physical port a
    // stem leaves on is wiring, not a preset.
    const store = await freshStore();
    store.getState().setStemOutput("drums", "hw-drums");
    store.getState().applyProfile("gm");
    expect(store.getState().stemOutputs).toEqual({ drums: "hw-drums" });
  });

  it("persists channel and latency edits", async () => {
    const store = await freshStore();
    store.getState().setChannel("drums", 10);
    store.getState().setLatencyMs(40);

    const reloaded = await freshStore();
    expect(reloaded.getState().routing.drums.channel).toBe(10);
    expect(reloaded.getState().latencyMs).toBe(40);
  });

  it("changing a channel keeps that stem's instrument metadata", async () => {
    // The exported program change / instrument name come from the routing
    // object, so a channel edit must not replace it wholesale — losing the
    // program would silently fall back to "no program" in the .mid.
    const store = await freshStore();
    store.getState().applyProfile("gm");
    const before = store.getState().routing.bass;
    store.getState().setChannel("bass", 11);

    const after = store.getState().routing.bass;
    expect(after.channel).toBe(11);
    expect(after.gmProgram).toBe(before.gmProgram);
    expect(after.instrumentName).toBe(before.instrumentName);
  });

  it("clamps channels and latency into range", async () => {
    const store = await freshStore();
    store.getState().setChannel("bass", 99);
    store.getState().setLatencyMs(9_999);
    expect(store.getState().routing.bass.channel).toBe(16);
    expect(store.getState().latencyMs).toBe(500);
  });

  it("a preset applies its whole profile, channels and instrument hints", async () => {
    const store = await freshStore();

    store.getState().applyProfile("gm");
    // GM moves drums to channel 10 and names each stem's sound.
    expect(store.getState().routing.drums.channel).toBe(10);
    expect(store.getState().routing.chords.gmProgram).toBe(1);

    store.getState().applyProfile("live");
    expect(store.getState().routing.drums.channel).toBe(1);
    // The Live template supplies its own devices, so GM hints don't linger.
    expect(store.getState().routing.chords.gmProgram).toBeUndefined();
  });
});
