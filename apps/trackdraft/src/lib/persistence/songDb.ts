/**
 * The browser library's IndexedDB primitives — deliberately dumb.
 *
 * `localStorage` holds one string per origin (about 2.5M UTF-16 characters in
 * Chrome, ~5MB in Safari) and every save rewrote the WHOLE library into it,
 * so an imported corpus (the rock catalogue alone is 149 songs / 4.4MB) put
 * the app in a deadlock: the save that would shrink the library was itself a
 * save, so it failed, and a reload resurrected the oversized library. See
 * `songRepository.createIndexedDbRepository` for the adapter that uses this.
 *
 * IndexedDB is per-record and quota'd at a share of free disk, so one big
 * song no longer risks the other 148. Nothing here knows about songs beyond
 * their id and position — the record shape is the only contract.
 */

import type { BlueprintSong } from "../../types/blueprint";

const DB_NAME = "trackdraft-library";
const DB_VERSION = 1;
const SONG_STORE = "songs";
const ORDER_INDEX = "order";

export interface SongRecord {
  id: string;
  /** Position in the library array — IndexedDB iterates by key, so the
   *  dashboard's ordering has to be stored rather than implied. */
  order: number;
  song: BlueprintSong;
}

/** One connection per process, reused by every read and write. Held as a
 *  promise so concurrent callers share the open instead of racing it. */
let connection: Promise<IDBDatabase> | null = null;

export function openSongDb(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONG_STORE)) {
        const store = db.createObjectStore(SONG_STORE, { keyPath: "id" });
        store.createIndex(ORDER_INDEX, "order");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema would otherwise hang every write
      // in this tab forever.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("could not open the song database"));
    request.onblocked = () => reject(new Error("another tab is holding the song database open"));
  }).catch((error) => {
    connection = null;
    throw error;
  });
  return connection;
}

/** Test hook: drop the cached connection so a fresh database can be opened. */
export function closeSongDb(): void {
  const pending = connection;
  connection = null;
  void pending?.then((db) => db.close()).catch(() => {});
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  return openSongDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(SONG_STORE, mode);
        const request = work(transaction.objectStore(SONG_STORE));
        let result: T | undefined;
        if (request) request.onsuccess = () => (result = request.result);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? new Error("song database write failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("song database write aborted"));
      }),
  );
}

/** Every song, in library order. */
export function readSongRecords(): Promise<SongRecord[]> {
  return run<SongRecord[]>("readonly", (store) => store.getAll() as IDBRequest<SongRecord[]>).then(
    (records) => (records ?? []).sort((a, b) => a.order - b.order),
  );
}

/** Just the records named — used to take one song's change from another tab
 *  without re-reading a library that may be hundreds of songs big. */
export async function readSongRecordsByIds(ids: string[]): Promise<SongRecord[]> {
  if (ids.length === 0) return [];
  const db = await openSongDb();
  return new Promise<SongRecord[]>((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readonly");
    const store = transaction.objectStore(SONG_STORE);
    const found: SongRecord[] = [];
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) found.push(request.result as SongRecord);
      };
    }
    transaction.oncomplete = () => resolve(found.sort((a, b) => a.order - b.order));
    transaction.onerror = () => reject(transaction.error ?? new Error("song database read failed"));
  });
}

/** One transaction for the whole batch — a partial save is worse than none. */
export function writeSongRecords(records: SongRecord[]): Promise<void> {
  if (records.length === 0) return Promise.resolve();
  return run<void>("readwrite", (store) => {
    for (const record of records) store.put(record);
    return null;
  }).then(() => undefined);
}

export function deleteSongRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return run<void>("readwrite", (store) => {
    for (const id of ids) store.delete(id);
    return null;
  }).then(() => undefined);
}

/** Count only — the migration verifies what actually landed before it is
 *  willing to delete the legacy key. */
export function countSongRecords(): Promise<number> {
  return run<number>("readonly", (store) => store.count()).then((count) => count ?? 0);
}
