import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlueprintSong } from "../../types/blueprint";
import type { TrackDraftHost } from "../host";
import { createBrowserRepository, createDiskRepository } from "./songRepository";

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
  vi.useFakeTimers();
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
