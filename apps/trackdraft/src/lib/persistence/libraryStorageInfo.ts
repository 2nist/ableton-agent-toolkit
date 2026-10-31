/**
 * How big is the library, and how close is it to the edge?
 *
 * Written after the localStorage quota deadlock (see `songRepository`): the
 * app had no way to tell the user the library was growing toward a hard
 * ceiling until the write failed, and by then nothing could be saved at all.
 * The numbers here are the ones that would have made that visible weeks
 * earlier.
 *
 * Sizes are reported two ways because the two backends count differently:
 * localStorage quota is measured in UTF-16 code units (so `chars`), while
 * IndexedDB and disk usage is reported in bytes (so `bytes`).
 */

import type { BlueprintSong } from "../../types/blueprint";
import { libraryBackend, type LibraryBackend } from "./songRepository";

export interface LibraryStorageInfo {
  backend: LibraryBackend;
  songs: number;
  /** UTF-16 code units of the serialised library — what a localStorage quota counts. */
  chars: number;
  /** UTF-8 bytes of the same JSON — what IndexedDB/disk usage is reported in. */
  bytes: number;
  /** Whole-origin usage and limit from the Storage API; null when a browser refuses. */
  usageBytes: number | null;
  quotaBytes: number | null;
  level: "ok" | "watch" | "danger";
  /** One line for the panel, already formatted. */
  headline: string;
  /** What to do about it — only set when `level` is not "ok". */
  advice: string | null;
}

/** Chrome's localStorage cap is 5MB of UTF-16 — about 2.5M characters — and
 *  Safari's is in the same range. Two million characters leaves room for the
 *  rest of the origin without being generous. */
const LOCALSTORAGE_WATCH_CHARS = 1_500_000;
const LOCALSTORAGE_DANGER_CHARS = 2_000_000;

/** For IndexedDB/disk the ceiling is a share of free disk, so the only
 *  meaningful signal is how much of the granted quota is gone. */
const QUOTA_WATCH = 0.75;
const QUOTA_DANGER = 0.9;

/** "1 song" / "156 songs" — every headline quotes a count. */
function count(songs: number): string {
  return `${songs} song${songs === 1 ? "" : "s"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

async function estimate(): Promise<{ usageBytes: number | null; quotaBytes: number | null }> {
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage?.estimate) return { usageBytes: null, quotaBytes: null };
    const { usage, quota } = await storage.estimate();
    return { usageBytes: usage ?? null, quotaBytes: quota ?? null };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

function utf8Bytes(json: string): number {
  // Blob is the only cheap way to get UTF-8 length without a TextEncoder
  // round-trip over several megabytes of string.
  try {
    return new Blob([json]).size;
  } catch {
    return json.length;
  }
}

export async function measureLibraryStorage(
  songs: BlueprintSong[],
  backend: LibraryBackend = libraryBackend(),
): Promise<LibraryStorageInfo> {
  const json = JSON.stringify(songs);
  const chars = json.length;
  const bytes = utf8Bytes(json);
  const { usageBytes, quotaBytes } = await estimate();
  const pressure = usageBytes != null && quotaBytes ? usageBytes / quotaBytes : null;

  const base = { backend, songs: songs.length, chars, bytes, usageBytes, quotaBytes };
  const size = backend === "localstorage" ? `${formatBytes(bytes)} in localStorage` : formatBytes(bytes);

  if (backend === "localstorage") {
    // This browser has no IndexedDB: the library really can hit the wall.
    const pct = Math.round((chars / LOCALSTORAGE_DANGER_CHARS) * 100);
    if (chars >= LOCALSTORAGE_DANGER_CHARS) {
      return {
        ...base,
        level: "danger",
        headline: `${size} across ${count(songs.length)} — at the browser's ~2.5M character cap (${pct}%)`,
        advice:
          "Saves are about to fail permanently: once the library is over the cap, even deleting songs cannot be written. Export a backup now and keep this library small.",
      };
    }
    if (chars >= LOCALSTORAGE_WATCH_CHARS) {
      return {
        ...base,
        level: "watch",
        headline: `${size} across ${count(songs.length)} — past three quarters of the browser's cap (${pct}%)`,
        advice: "Export a backup and trim the library, or open the desktop app, where each song is its own file.",
      };
    }
    return { ...base, level: "ok", headline: `${size} across ${count(songs.length)} — well under the browser's cap`, advice: null };
  }

  const quotaText = quotaBytes ? ` of the ${formatBytes(quotaBytes)} browser quota` : "";
  // "0.0% used" reads like a bug; a healthy library is better described as
  // "under 0.1%".
  const usedText =
    pressure == null
      ? ""
      : ` · ${pressure < 0.001 ? "under 0.1%" : `${(pressure * 100).toFixed(1)}%`} used${quotaText}`;

  if (pressure != null && pressure >= QUOTA_DANGER) {
    return {
      ...base,
      level: "danger",
      headline: `${size} across ${count(songs.length)}${usedText}`,
      advice: "The browser is nearly out of storage for this site. Export a backup, then free space on this machine.",
    };
  }
  if (pressure != null && pressure >= QUOTA_WATCH) {
    return {
      ...base,
      level: "watch",
      headline: `${size} across ${count(songs.length)}${usedText}`,
      advice: "Storage is filling up. Export a backup before it gets tight.",
    };
  }
  return {
    ...base,
    level: "ok",
    headline: `${size} across ${count(songs.length)}${usedText}`,
    advice: null,
  };
}
