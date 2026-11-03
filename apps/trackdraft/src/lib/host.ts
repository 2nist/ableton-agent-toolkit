/**
 * The desktop host, if there is one.
 *
 * TrackDraft runs in two places: a browser (where file access goes through the
 * dev server's `/__local-*` endpoints, and only while `vite dev` is running)
 * and the Electron shell (where a preload bridge exposes a native dialog and
 * real reads). Everything else in the app should ask THIS module rather than
 * sniffing `window` — the point is that "no host" is an ordinary state, not an
 * error.
 *
 * In a plain browser `getHost()` returns null and callers fall back to the
 * existing `<input type="file">` / endpoint paths.
 */

import { kindForFile, type ImportKind } from "./importKinds";
import type { SavedBeat } from "../types/blueprint";

export interface HostFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  /** Listed by `listDirectory` only — a folder inside the browsed root. */
  isDirectory?: boolean;
}

export interface HostAppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

/** Result of loading the on-disk library (main seeds it from the bundled
 *  catalogue pack on first run). */
export interface HostLibrary {
  songs: unknown[];
  /** How many songs were copied in from the bundled pack this launch. */
  seeded: number;
  unreadable: number;
  dir: string;
  /** `release` | `internal-test-only` | `none` — what the bundle says it is. */
  distribution: string;
}

export interface TrackDraftHost {
  readonly isElectron: true;
  appInfo(): Promise<HostAppInfo>;
  pickFiles(options?: { multiple?: boolean }): Promise<HostFile[]>;
  pickDirectory(): Promise<string | null>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** `.als` only: the Live Set XML, already gunzipped by the main process. */
  readAlsXml(path: string): Promise<string>;
  listDirectory(path: string): Promise<HostFile[]>;
  /** The VST3's preset folder (the app/plug-in exchange point). */
  presetDir(): Promise<string>;
  presetList(): Promise<{ dir: string; presets: { name: string; path: string }[] }>;
  /** Reads one of those presets by name — again, never by path. */
  presetLoad(name: string): Promise<{ ok: boolean; xml?: string; error?: string }>;
  /** Writes a `.tdp.xml` there; the filename is sanitised on the main side. */
  presetSave(name: string, xml: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  libraryLoad(): Promise<HostLibrary>;
  libraryWrite(song: unknown): Promise<{ ok: boolean }>;
  libraryDelete(songId: string): Promise<{ ok: boolean }>;
  libraryInfo(): Promise<{ dir: string; distribution: string }>;
  /** Saved beats, in `<library>/tables/beats.json` — portable and hand-editable. */
  beatsLoad(): Promise<{ beats: SavedBeat[]; path: string }>;
  beatsSave(beats: SavedBeat[]): Promise<{ ok: boolean; path: string; count: number }>;
  /** Engine tables in `<library>/tables/` — already JSON-parsed by main. */
  tablesLoad(): Promise<{ dir: string; files: Record<string, unknown>; errors: Record<string, string> }>;
  tablesSave(filename: string, data: unknown): Promise<{ ok: boolean; path: string }>;
  tablesDelete(filename: string): Promise<{ ok: boolean }>;
  /** YouTube oEmbed — title and channel, no API key. */
  youtubeMeta(videoId: string): Promise<{ title: string; artist: string; videoId: string }>;
  /** Raw ChordMiniApp analysis for an audio file's bytes. */
  analyzeAudio(bytes: Uint8Array): Promise<unknown>;
  /** Metadata → audio → analysis → lyrics. Progress arrives as it goes. */
  youtubeFullImport(
    videoId: string,
    onProgress?: (update: { step: string; message: string }) => void,
  ): Promise<{ title: string; artist: string; chordMiniData: unknown; lrclibData: unknown }>;
  onMenuImport(listener: () => void): () => void;
}

declare global {
  interface Window {
    trackdraft?: TrackDraftHost;
  }
}

/** The host bridge, or null when running in a browser. */
export function getHost(): TrackDraftHost | null {
  if (typeof window === "undefined") return null;
  return window.trackdraft ?? null;
}

export function isElectronHost(): boolean {
  return getHost() !== null;
}

/** Import kind for a host file (extension-based, one shared mapping). */
export function hostFileKind(file: HostFile): ImportKind {
  return kindForFile(file.name).category;
}
