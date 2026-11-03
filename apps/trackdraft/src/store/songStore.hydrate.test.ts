import {
  beforeAll,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { BlueprintSong } from "../types/blueprint";
import { songOpeningState } from "../lib/songOpening";

/**
 * `hydrated` was declared on the store, read by two render guards and **never
 * set to true anywhere** — so both `if (!hydrated) return null` branches were
 * dead code, and a song route that was not ready rendered nothing at all for
 * as long as the tab stayed open. These tests pin the flag to the one place
 * that can honestly set it: the end of a load attempt.
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

function makeSong(id: string): BlueprintSong {
  return {
    id,
    title: `Song ${id}`,
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: `${id}-s1`,
        name: "Intro",
        role: "intro",
        bars: 4,
        chords: [],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
    ],
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as BlueprintSong;
}

/** A fresh module graph, the way closing and reopening the app would give
 *  one: the store *and* the storage helper that flushes its debounced writes
 *  have to come from the same instance, or the test flushes a different
 *  registry's queue and the library it saved is invisible to the reload. */
async function freshModules() {
  vi.resetModules();
  const [songMod, storageMod] = await Promise.all([
    import("./songStore"),
    import("./storage"),
  ]);
  return {
    store: songMod.useSongStore,
    flush: storageMod.flushAllPendingWrites,
  };
}

describe("songStore — hydrated marks the end of a load attempt", () => {
  beforeAll(async () => {
    // The first import of the store pulls its whole module graph (parser
    // taxonomy, persistence, tables). Warm the transform cache once so the
    // individual cases are not paying for it inside a 5 s timeout.
    await freshModules();
  });

  beforeEach(() => {
    backingStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts un-hydrated, so nothing can claim a song is missing before it looks", async () => {
    const { store } = await freshModules();
    expect(store.getState().hydrated).toBe(false);
  });

  it("sets hydrated once the library has been read", async () => {
    const { store, flush } = await freshModules();
    store.getState().importSong(makeSong("a"));
    flush();
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().songs.map((s) => s.id)).toEqual(["a"]);
  });

  it("sets hydrated even when the library is empty", async () => {
    const { store } = await freshModules();
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().songs).toHaveLength(0);
  });

  it("leaves a valid deep link ready and a bogus one missing — never opening forever", async () => {
    const { store, flush } = await freshModules();
    store.getState().importSong(makeSong("known"));
    flush();
    await store.getState().hydrate();
    const { songs, hydrated, currentSongId } = store.getState();

    const facts = (songId: string) => ({
      hydrated,
      routedSongExists: songs.some((s) => s.id === songId),
      routedIsCurrent: currentSongId === songId,
    });
    expect(songOpeningState(facts("known"))).toBe("ready");
    expect(songOpeningState(facts("nope"))).toBe("missing");
  });
});
