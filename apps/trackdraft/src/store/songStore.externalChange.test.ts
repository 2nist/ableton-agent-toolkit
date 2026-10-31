import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlueprintSong } from "../types/blueprint";

/**
 * Two tabs on one origin each hold their own snapshot of the library, so the
 * tab that happens to save last used to win silently — easy to hit with one
 * song open in two views. The repository broadcasts what it wrote; the store
 * takes those songs and nothing else. The cases below are the ones that
 * decide whether that is safe: don't touch what did not change, don't
 * resurrect what was deleted, and never refresh under an unsaved edit.
 *
 * The repository is mocked rather than driven through IndexedDB: what is
 * under test here is the store's merge policy, and the adapter's own
 * broadcast is covered in `lib/persistence/songRepository.test.ts`.
 */

const remote = {
  songs: [] as BlueprintSong[],
  pending: false,
  listeners: [] as ((ids: string[]) => void)[],
};

vi.mock("../lib/persistence/songRepository", () => ({
  createSongRepository: () => ({
    kind: "browser" as const,
    load: async () => remote.songs,
    lastLoad: () => null,
    scheduleSave: () => {},
    flush: () => {},
    readCurrentId: () => null,
    writeCurrentId: () => {},
    hasPendingWrite: () => remote.pending,
    subscribeExternalChanges: (listener: (ids: string[]) => void) => {
      remote.listeners.push(listener);
      return () => {};
    },
    readSongs: async (ids: string[]) => remote.songs.filter((song) => ids.includes(song.id)),
  }),
}));

const { useSongStore } = await import("./songStore");

const song = (id: string, bpm: number, title = id): BlueprintSong =>
  ({ id, title, bpm, key: "C", scale: "ionian", sections: [] }) as unknown as BlueprintSong;

/** Load the store the way the app does, from whatever the "other tab" has. */
async function load(songs: BlueprintSong[]): Promise<void> {
  remote.songs = songs.map((entry) => ({ ...entry }));
  await useSongStore.getState().hydrate();
}

beforeEach(() => {
  remote.pending = false;
  // `remote.listeners` is deliberately NOT cleared: the store subscribes once
  // at module load (that wiring is one of the things under test).
});

describe("taking a change from another tab", () => {
  it("replaces only the song that changed", async () => {
    await load([song("a", 120), song("b", 100)]);
    const untouched = useSongStore.getState().songs.find((entry) => entry.id === "b");

    remote.songs = [song("a", 140), song("b", 100)];
    await useSongStore.getState().applyExternalChange(["a"]);

    const songs = useSongStore.getState().songs;
    expect(songs.find((entry) => entry.id === "a")?.bpm).toBe(140);
    // Identity, not equality: the other song must not be disturbed at all.
    expect(songs.find((entry) => entry.id === "b")).toBe(untouched);
  });

  it("drops a song that was deleted elsewhere", async () => {
    await load([song("a", 120), song("b", 100)]);
    remote.songs = [song("a", 120)];
    await useSongStore.getState().applyExternalChange(["b"]);
    expect(useSongStore.getState().songs.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("shows a song another tab created", async () => {
    await load([song("a", 120)]);
    remote.songs = [song("a", 120), song("fresh", 90, "Written in the other tab")];
    await useSongStore.getState().applyExternalChange(["fresh"]);

    expect(useSongStore.getState().songs.map((entry) => entry.title)).toEqual(["a", "Written in the other tab"]);
  });

  it("refuses to refresh while this tab has an unpersisted edit", async () => {
    await load([song("a", 120)]);
    const before = useSongStore.getState().songs[0];

    remote.pending = true;
    remote.songs = [song("a", 999)];
    await useSongStore.getState().applyExternalChange(["a"]);

    // The local edit is about to be written; refreshing under it would
    // discard the typing the user is still doing.
    expect(useSongStore.getState().songs[0]).toBe(before);
    expect(useSongStore.getState().songs[0].bpm).toBe(120);
  });

  it("restarts the undo history when the open song changed elsewhere", async () => {
    await load([song("a", 120)]);
    useSongStore.getState().updateCurrentSong((current) => ({ ...current, bpm: 121 }));
    expect(useSongStore.getState().canUndo()).toBe(true);

    remote.songs = [song("a", 140)];
    await useSongStore.getState().applyExternalChange(["a"]);

    // Undo entries describe the pre-change lineage; keeping them would let an
    // undo resurrect content the other tab has already replaced.
    expect(useSongStore.getState().currentSong()?.bpm).toBe(140);
    expect(useSongStore.getState().canUndo()).toBe(false);
  });

  it("is wired to the repository at module load, so no component has to know", async () => {
    await load([song("a", 120)]);
    expect(remote.listeners).toHaveLength(1);

    remote.songs = [song("a", 150)];
    remote.listeners[0](["a"]);
    await vi.waitFor(() => expect(useSongStore.getState().songs[0].bpm).toBe(150));
  });
});
