import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportTick } from "./songTransport";

/** Stand-in for the transport: tests fire ticks at whatever rate they want. */
const fake = vi.hoisted(() => {
  const listeners = new Set<(tick: TransportTick) => void>();
  return {
    listeners,
    transport: {
      onTick(cb: (tick: TransportTick) => void) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
  };
});
vi.mock("./songTransport", () => ({ getSongTransport: () => fake.transport }));

function fire(beat: number, isPlaying = true, extra: Partial<TransportTick> = {}): void {
  const tick: TransportTick = {
    beat,
    isPlaying,
    sectionIndex: 0,
    sectionId: "s1",
    occurrenceIndex: 0,
    ...extra,
  };
  for (const cb of [...fake.listeners]) cb(tick);
}

let store: typeof import("./playheadStore");

beforeEach(async () => {
  fake.listeners.clear();
  // The store is a module singleton (one transport subscription for the
  // page); resetting the module is what gives each test its own.
  vi.resetModules();
  store = await import("./playheadStore");
});

describe("playhead store", () => {
  it("collapses a 60 fps stream into grid steps", () => {
    const seen: number[] = [];
    const off = store.subscribePlayhead(() => seen.push(store.getPlayheadSnapshot().beat));

    // One second of frames at 60 fps, 120 bpm → 2 beats.
    for (let i = 0; i <= 60; i += 1) fire(i / 30);
    off();

    // 2 beats at a sixteenth = 8 steps, plus the initial idle → playing
    // change. Nowhere near 61.
    expect(seen.length).toBeLessThanOrEqual(10);
    expect(seen).toContain(2);
  });

  it("reports every discrete change, however small the beat move", () => {
    let calls = 0;
    const off = store.subscribePlayhead(() => (calls += 1));
    fire(4, true);
    fire(4, false); // stopped at the same beat — must still land
    off();
    expect(calls).toBe(2);
    expect(store.getPlayheadSnapshot().isPlaying).toBe(false);
  });

  it("lands the final stop tick at the top of the song", () => {
    const off = store.subscribePlayhead(() => {});
    fire(9.4, true);
    fire(0, false); // stop() emits beat 0
    off();
    const snapshot = store.getPlayheadSnapshot();
    expect(snapshot.beat).toBe(0);
    expect(snapshot.isPlaying).toBe(false);
  });

  it("carries the section identity for consumers resolving by id", () => {
    const off = store.subscribePlayhead(() => {});
    fire(5.2, true, { sectionId: "chorus", occurrenceIndex: 2, sectionIndex: 3 });
    off();
    expect(store.getPlayheadSnapshot()).toMatchObject({
      sectionId: "chorus",
      occurrenceIndex: 2,
      sectionIndex: 3,
    });
  });

  it("delivers every frame to imperative consumers", () => {
    const beats: number[] = [];
    const off = store.subscribePlayheadFrames((beat) => beats.push(beat));
    for (let i = 0; i < 10; i += 1) fire(i / 8);
    off();
    expect(beats).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.125]);
  });

  it("holds one transport subscription for any number of consumers", () => {
    const offA = store.subscribePlayhead(() => {});
    const offB = store.subscribePlayhead(() => {});
    const offC = store.subscribePlayheadFrames(() => {});
    expect(fake.listeners.size).toBe(1);
    offA();
    offB();
    expect(fake.listeners.size).toBe(1); // the frame consumer is still there
    offC();
    expect(fake.listeners.size).toBe(0); // nothing left → fully detached
  });

  it("survives a throwing listener", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: boolean[] = [];
    const offA = store.subscribePlayhead(() => {
      throw new Error("boom");
    });
    const offB = store.subscribePlayhead(() => seen.push(true));
    fire(1, true);
    offA();
    offB();
    spy.mockRestore();
    expect(seen).toHaveLength(1);
  });
});
