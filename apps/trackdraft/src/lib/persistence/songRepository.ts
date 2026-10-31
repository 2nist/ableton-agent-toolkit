/**
 * The song library's persistence seam.
 *
 * TrackDraft keeps its library in three places: IndexedDB in a browser, one
 * JSON file per song in the desktop app's library directory, and — still — a
 * single `localStorage` key for browsers without IndexedDB. All were
 * implemented inline in `songStore`, which meant the store asked `getHost()`
 * on every save and every load, and a third place (the directory browser)
 * made the same decision again. A store that branches on its host cannot be
 * tested for the other branch, and the desktop path (the one that ships) was
 * the one never exercised.
 *
 * So: one interface, three adapters, chosen once at module load. The store
 * writes to a repository and never asks where it is.
 *
 * Why the browser adapter is IndexedDB and not one JSON string: localStorage
 * is capped at roughly 2.5M UTF-16 characters per origin, and the app
 * rewrites the entire library on every autosave. A corpus import (the rock
 * catalogue is 149 songs / 4.4MB) therefore poisoned the deadlock — the save
 * that would shrink the library was itself a save, so it could never
 * succeed, and a reload restored the oversized library. One record per song
 * with a disk-sized quota removes both halves of that.
 */

import type { BlueprintSong } from "../../types/blueprint";
import { getHost } from "../host";
import { createDebouncedWriter, readRawStorage, readStorage, writeRawStorage, clearStorageFailure, reportStorageFailure } from "../../store/storage";
import { countSongRecords, deleteSongRecords, readSongRecords, readSongRecordsByIds, writeSongRecords } from "./songDb";
import type { SongRecord } from "./songDb";
import { STORAGE_KEYS } from "../persistence/keys";

const SONGS_KEY = STORAGE_KEYS.songs.key;
const CURRENT_ID_KEY = STORAGE_KEYS.currentSongId.key;
const AUTOSAVE_DEBOUNCE_MS = 1500;
/** Storage-failure key for the desktop library — the same string the
 *  debounced writer is keyed on, so the banner names one thing. */
const LIBRARY_KEY = STORAGE_KEYS.libraryMirror.key;

export type SongRepositoryKind = "browser" | "disk";

/** Which storage the browser build actually ended up on. Persistence itself
 *  never branches on this — it exists so the Settings readout can say where
 *  the library lives instead of guessing. Deliberately not `SongRepositoryKind`:
 *  that is the UI-facing "browser | disk" split, and it cannot tell the two
 *  browser backends apart. */
export type LibraryBackend = "disk" | "indexeddb" | "localstorage";

let activeBackend: LibraryBackend = typeof indexedDB !== "undefined" ? "indexeddb" : "localstorage";

/** The backend chosen by `createSongRepository()`. Before that runs this
 *  reports what the browser would get, which is the truth in practice — the
 *  store creates its repository at module load. */
export function libraryBackend(): LibraryBackend {
  return activeBackend;
}

/** What the last load found beyond the songs themselves. The desktop host
 *  already knows how many files it could not parse — dropping that on the
 *  floor meant corrupt songs left the dashboard without a word. */
export interface LibraryLoadInfo {
  kind: SongRepositoryKind;
  /** Files present in the library that did not parse into a song. */
  unreadable: number;
  /** Songs copied in from the bundled pack on this launch (first run only). */
  seeded: number;
  /** The library directory, for the "open the folder" hint. Empty in a browser. */
  dir: string;
}

export interface SongRepository {
  /** Where the library actually lives — shown in diagnostics, never branched on. */
  readonly kind: SongRepositoryKind;
  /** Every song in the library. */
  load(): Promise<BlueprintSong[]>;
  /** What `load()` just found, or null before the first load. */
  lastLoad(): LibraryLoadInfo | null;
  /** Coalesced write: called on every edit, persists after the debounce. */
  scheduleSave(songs: BlueprintSong[]): void;
  /** Write now, cancelling any pending schedule (undo/redo, page hide). */
  flush(songs: BlueprintSong[]): void;
  /** The song the app should reopen. Shared by both adapters — it is a
   *  pointer, not data, so it never needs the disk. */
  readCurrentId(): string | null;
  writeCurrentId(id: string): void;
  /** Is an edit still waiting on the autosave debounce? */
  hasPendingWrite(): boolean;
  /**
   * Song ids another tab wrote or deleted. Several tabs on one origin each
   * hold their own snapshot; without this the tab that saves last silently
   * wins, which is easy to hit with a song open in two views at once.
   * Adapters that cannot be shared between tabs return a no-op.
   */
  subscribeExternalChanges(listener: (ids: string[]) => void): () => void;
  /** Read specific songs back, for applying an external change. */
  readSongs(ids: string[]): Promise<BlueprintSong[]>;
}

