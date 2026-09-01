/**
 * One shared localStorage persistence mechanism for the app's zustand
 * stores — so the hand-rolled song/directory stores and the (now former)
 * `persist`-middleware MIDI store behave identically, instead of three
 * different ad-hoc strategies (debounced hand-rolled / immediate
 * hand-rolled / middleware).
 *
 * All helpers touch the `localStorage` GLOBAL directly (no injected
 * adapter) so tests can polyfill it — `songStore.repair.test.ts` stubs
 * `globalThis.localStorage` and uses `vi.useFakeTimers()` to drive the
 * debounced writer. Storage failures (quota, private mode, corrupt JSON)
 * are swallowed: persistence must never crash the app or throw during a
 * render.
 */

/** Read + JSON.parse a key; any failure (corrupt JSON, privacy mode,
 *  missing key) returns `fallback` instead of throwing. */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Read a raw (non-JSON) string key, e.g. the bare current-song id. */
export function readRawStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** JSON.stringify + setItem; quota / privacy failures are swallowed. */
export function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Never crash the app over persistence (quota, private mode...).
  }
}

/** Write a raw (non-JSON) string key, preserving the exact stored format
 *  (the current-song id and clock source are stored unquoted today). */
export function writeRawStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export interface DebouncedWriter<T> {
  /** Coalesce rapid writes into one `setTimeout`-scheduled persist. */
  write: (value: T) => void;
  /** Persist immediately, cancelling any pending debounce. */
  flush: (value: T) => void;
}

/** A debounced writer for one key — the song store's autosave. Uses plain
 *  `setTimeout`/`clearTimeout` so tests with `vi.useFakeTimers()` control
 *  it (see songStore.repair.test.ts). `persist` defaults to the JSON
 *  `writeStorage`; pass a custom function for raw keys (e.g. the
 *  current-song id, which is stored unquoted). */
export function createDebouncedWriter<T>(
  key: string,
  ms: number,
  persist: (value: T) => void = (value) => writeStorage(key, value),
): DebouncedWriter<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return {
    write(value: T): void {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(() => {
        persist(value);
        timeout = null;
      }, ms);
    },
    flush(value: T): void {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      persist(value);
    },
  };
}
