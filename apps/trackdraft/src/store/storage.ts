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

export interface StorageFailure {
  key: string;
  message: string;
  at: number;
}

let lastFailure: StorageFailure | null = null;
const failureListeners = new Set<(failure: StorageFailure | null) => void>();

/** The most recent failed write, or null after a successful write to the
 *  same key. Used by the shell's autosave banner — a swallowed quota error
 *  otherwise means the user keeps editing and loses work on reload. */
export function getStorageFailure(): StorageFailure | null {
  return lastFailure;
}

export function subscribeStorageFailure(listener: (failure: StorageFailure | null) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

function reportFailure(key: string, error: unknown): void {
  lastFailure = {
    key,
    message: error instanceof Error ? error.message : String(error),
    at: Date.now(),
  };
  for (const listener of failureListeners) listener(lastFailure);
}

function clearFailure(key: string): void {
  if (lastFailure?.key !== key) return;
  lastFailure = null;
  for (const listener of failureListeners) listener(null);
}

/** Report a failed write that did not go through `localStorage` — the
 *  desktop library's file adapter writes through the host bridge, and a
 *  failure there is exactly as destructive as a full quota. Without this
 *  the banner only ever fired in the browser build. */
export function reportStorageFailure(key: string, error: unknown): void {
  reportFailure(key, error);
}

/** The inverse: a write through a non-`localStorage` path succeeded, so the
 *  banner for that key can come down. */
export function clearStorageFailure(key: string): void {
  clearFailure(key);
}

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

/** JSON.stringify + setItem; quota / privacy failures are surfaced through
 *  `getStorageFailure()` so the shell can warn instead of failing silently. */
export function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    clearFailure(key);
  } catch (error) {
    // Never crash the app over persistence (quota, private mode...).
    reportFailure(key, error);
  }
}

/** Write a raw (non-JSON) string key, preserving the exact stored format
 *  (the current-song id and clock source are stored unquoted today). */
export function writeRawStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    clearFailure(key);
  } catch (error) {
    reportFailure(key, error);
  }
}

export interface DebouncedWriter<T> {
  /** Coalesce rapid writes into one `setTimeout`-scheduled persist. */
  write: (value: T) => void;
  /** Persist immediately, cancelling any pending debounce. */
  flush: (value: T) => void;
  /** Persist the value currently waiting on the debounce, if any. Called
   *  from the shell's pagehide/visibility handler so closing the tab
   *  mid-edit cannot drop the last keystroke. */
  flushPending: () => void;
  /** Is an edit still waiting on the debounce? A repository asks this before
   *  accepting a change from another tab: refreshing under an unsaved edit
   *  would throw the typing away. */
  hasPending: () => boolean;
}

/** Every debounced writer created in the app, so one pagehide handler can
 *  flush them all without the shell knowing each store. */
const pendingWriters = new Set<DebouncedWriter<unknown>>();

export function flushAllPendingWrites(): void {
  for (const writer of pendingWriters) writer.flushPending();
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
  let pendingValue: T;
  let hasPending = false;

  const writer: DebouncedWriter<T> = {
    write(value: T): void {
      pendingValue = value;
      hasPending = true;
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(() => {
        persist(pendingValue);
        hasPending = false;
        timeout = null;
      }, ms);
    },
    flush(value: T): void {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      hasPending = false;
      persist(value);
    },
    hasPending(): boolean {
      return hasPending;
    },
    flushPending(): void {
      if (!hasPending) return;
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      hasPending = false;
      persist(pendingValue);
    },
  };

  pendingWriters.add(writer as DebouncedWriter<unknown>);
  return writer;
}