/** Disk and the legacy single-key adapter are not watched: the desktop app
 *  is one window, and localStorage already writes the whole array at once. */
const noExternalChanges: Pick<SongRepository, "hasPendingWrite" | "subscribeExternalChanges" | "readSongs"> = {
  hasPendingWrite: () => false,
  subscribeExternalChanges: () => () => {},
  readSongs: async (ids) => readStorage<BlueprintSong[]>(SONGS_KEY, []).filter((song) => ids.includes(song.id)),
};

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
    ...noExternalChanges,
    kind: "browser",
    load: async () => readStorage<BlueprintSong[]>(SONGS_KEY, []),
    // localStorage is one key: there is no per-song file that can fail to
    // parse, and nothing to seed.
    lastLoad: () => null,
    scheduleSave: (songs) => writer.write(songs),
    flush: (songs) => writer.flush(songs),
  };
}

/** Browser (preferred): one IndexedDB record per song.
 *
 *  Same diff as the disk adapter — songs are immutable, so object identity
 *  says what to rewrite — plus the array position, because IndexedDB iterates
 *  by key and the dashboard's order is user-authored. Writes go through one
 *  transaction per batch, so a save is all-or-nothing instead of the old
 *  behaviour where an oversized library lost the whole thing.
 *
 *  A library persisted by the previous single-key adapter is migrated on
 *  first load and the key is only removed once every song is verifiably in
 *  the database. If IndexedDB is unusable (private mode, an embedded webview,
 *  a second tab holding a schema upgrade) every entry point falls back to
 *  reading and writing that legacy key, so the browser build degrades to
 *  exactly its old behaviour rather than to a library that cannot load.
 */
