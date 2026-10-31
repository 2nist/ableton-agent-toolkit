import { NOTE_TO_PC } from "@music-theory/core";
import type { BlueprintSong } from "../types/blueprint";
import { getBridgeHttpBase } from "./bridgeHost";
import { encodeIrealUrl, irealPlaylistHtml } from "./ireal/encodeSong";

// ---------------------------------------------------------------------------
// File System Access API helper — returns a directory handle, or null if
// the user cancelled or the API is not available.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

interface FileSystemDirectoryHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === "undefined" || !window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null; // user cancelled
  }
}

/** Writes every song in the store to a user-chosen directory via the
 *  File System Access API. Overwrites by songId; does not delete files.
 *  Serializes using the same JSON format as `downloadSongJson`. */
export async function syncLibraryToFolder(songs: BlueprintSong[]): Promise<void> {
  const dir = await pickDirectory();
  if (!dir) return;

  for (const song of songs) {
    const filename = `${song.id}.blueprint.json`;
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    const json = JSON.stringify(song, null, 2);
    await writable.write(json);
    await writable.close();
  }
}

/** Triggers a browser download of a song as a standalone JSON file --
 *  the hand-off artifact Phase 6's Ableton extension consumes, and
 *  matching the original TrackDraft's documented "export complete JSON"
 *  Finishing Tools feature. */
export function downloadSongJson(song: BlueprintSong) {
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.trackdraft.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** The whole library in one file — the safety net beside the per-song
 *  export. localStorage is the only live store, so a quota failure or a
 *  browser profile reset can otherwise take every song at once. */
export interface LibraryBackup {
  app: "trackdraft";
  version: 1;
  exportedAt: string;
  songs: BlueprintSong[];
}

export function downloadLibraryBackup(songs: BlueprintSong[]): void {
  const backup: LibraryBackup = {
    app: "trackdraft",
    version: 1,
    exportedAt: new Date().toISOString(),
    songs,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trackdraft-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** iReal Pro playlist (.html) — the only shape iReal Pro imports. Each song
 *  is one obfuscated `irealb://` link, exactly as its own exporter writes
 *  them; `irealPlaylistHtml` carries iReal's skeleton so the app recognises
 *  the file instead of showing a bare list of URLs. */
export function downloadIrealPlaylist(songs: BlueprintSong[]): void {
  const html = irealPlaylistHtml(
    songs.map((song) => ({ title: song.title, composer: song.artist, url: encodeIrealUrl(song) })),
  );
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = songs.length === 1 ? songs[0].title : "trackdraft";
  a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ireal.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Accepts a library backup, a bare array of songs, or a single song. */
export function parseLibraryBackup(raw: unknown): BlueprintSong[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { songs?: unknown }).songs)
      ? ((raw as { songs: unknown[] }).songs)
      : [raw];
  if (list.length === 0) {
    throw new Error("Backup contains no songs.");
  }
  return list.map((entry) => parseImportedSong(entry, { preserveTimestamps: true }));
}

export async function readLibraryBackupFile(file: File): Promise<BlueprintSong[]> {
  const text = await file.text();
  return parseLibraryBackup(JSON.parse(text));
}

/** Minimal shape validation for imported JSON -- catches obviously wrong
 *  files (wrong app, corrupted) without being a full schema validator. */
export function parseImportedSong(
  raw: unknown,
  opts: { preserveTimestamps?: boolean } = {},
): BlueprintSong {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a valid song file: expected a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== "string" || !Array.isArray(obj.sections) || !Array.isArray(obj.arrangement)) {
    throw new Error("Not a valid song file: missing title/sections/arrangement.");
  }
  // Real validation, not just shape-checking: caught live when an earlier
  // version of the ingestion script wrote key="E major" instead of "E" --
  // pitchClass() only accepts bare note names and threw deep inside
  // rendering (HexWheel/ProgressionBuilder) instead of failing clearly
  // here at the actual untrusted-input boundary.
  if (typeof obj.key === "string" && !(obj.key in NOTE_TO_PC)) {
    throw new Error(`Not a valid song file: "${obj.key}" is not a recognized note name (expected e.g. "C", "F#", "Bb").`);
  }
  // `arrangement`'s entries weren't validated at all before -- just cast
  // through as an untyped array. A malformed entry (e.g. hand-edited JSON
  // missing `repeats`) previously wouldn't fail until sectionSpans() ran
  // deep inside export, with no clear message pointing back at the file.
  //
  // Accepts `sectionName` as a legacy alias for `sectionId` -- the
  // catalog ingestion script (apps/trackdraft/scripts/catalog/
  // toBlueprintSong.ts) wrote `sectionName` until 2026-07-21, and all
  // 179 existing Beatles catalog files have it. Normalization below
  // converts those entries so downstream code never sees the legacy
  // field name, but the validation message only mentions `sectionId`
  // so users hand-editing a file know the canonical name to use.
  for (const entry of obj.arrangement) {
    const e = entry as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null || typeof e.repeats !== "number") {
      throw new Error('Not a valid song file: arrangement entries need a "repeats" number.');
    }
    if (typeof e.sectionId !== "string" && typeof e.sectionName !== "string") {
      throw new Error('Not a valid song file: arrangement entries need a "sectionId" string (or the legacy "sectionName" field) and a "repeats" number.');
    }
  }
  // Normalize any legacy `sectionName` entries to `sectionId` so the
  // returned BlueprintSong always carries the canonical field name.
  const normalizedArrangement: BlueprintSong["arrangement"] = obj.arrangement.map((entry: unknown) => {
    const e = entry as Record<string, unknown>;
    return {
      sectionId: (typeof e.sectionId === "string" ? e.sectionId : e.sectionName) as string,
      repeats: e.repeats as number,
      variation: typeof e.variation === "string" ? e.variation : undefined,
      overrides: (e.overrides as Record<string, unknown>) ?? undefined,
    } as BlueprintSong["arrangement"][number];
  });
  const now = new Date().toISOString();
  return {
    id: typeof obj.id === "string" ? obj.id : crypto.randomUUID(),
    title: obj.title,
    artist: typeof obj.artist === "string" ? obj.artist : undefined,
    key: typeof obj.key === "string" ? obj.key : "C",
    scale: typeof obj.scale === "string" ? (obj.scale as BlueprintSong["scale"]) : "ionian",
    bpm: typeof obj.bpm === "number" ? obj.bpm : 120,
    timeSignatureNumerator: typeof obj.timeSignatureNumerator === "number" ? obj.timeSignatureNumerator : 4,
    timeSignatureDenominator: typeof obj.timeSignatureDenominator === "number" ? obj.timeSignatureDenominator : 4,
    sections: obj.sections as BlueprintSong["sections"],
    arrangement: normalizedArrangement,
    concept: typeof obj.concept === "string" ? obj.concept : undefined,
    notes: (obj.notes as BlueprintSong["notes"]) ?? undefined,
    additionalIdeas: Array.isArray(obj.additionalIdeas) ? (obj.additionalIdeas as string[]) : undefined,
    references: Array.isArray(obj.references) ? (obj.references as string[]) : undefined,
    suiteGroup: (obj.suiteGroup as BlueprintSong["suiteGroup"]) ?? undefined,
    alternates: Array.isArray(obj.alternates) ? (obj.alternates as BlueprintSong["alternates"]) : undefined,
    status: (obj.status as BlueprintSong["status"]) ?? undefined,
    outputOffsetBeats: typeof obj.outputOffsetBeats === "number" ? obj.outputOffsetBeats : undefined,
    beatOffset: typeof obj.beatOffset === "number" ? obj.beatOffset : undefined,
    genre: typeof obj.genre === "string" ? obj.genre : undefined,
    // Style fields must survive import — the whitelist used to drop `bend`
    // silently, so an imported song arrived neutral even when the JSON was
    // clearly bent (caught live when `detected` ratings didn't show up
    // after re-import; same rebuild path dropped both).
    bend: (obj.bend as BlueprintSong["bend"]) ?? undefined,
    // The narrative master is the abstract half of the style layer — without
    // this line a re-imported song loses the arc every section is tinted by,
    // while section-level `narrative` survives (sections pass through whole).
    narrative: (obj.narrative as BlueprintSong["narrative"]) ?? undefined,
    detected: (obj.detected as BlueprintSong["detected"]) ?? undefined,
    provenance: (obj.provenance as BlueprintSong["provenance"]) ?? undefined,
    // Which record the words came from. Validated rather than trusted: a
    // saved song with a malformed ref would make the lyrics search claim a
    // record it never used, so the id and provider have to be sane.
    lyricsSource:
      obj.lyricsSource &&
      typeof obj.lyricsSource === "object" &&
      (obj.lyricsSource as BlueprintSong["lyricsSource"])!.provider === "lrclib" &&
      typeof (obj.lyricsSource as BlueprintSong["lyricsSource"])!.id === "number"
        ? (obj.lyricsSource as BlueprintSong["lyricsSource"])
        : undefined,
    // Suggestion acknowledgments (mode-inference / one-shot cards) must
    // survive import too — same whitelist-drop class as bend/detected
    // above; without this a re-import re-asks questions the user already
    // answered. See exportImport.test.ts for the regression lock.
    blueprintAcks: (obj.blueprintAcks as BlueprintSong["blueprintAcks"]) ?? undefined,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : now,
    updatedAt:
      opts.preserveTimestamps && typeof obj.updatedAt === "string" ? obj.updatedAt : now,
  };
}

