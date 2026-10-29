/**
 * The song library's persistence seam.
 *
 * TrackDraft keeps its library in two very different places: `localStorage` in
 * a browser, and one JSON file per song in the desktop app's library
 * directory. Both were implemented inline in `songStore`, which meant the
 * store asked `getHost()` on every save and every load, and a third place
 * (the directory browser) made the same decision again. A store that branches
 * on its host cannot be tested for the other branch, and the desktop path
 * (the one that ships) was the one never exercised.
 *
 * So: one interface, two adapters, chosen once at module load. The store
 * writes to a repository and never asks where it is.
 */

import type { BlueprintSong } from "../../types/blueprint";
import { getHost } from "../host";
import { createDebouncedWriter, readRawStorage, readStorage, writeRawStorage } from "../../store/storage";

const SONGS_KEY = "trackdraft-songs";
const CURRENT_ID_KEY = "trackdraft-current-song-id";
const AUTOSAVE_DEBOUNCE_MS = 1500;

export type SongRepositoryKind = "browser" | "disk";

export interface SongRepository {
  /** Where the library actually lives — shown in diagnostics, never branched on. */
  readonly kind: SongRepositoryKind;
  /** Every song in the library. */
  load(): Promise<BlueprintSong[]>;
  /** Coalesced write: called on every edit, persists after the debounce. */
  scheduleSave(songs: BlueprintSong[]): void;
  /** Write now, cancelling any pending schedule (undo/redo, page hide). */
  flush(songs: BlueprintSong[]): void;
  /** The song the app should reopen. Shared by both adapters — it is a
   *  pointer, not data, so it never needs the disk. */
  readCurrentId(): string | null;
  writeCurrentId(id: string): void;
}

/** The current-song pointer is host-independent: a few bytes in localStorage
 *  either way, and it must survive a library directory move. */
const currentId: Pick<SongRepository, "readCurrentId" | "writeCurrentId"> = {
  readCurrentId: () => readRawStorage(CURRENT_ID_KEY),
  writeCurrentId: (id) => writeRawStorage(CURRENT_ID_KEY, id),
};

/** Browser: the whole library as one JSON array under one key. */
export function createBrowserRepository(): SongRepository {
  const writer = createDebouncedWriter<BlueprintSong[]>(SONGS_KEY, AUTOSAVE_DEBOUNCE_MS);
  return {
    ...currentId,
    kind: "browser",
    load: async () => readStorage<BlueprintSong[]>(SONGS_KEY, []),
    scheduleSave: (songs) => writer.write(songs),
    flush: (songs) => writer.flush(songs),
  };
}

/** Desktop: one file per song, written only when the object changed.
 *
 *  Songs are immutable — every edit replaces one — so identity is enough to
 *  know what to rewrite, and 182 catalogue files per keystroke would be
 *  absurd. Deletions are diffed the same way. The previously synced array is
 *  held in this closure rather than a module-level variable so two
 *  repositories (the app's, and a test's) cannot see each other's state.
 */
export function createDiskRepository(host: NonNullable<ReturnType<typeof getHost>>): SongRepository {
  let synced: BlueprintSong[] | null = null;

  async function sync(songs: BlueprintSong[]): Promise<void> {
    const previousById = new Map((synced ?? []).map((song) => [song.id, song]));
    const nextIds = new Set(songs.map((song) => song.id));
    try {
      for (const song of songs) {
        if (previousById.get(song.id) !== song) await host.libraryWrite(song);
      }
      for (const song of synced ?? []) {
        if (!nextIds.has(song.id)) await host.libraryDelete(song.id);
      }
      synced = songs;
    } catch {
      // Persistence must never break an edit; a host write failure surfaces
      // on the next load.
    }
  }

  const writer = createDebouncedWriter<BlueprintSong[]>("host-library", AUTOSAVE_DEBOUNCE_MS, (songs) => {
    void sync(songs);
  });

  return {
    ...currentId,
    kind: "disk",
    load: async () => {
      const library = await host.libraryLoad();
      const songs = library.songs as BlueprintSong[];
      synced = songs;
      return songs;
    },
    scheduleSave: (songs) => writer.write(songs),
    flush: (songs) => writer.flush(songs),
  };
}

/** The repository this process should use. Called once by `songStore`. */
export function createSongRepository(): SongRepository {
  const host = getHost();
  return host ? createDiskRepository(host) : createBrowserRepository();
}