export function createIndexedDbRepository(): SongRepository {
  let synced: BlueprintSong[] | null = null;
  let syncedOrder: string[] = [];
  /** Set when the database could not be opened, so the debounced writer stops
   *  retrying it and uses the legacy single-key path instead. */
  let unusable = false;
  /** Other tabs on this origin. A BroadcastChannel never delivers to the
   *  context that posted, so a save here cannot loop back as a "change". */
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("trackdraft-library") : null;
  const watchers = new Set<(ids: string[]) => void>();
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const ids = Array.isArray(event.data?.ids) ? (event.data.ids as string[]) : [];
      if (ids.length === 0) return;
      for (const watcher of watchers) watcher(ids);
    };
  }

  /** Songs written before IndexedDB existed. Only read once, and only ever
   *  deleted after `countSongRecords()` proves the migration landed. */
  async function migrateLegacy(): Promise<BlueprintSong[]> {
    const legacy = readStorage<BlueprintSong[]>(SONGS_KEY, []);
    if (!Array.isArray(legacy) || legacy.length === 0) return [];
    await writeSongRecords(legacy.map((song, order) => ({ id: song.id, order, song })));
    if ((await countSongRecords()) < legacy.length) {
      // Keep the legacy blob; a partial migration must not destroy the copy
      // that is still complete.
      return readStorage<BlueprintSong[]>(SONGS_KEY, []);
    }
    dropLegacyKeyIfCovered(new Set(legacy.map((song) => song.id)));
    return legacy;
  }

  function dropLegacyKeyIfCovered(ids: Set<string>): void {
    try {
      const legacy = readStorage<BlueprintSong[]>(SONGS_KEY, []);
      if (!Array.isArray(legacy) || legacy.length === 0) return;
      if (!legacy.every((song) => ids.has(song.id))) return;
      localStorage.removeItem(SONGS_KEY);
    } catch {
      // Nothing to free, or storage is unreadable — either way the library
      // itself is fine.
    }
  }

  const legacyWriter = createDebouncedWriter<BlueprintSong[]>(SONGS_KEY, AUTOSAVE_DEBOUNCE_MS);

  /**
   * Stored `order` must be the contiguous 0..n-1 the store's array index
   * means, or the two disagree: a gap left by a deletion (any deletion made
   * outside this adapter — a restore, a hand-edited database) lets a later
   * append land on an order an existing song already holds, and the library
   * then reorders itself depending on how IndexedDB happens to iterate.
   * Rewriting on load is one small transaction and keeps the invariant.
   */
  async function normaliseOrder(records: SongRecord[]): Promise<SongRecord[]> {
    if (records.every((record, index) => record.order === index)) return records;
    const normalised = records.map((record, index) => ({ ...record, order: index }));
    await writeSongRecords(normalised);
    return normalised;
  }

  async function sync(songs: BlueprintSong[]): Promise<void> {
    if (unusable) {
      legacyWriter.flush(songs);
      return;
    }
    try {
      const previousById = new Map((synced ?? []).map((song) => [song.id, song]));
      const nextIds = new Set(songs.map((song) => song.id));
      const writes = songs.flatMap((song, order) =>
        previousById.get(song.id) === song && syncedOrder[order] === song.id ? [] : [{ id: song.id, order, song }],
      );
      const removals = (synced ?? []).filter((song) => !nextIds.has(song.id)).map((song) => song.id);
      if (writes.length) await writeSongRecords(writes);
      if (removals.length) await deleteSongRecords(removals);
      synced = songs;
      syncedOrder = songs.map((song) => song.id);
      clearStorageFailure(SONGS_KEY);
      const touched = [...writes.map((record) => record.id), ...removals];
      if (touched.length > 0) channel?.postMessage({ ids: touched });
    } catch (error) {
      // Persistence must never break an edit, but it must not be silent
      // either — the banner offers the one action that still works.
      reportStorageFailure(SONGS_KEY, error);
    }
  }

  const writer = createDebouncedWriter<BlueprintSong[]>(SONGS_KEY, AUTOSAVE_DEBOUNCE_MS, (songs) => {
    void sync(songs);
  });

  return {
    ...currentId,
    kind: "browser",
    hasPendingWrite: () => writer.hasPending(),
    subscribeExternalChanges: (listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    readSongs: async (ids) => (await readSongRecordsByIds(ids)).map((record) => record.song),
    load: async () => {
      try {
        const records = await normaliseOrder(await readSongRecords());
        const songs = records.length > 0 ? records.map((record) => record.song) : await migrateLegacy();
        if (records.length > 0) dropLegacyKeyIfCovered(new Set(records.map((record) => record.id)));
        synced = songs;
        syncedOrder = songs.map((song) => song.id);
        return songs;
      } catch {
        unusable = true;
        return readStorage<BlueprintSong[]>(SONGS_KEY, []);
      }
    },
    lastLoad: () => null,
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
  let loadInfo: LibraryLoadInfo | null = null;

  async function sync(songs: BlueprintSong[]): Promise<void> {
    const previousById = new Map((synced ?? []).map((song) => [song.id, song]));
    const nextIds = new Set(songs.map((song) => song.id));
    try {
      for (const song of songs) {
        if (previousById.get(song.id) === song) continue;
        const written = await host.libraryWrite(song);
        if (written?.ok === false) throw new Error(`the library refused to save "${song.title || song.id}"`);
      }
      for (const song of synced ?? []) {
        if (!nextIds.has(song.id)) await host.libraryDelete(song.id);
      }
      synced = songs;
      clearStorageFailure(LIBRARY_KEY);
    } catch (error) {
      // Persistence must never break an edit — but it must not be silent
      // either. This is the shipped (desktop) build's only save path, so a
      // swallowed failure here meant the user kept editing a song that was
      // no longer being written, with nothing on screen to say so.
      reportStorageFailure(LIBRARY_KEY, error);
    }
  }

  const writer = createDebouncedWriter<BlueprintSong[]>(LIBRARY_KEY, AUTOSAVE_DEBOUNCE_MS, (songs) => {
    void sync(songs);
  });

  return {
    ...currentId,
    ...noExternalChanges,
    hasPendingWrite: () => writer.hasPending(),
    kind: "disk",
    load: async () => {
      const library = await host.libraryLoad();
      const songs = library.songs as BlueprintSong[];
      synced = songs;
      loadInfo = {
        kind: "disk",
        unreadable: library.unreadable ?? 0,
        seeded: library.seeded ?? 0,
        dir: library.dir ?? "",
      };
      return songs;
    },
    lastLoad: () => loadInfo,
    scheduleSave: (songs) => writer.write(songs),
    flush: (songs) => writer.flush(songs),
  };
}

/** The repository this process should use. Called once by `songStore`. */
export function createSongRepository(): SongRepository {
  const host = getHost();
  if (host) {
    activeBackend = "disk";
    return createDiskRepository(host);
  }
  // `indexedDB` is absent in the node test environment and in a few embedded
  // webviews; the single-key adapter is the floor, not the goal.
  if (typeof indexedDB !== "undefined") {
    activeBackend = "indexeddb";
    return createIndexedDbRepository();
  }
  activeBackend = "localstorage";
  return createBrowserRepository();
}
