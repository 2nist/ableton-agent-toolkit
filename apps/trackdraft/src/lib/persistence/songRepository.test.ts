import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { BlueprintSong } from "../../types/blueprint";
import type { TrackDraftHost } from "../host";
import { createBrowserRepository, createDiskRepository, createIndexedDbRepository } from "./songRepository";
import * as songDb from "./songDb";
import { closeSongDb } from "./songDb";
import { subscribeStorageFailure } from "../../store/storage";

const song = (id: string, bpm = 120): BlueprintSong =>
  ({ id, title: id, bpm }) as unknown as BlueprintSong;

/** The desktop host's library surface is all the disk adapter touches. */
function fakeHost(initial: BlueprintSong[]) {
  const writes: string[] = [];
  const deletes: string[] = [];
  const host = {
    libraryLoad: async () => ({ songs: initial, seeded: 0, unreadable: 0, dir: "/library", distribution: "release" }),
    libraryWrite: async (s: unknown) => {
      writes.push((s as BlueprintSong).id);
      return { ok: true };
    },
    libraryDelete: async (id: string) => {
      deletes.push(id);
      return { ok: true };
    },
  } as unknown as TrackDraftHost;
  return { host, writes, deletes };
}

beforeEach(() => {
  // Only the debounce is faked: fake-indexeddb schedules its own work on
  // `setImmediate`/microtasks, and faking those deadlocks every transaction.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("disk repository", () => {
  it("loads the library from the host directory", async () => {
    const { host } = fakeHost([song("a"), song("b")]);
    const repo = createDiskRepository(host);
    expect(repo.kind).toBe("disk");
    expect((await repo.load()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("writes only the songs that changed, and deletes what left the library", async () => {
    const { host, writes, deletes } = fakeHost([song("a"), song("b")]);
    const repo = createDiskRepository(host);
    const loaded = await repo.load();

    // An edit replaces exactly one object; the other is untouched.
    const edited = [loaded[0], song("b", 140)];
    repo.scheduleSave(edited);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual(["b"]);

    // A deletion diffs against what was last synced.
    repo.scheduleSave([edited[1]]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(deletes).toEqual(["a"]);
  });

  it("writes nothing when an edit does not change any song object", async () => {
    const { host, writes } = fakeHost([song("a")]);
    const repo = createDiskRepository(host);
    const loaded = await repo.load();
    repo.scheduleSave([...loaded]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
  });

  it("flushes immediately, cancelling the pending debounce", async () => {
    const { host, writes } = fakeHost([song("a")]);
    const repo = createDiskRepository(host);
    await repo.load();

    repo.scheduleSave([song("a", 90)]);
    repo.flush([song("a", 100)]);
    await vi.advanceTimersByTimeAsync(2000);
    // The debounced 90 must not land after the flush's 100.
    expect(writes).toEqual(["a"]);
  });

  it("coalesces rapid edits into one write", async () => {
    const { host, writes } = fakeHost([song("a")]);
    const repo = createDiskRepository(host);
    await repo.load();

    repo.scheduleSave([song("a", 101)]);
    repo.scheduleSave([song("a", 102)]);
    repo.scheduleSave([song("a", 103)]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual(["a"]);
  });

  it("reports a failed write instead of losing it silently", async () => {
    // This is the shipped build's only save path: a swallowed error meant
    // the user kept editing a song that was no longer being written.
    const { host } = fakeHost([song("a")]);
    (host as unknown as { libraryWrite: () => Promise<unknown> }).libraryWrite = async () => {
      throw new Error("ENOSPC: no space left on device");
    };
    const repo = createDiskRepository(host);
    await repo.load();

    const seen: (string | null)[] = [];
    const unsubscribe = subscribeStorageFailure((failure) => seen.push(failure?.message ?? null));
    repo.scheduleSave([song("a", 140)]);
    await vi.advanceTimersByTimeAsync(2000);
    unsubscribe();

    expect(seen).toContain("ENOSPC: no space left on device");
  });

  it("clears the warning once a later write succeeds", async () => {
    const { host } = fakeHost([song("a")]);
    let fail = true;
    (host as unknown as { libraryWrite: () => Promise<unknown> }).libraryWrite = async () => {
      if (fail) throw new Error("locked");
      return { ok: true };
    };
    const repo = createDiskRepository(host);
    await repo.load();

    const seen: (string | null)[] = [];
    const unsubscribe = subscribeStorageFailure((failure) => seen.push(failure ? "failed" : "clear"));

    repo.scheduleSave([song("a", 140)]);
    await vi.advanceTimersByTimeAsync(2000);
    fail = false;
    repo.scheduleSave([song("a", 141)]);
    await vi.advanceTimersByTimeAsync(2000);
    unsubscribe();

    expect(seen).toEqual(["failed", "clear"]);
  });

  it("keeps the host's unreadable count for the dashboard to surface", async () => {
    const { host } = fakeHost([]);
    const withBroken = {
      ...(host as unknown as Record<string, unknown>),
      libraryLoad: async () => ({ songs: [], seeded: 0, unreadable: 3, dir: "/library", distribution: "release" }),
    } as unknown as TrackDraftHost;
    const repo = createDiskRepository(withBroken);

    expect(repo.lastLoad()).toBeNull();
    await repo.load();
    expect(repo.lastLoad()).toMatchObject({ unreadable: 3, dir: "/library" });
  });
});

describe("browser repository", () => {
  it("round-trips the library through localStorage", async () => {
    const backing = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => backing.set(k, v),
      removeItem: (k: string) => backing.delete(k),
    });

    const repo = createBrowserRepository();
    expect(repo.kind).toBe("browser");
    expect(await repo.load()).toEqual([]);

    repo.scheduleSave([song("a", 128)]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(backing.get("trackdraft-songs")!)[0].bpm).toBe(128);
    expect(await repo.load()).toHaveLength(1);
  });

  it("keeps the current-song pointer outside the songs key", () => {
    const backing = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => backing.set(k, v),
      removeItem: (k: string) => backing.delete(k),
    });

    const repo = createBrowserRepository();
    repo.writeCurrentId("song-7");
    expect(repo.readCurrentId()).toBe("song-7");
    expect(backing.has("trackdraft-songs")).toBe(false);
  });
});

describe("indexeddb repository", () => {
  /** A fresh database per test: fake-indexeddb keeps its state in a global
   *  singleton, so leaking one test's songs into the next would make the
   *  "migrates a legacy library" case pass for the wrong reason. */
  async function freshDb(): Promise<void> {
    closeSongDb();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("trackdraft-library");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  /** Let IndexedDB finish committing: the debounced persist is async, so
   *  advancing the fake clock only *starts* the write. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  function stubLocalStorage(initial: Record<string, string> = {}) {
    const backing = new Map<string, string>(Object.entries(initial));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => backing.set(k, v),
      removeItem: (k: string) => backing.delete(k),
    });
    return backing;
  }

  beforeEach(async () => {
    await freshDb();
  });

  afterEach(async () => {
    await freshDb();
  });

  it("round-trips the library and keeps its order", async () => {
    stubLocalStorage();
    const repo = createIndexedDbRepository();
    expect(await repo.load()).toEqual([]);

    repo.scheduleSave([song("c"), song("a"), song("b")]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    // Reload through a new repository: order is the array's, not the key's.
    expect((await createIndexedDbRepository().load()).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("migrates a legacy localStorage library and then frees the key", async () => {
    const backing = stubLocalStorage({ "trackdraft-songs": JSON.stringify([song("a", 128), song("b")]) });

    const loaded = await createIndexedDbRepository().load();

    expect(loaded.map((s) => s.id)).toEqual(["a", "b"]);
    expect(loaded[0].bpm).toBe(128);
    expect(backing.has("trackdraft-songs")).toBe(false);
    // Second load comes from the database, not the (now gone) key.
    expect((await createIndexedDbRepository().load()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("keeps the legacy key when only some songs landed", async () => {
    const legacy = [song("a"), song("b"), song("c")];
    const backing = stubLocalStorage({ "trackdraft-songs": JSON.stringify(legacy) });
    // Fail the batch halfway: the complete copy must survive.
    vi.spyOn(songDb, "writeSongRecords").mockResolvedValueOnce(undefined);

    const repo = createIndexedDbRepository();
    expect((await repo.load()).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(backing.has("trackdraft-songs")).toBe(true);
  });

  it("writes only the songs that changed, and deletes what left the library", async () => {
    stubLocalStorage();
    const repo = createIndexedDbRepository();
    await repo.load();

    const edited = [song("a"), song("b", 140)];
    repo.scheduleSave(edited);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    const records = await songDb.readSongRecords();
    expect(records.map((r) => [r.id, r.song.bpm])).toEqual([
      ["a", 120],
      ["b", 140],
    ]);

    repo.scheduleSave([edited[1]]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect((await songDb.readSongRecords()).map((r) => r.id)).toEqual(["b"]);
    expect((await songDb.readSongRecords())[0].order).toBe(0);
  });

  it("holds a library far past the localStorage ceiling", async () => {
    stubLocalStorage();
    const repo = createIndexedDbRepository();
    await repo.load();

    // ~5MB of song data: bigger than the key that used to fail, and the old
    // adapter could never have written it.
    const big = Array.from({ length: 120 }, (_, i) => ({
      ...song(`big-${i}`),
      lyrics: "la la la ".repeat(5000),
    })) as unknown as BlueprintSong[];
    expect(JSON.stringify(big).length).toBeGreaterThan(5_000_000);

    repo.scheduleSave(big);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    const seen: (string | null)[] = [];
    const unsubscribe = subscribeStorageFailure((failure) => seen.push(failure?.message ?? null));
    unsubscribe();
    expect(seen).toEqual([]);
    expect(await songDb.countSongRecords()).toBe(120);
  });

  it("reports a failed write instead of losing it silently", async () => {
    stubLocalStorage();
    const repo = createIndexedDbRepository();
    await repo.load();
    vi.spyOn(songDb, "writeSongRecords").mockRejectedValueOnce(new Error("QuotaExceededError"));

    const seen: (string | null)[] = [];
    const unsubscribe = subscribeStorageFailure((failure) => seen.push(failure?.message ?? null));
    repo.scheduleSave([song("a", 140)]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    unsubscribe();

    expect(seen).toContain("QuotaExceededError");
  });

  it("falls back to the legacy key when the database cannot be opened", async () => {
    const backing = stubLocalStorage({ "trackdraft-songs": JSON.stringify([song("a", 128)]) });
    vi.spyOn(songDb, "readSongRecords").mockRejectedValueOnce(new Error("SecurityError"));

    const repo = createIndexedDbRepository();
    expect((await repo.load()).map((s) => s.id)).toEqual(["a"]);

    // And the fallback keeps writing there, so the library still persists.
    repo.scheduleSave([song("a", 132)]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(backing.get("trackdraft-songs")!)[0].bpm).toBe(132);
  });
});

describe("indexeddb repository: telling other tabs", () => {
  async function freshDb(): Promise<void> {
    closeSongDb();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("trackdraft-library");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  /** BroadcastChannel delivers on the real event loop, which the fake
   *  timers in this file do not advance — so drain it with setImmediate. */
  const drainChannel = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    await freshDb();
  });

  afterEach(async () => {
    await freshDb();
  });

  it("announces what it wrote, so another tab can refresh just that song", async () => {
    const writer = createIndexedDbRepository();
    const reader = createIndexedDbRepository();
    await writer.load();
    await reader.load();

    const seen: string[][] = [];
    reader.subscribeExternalChanges((ids) => seen.push(ids));

    writer.scheduleSave([song("a", 140)]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    await drainChannel();

    expect(seen).toEqual([["a"]]);
    // The broadcasting tab does not hear itself — no refresh loop.
    expect((await reader.readSongs(["a"]))[0].bpm).toBe(140);
  });

  it("announces deletions too, so a stale tab drops the song", async () => {
    const writer = createIndexedDbRepository();
    await writer.load();
    // Same object identities as the next save, so only the deletion is news.
    const a = song("a");
    writer.scheduleSave([a, song("b")]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    // Drain the first save's announcement before the reader exists, or it
    // arrives as a stale "change" the moment the reader subscribes.
    await drainChannel();

    const reader = createIndexedDbRepository();
    await reader.load();
    const seen: string[][] = [];
    reader.subscribeExternalChanges((ids) => seen.push(ids));

    writer.scheduleSave([a]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    await drainChannel();

    expect(seen).toEqual([["b"]]);
    expect(await reader.readSongs(["b"])).toEqual([]);
  });

  it("knows when an edit is still waiting on the debounce", async () => {
    const repo = createIndexedDbRepository();
    await repo.load();
    expect(repo.hasPendingWrite()).toBe(false);

    repo.scheduleSave([song("a", 130)]);
    expect(repo.hasPendingWrite()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(repo.hasPendingWrite()).toBe(false);
  });

  it("renumbers a gapped order table, so an append cannot collide with it", async () => {
    // A deletion made outside this adapter (a restore, a hand-edited
    // database) leaves a hole. The store appends by array index, so without
    // renumbering a new song lands on an order another song already holds and
    // the library reorders itself depending on how IndexedDB iterates.
    await songDb.writeSongRecords([
      { id: "a", order: 0, song: song("a") },
      { id: "b", order: 1, song: song("b") },
      { id: "c", order: 5, song: song("c") },
    ]);

    const repo = createIndexedDbRepository();
    expect((await repo.load()).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect((await songDb.readSongRecords()).map((record) => record.order)).toEqual([0, 1, 2]);

    // The next append takes index 3 — and nothing already holds it.
    repo.scheduleSave([song("a"), song("b"), song("c"), song("d")]);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    const orders = (await songDb.readSongRecords()).map((record) => [record.id, record.order]);
    expect(orders).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });
});
