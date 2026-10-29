/**
 * What kind of song file is this, by extension — ONE mapping, shared by the
 * Vite dev server's directory browser, the Electron import dialog, and the
 * parser router. It used to live only in `vite.config.ts`, which meant the
 * packaged app had no way to classify a file the user picked.
 */

export type ImportKind =
  | "blueprint"
  | "jcrd"
  | "audio"
  | "midi"
  | "lyrics"
  | "ableton"
  | "musicxml"
  | "directory"
  | "unknown";

export interface KindInfo {
  category: ImportKind;
  /** Whether TrackDraft has a parser for it. */
  loadable: boolean;
}

const KIND_BY_EXT: Record<string, KindInfo> = {
  json: { category: "blueprint", loadable: true },
  jcrd: { category: "jcrd", loadable: true },
  mp3: { category: "audio", loadable: true },
  wav: { category: "audio", loadable: true },
  aif: { category: "audio", loadable: true },
  aiff: { category: "audio", loadable: true },
  flac: { category: "audio", loadable: true },
  ogg: { category: "audio", loadable: true },
  m4a: { category: "audio", loadable: true },
  mid: { category: "midi", loadable: true },
  midi: { category: "midi", loadable: true },
  musicxml: { category: "musicxml", loadable: true },
  xml: { category: "musicxml", loadable: true },
  txt: { category: "lyrics", loadable: true },
  lrc: { category: "lyrics", loadable: true },
  md: { category: "lyrics", loadable: true },
  als: { category: "ableton", loadable: true },
  ablx: { category: "ableton", loadable: false },
};

/** Extension of a file name or path, lower-case, without the dot. */
export function extOf(fileNameOrPath: string): string {
  const base = fileNameOrPath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function kindForFile(fileNameOrPath: string): KindInfo {
  return KIND_BY_EXT[extOf(fileNameOrPath)] ?? { category: "unknown", loadable: false };
}