export async function readSongFile(file: File): Promise<BlueprintSong> {
  const text = await file.text();
  const raw = JSON.parse(text);
  return parseImportedSong(raw);
}

/** Follows the page host — 127.0.0.1 when opened locally, the Mac's LAN IP
 *  when opened from an iPad via `start-all.sh lan`.
 *
 *  Resolved per call rather than at module load: a module-scope `window.location`
 *  read made this file unimportable anywhere without a browser (node scripts,
 *  tests), and `parseHostFile` imports it lazily on the import path. */
function abletonBridgeUrl(): string {
  return getBridgeHttpBase();
}

/** Post the full song blueprint to the osc-bridge's REST API so it lands in
 *  the extension's storage directory — no manual sync-script step needed.
 *  If the bridge isn't running (connection refused), the caller shows a
 *  notification; this is a deliberate fire-and-forget for the common case
 *  but returns the response so the UI can give feedback. */
export async function pushSongToAbleton(song: BlueprintSong): Promise<{ status: string; title: string }> {
  const res = await fetch(`${abletonBridgeUrl()}/api/push-song`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(song),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Bridge returned ${res.status}`);
  }
  return res.json();
}

/** Sends a command to the bridge's command queue — used for actions that
 *  don't carry a full blueprint payload (setTempo, etc.). */
export async function sendAbletonCommand(action: string, payload: Record<string, unknown> = {}): Promise<void> {
  await fetch(`${abletonBridgeUrl()}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
}
