/**
 * Parser router: dispatches files from the directory browser to the correct parser
 * based on file extension. Produces BlueprintSong objects ready for import.
 * After parsing, automatically enriches songs with LRCLIB synced lyrics and
 * auto-detects section boundaries from repeated lyric patterns (chorus detection).
 */

import type { BlueprintSong } from "../../types/blueprint";
import type { DirectoryEntry } from "../../store/directoryStore";
import { getHost, hostFileKind, type HostFile } from "../host";
import { parseMidiBytes, midiToBlueprintSong } from "./parseMidi";
import { audioToBlueprintSong, textToBlueprintSong } from "./parseAudio";
import { parseMcgillJcrd, parseRockCorpusJcrd } from "./parseJcrd";
import { parseMozartJcrd } from "./parseMozart";
import { parseChartFileName, parseCorpusFileName } from "./corpusFileName";
import { searchLrclib } from "../youtube";
import { attachLyrics } from "../lyrics/attachLyrics";
import { buildLyricDocument, detectRepeatedBlocks, assignLinesToSection, mergeLinesIntoSection } from "../lyrics/sectionize";
import { alsToBlueprintSong, alsXmlToBlueprintSong } from "./parseAbleton";
import { musicXmlToBlueprintSong } from "./parseMusicXml";

/** The choCo Mozart conversion: Roman-numeral chord labels, a `partition`
 *  field, and no absolute chord names anywhere. */
function isMozartJcrd(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as Record<string, unknown>;
  if (data.partition === "mozart-piano-sonatas") return true;
  if (!Array.isArray(data.sections) || !data.sections.length) return false;
  const first = data.sections[0] as Record<string, unknown> | undefined;
  const labels = Array.isArray(first?.chords) ? (first!.chords as unknown[]) : [];
  if (labels.length === 0) return false;
  const romanOnly = labels.every((label) => typeof label === "string" && /^[A-G]?(maj|min)?[#b]?[ivIV%+ItFrGer]/.test(label));
  return romanOnly && typeof data.time_signature === "string";
}

export type ParseResult =
  | { ok: true; song: BlueprintSong }
  | { ok: false; error: string };

/**
 * Auto-detect sections from repeated lyric patterns in synced lyrics.
 * Uses `detectRepeatedBlocks()` (sliding-window algorithm from sectionize.ts)
 * to find the longest recurring line sequences, then carves them into real
 * Chorus/Verse/Bridge sections instead of a single "Full Song" blob.
 *
 * Algorithm:
 * 1. Build a LyricLine[] document from the single-section song
 * 2. Run detectRepeatedBlocks() to find repeated passages
 * 3. Sort by occurrence count (desc) then block length (desc)
 * 4. For the best repeated block (longest, most frequent):
 *    a. First occurrence → carve it out as a new "Chorus" section
 *    b. Each subsequent occurrence → merge into that same chorus section
 * 5. Remaining unassigned lyric ranges become Verse/Bridge sections
 *    based on position in the song (first unmatched = Verse, etc.)
 *
 * Falls back to the original single-section behavior when no repeated
 * blocks are found or the song already has multiple sections.
 */
function autoSectionFromRepeats(song: BlueprintSong): BlueprintSong {
  // Only applies to songs with one lyric-bearing section and no chords yet —
  // if someone already built a multi-section song, don't restructure it.
  const lyricSections = song.sections.filter(
    (s) => (s.lyrics && s.lyrics.trim().length > 0) || (s.lyricsTimeline && s.lyricsTimeline.length > 0),
  );
  if (lyricSections.length !== 1 || song.sections.length > 1) return song;

  // Build the flat line-granular document
  let docLines = buildLyricDocument(song);
  if (docLines.length < 8) return song; // too short for meaningful sectioning

  // Find repeated line blocks
  const blocks = detectRepeatedBlocks(docLines);
  if (blocks.length === 0) return song;

  // Sort best first: most occurrences, then longest normalized text
  blocks.sort((a, b) => b.occurrences.length - a.occurrences.length || b.normalizedText.length - a.normalizedText.length);

  let currentSong = song;
  let chorusSectionId: string | null = null;

  // Take the single best repeated block (longest + most frequent)
  const bestBlock = blocks[0];
  if (bestBlock.occurrences.length < 2) return currentSong;
  // A "chorus" of one or two lines is noise, not structure. Splitting on it
  // left a stray extra section beside the original and doubled the song's bar
  // count, which is worse than not splitting at all.
  if (bestBlock.occurrences[0].end - bestBlock.occurrences[0].start + 1 < 4) return currentSong;

  // Process occurrences in document order — first creates the chorus, rest merge into it
  for (let i = 0; i < bestBlock.occurrences.length; i++) {
    const occ = bestBlock.occurrences[i];
    // Rebuild doc lines after each mutation since indices shift
    docLines = buildLyricDocument(currentSong);

    // Find the current range in the updated document — the same text at
    // whatever position it's now at (indices shift after each operation)
    const occText = docLines.slice(occ.start, occ.end + 1).map((l) => l.text).join("\n");
    const currentStart = docLines.findIndex((_, idx) => {
      const span = docLines.slice(idx, idx + (occ.end - occ.start + 1)).map((l) => l.text).join("\n");
      return span === occText;
    });

    if (currentStart === -1) continue;
    const currentEnd = currentStart + (occ.end - occ.start);

    if (i === 0) {
      // First occurrence: carve out as a new Chorus section
      currentSong = assignLinesToSection(currentSong, docLines, { start: currentStart, end: currentEnd }, { role: "chorus", name: "Chorus" });
      // Find the id of the newly created section (it's the one at the insert point after the operation)
      const newDocLines = buildLyricDocument(currentSong);
      const chorusLine = newDocLines.find((l) => l.sectionName === "Chorus");
      if (chorusLine) chorusSectionId = chorusLine.sectionId;
    } else if (chorusSectionId) {
      // Subsequent occurrences: merge into the existing chorus
      currentSong = mergeLinesIntoSection(currentSong, docLines, { start: currentStart, end: currentEnd }, chorusSectionId);
    }
  }

  // After chorus detection, auto-name remaining custom/unlabeled sections
  // by position: first fragment → Verse, everything else → Custom
  const finalSections = currentSong.sections.map((section, i, _arr) => {
    if (section.role === "chorus") return section;
    if (section.role === "verse" || section.role === "custom") {
      // First non-chorus section → Verse, rest → leave as-is (custom)
      if (i === 0) return { ...section, role: "verse" as const, name: "Verse" };
    }
    return section;
  });

  // Every section must be reachable from the arrangement, or the split leaves
  // orphan sections behind and the song plays to a different length than its
  // spine shows. Rebuilding it in document order keeps the two in step.
  const arranged = new Set(currentSong.arrangement.map((entry) => entry.sectionId));
  const missing = finalSections.filter((section) => !arranged.has(section.id));
  return {
    ...currentSong,
    sections: finalSections,
    arrangement:
      missing.length === 0
        ? currentSong.arrangement
        : finalSections.map((section) => ({ sectionId: section.id, repeats: 1 })),
  };
}

async function enrichWithLrclib(song: BlueprintSong): Promise<BlueprintSong> {
  const hasLyrics = song.sections.some(
    (s) => (s.lyrics && s.lyrics.trim().length > 0) || (s.lyricsTimeline && s.lyricsTimeline.length > 0),
  );
  if (hasLyrics) return autoSectionFromRepeats(song);

  try {
    const lrclib = await searchLrclib(song.title, song.artist);
    if (!lrclib?.syncedLyrics) return song;

    // Same placement the Lyrics dock's hand search uses, so an automatic
    // attach and a user-picked one can't disagree about where a line lands —
    // including the per-section meter, which this used to get wrong.
    const placed = attachLyrics(
      song,
      { syncedLyrics: lrclib.syncedLyrics, plainLyrics: lrclib.plainLyrics },
      lrclib.id
        ? {
            provider: "lrclib",
            id: lrclib.id,
            trackName: lrclib.trackName,
            artistName: lrclib.artistName,
            albumName: lrclib.albumName,
            duration: lrclib.duration,
            chosenByUser: false,
          }
        : undefined,
    );
    if (!placed.attached) return song;

    let attached = placed.song;
    if (attached.provenance) {
      attached.provenance.warnings = [...(attached.provenance.warnings ?? []), "LRCLIB synced lyrics attached"];
    }

    // After attaching synced lyrics, attempt chorus detection from repeated patterns
    attached = autoSectionFromRepeats(attached);
    return attached;
  } catch {
    return song;
  }
}

/** How to read a picked file's bytes — the ONLY difference between the dev
 *  server's `/__local-file` endpoint and the Electron host's IPC bridge. */
export interface FileContentReader {
  text(): Promise<string>;
  json(): Promise<unknown>;
  bytes(): Promise<ArrayBuffer>;
  /** `.als` only. Present when the host can gunzip for us (Electron, which
   *  owns Node); absent in the browser, where `alsToBlueprintSong` falls back
   *  to `node:zlib` — the reason `.als` only ever worked under `vite dev`. */
  alsXml?(): Promise<string>;
}

/** Title (and, when the name encodes one, artist) from a file name. */
export function titleForFile(fileName: string): { title: string; fileNameArtist?: string } {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  // Corpus names carry artist/title/year (`ABBA_DancingQueen_1976`); everything
  // else falls back to the file name with separators loosened. The parsed form
  // matters for the lyrics lookup, which cannot find "ABBA DancingQueen 1976".
  const corpus = parseCorpusFileName(baseName);
  // CoCoPops-style first (`Artist_Title_Year`); otherwise the looser chart
  // naming — `Title - Artist`, camelCase, kebab-case — so the lyrics lookup
  // and the library get a real title instead of "EchidnasArf(OfYou)".
  const chart = corpus ? null : parseChartFileName(baseName);
  return {
    title: corpus?.title ?? chart?.title ?? baseName.replace(/[-_]/g, " "),
    fileNameArtist: corpus?.artist ?? chart?.artist,
  };
}

/** Every parser, dispatched by kind. Shared by the directory browser and the
 *  desktop import dialog so the two can never drift. */
async function songFromContent(
  kind: DirectoryEntry["type"],
  read: FileContentReader,
  title: string,
): Promise<BlueprintSong> {
  switch (kind) {
    case "blueprint": {
      const raw = await read.json();
      // Three JSON flavours share the same .json extension and all have
      // `source` + `sections` with no `arrangement`, so they are told apart
      // by their chord vocabulary: the choCo/Mozart files label chords with
      // Roman numerals only (and carry `partition`/`time_signature`), while
      // McGill names absolute chords.
      if (isMozartJcrd(raw)) return parseMozartJcrd(raw);
      if (raw && typeof raw === "object" && "source" in raw && "sections" in raw && !("arrangement" in raw)) {
        return parseMcgillJcrd(raw);
      }
      const { parseImportedSong } = await import("../exportImport");
      return parseImportedSong(raw);
    }
    case "jcrd":
      return parseRockCorpusJcrd(await read.json());
    case "midi": {
      const buffer = await read.bytes();
      return midiToBlueprintSong(parseMidiBytes(new Uint8Array(buffer)), title);
    }
    case "audio":
      return audioToBlueprintSong(await read.bytes(), title);
    case "lyrics":
      return textToBlueprintSong(await read.text(), title);
    case "ableton":
      // Prefer the host's decompressed XML; only the browser falls back to zlib.
      return read.alsXml
        ? alsXmlToBlueprintSong(await read.alsXml(), title)
        : alsToBlueprintSong(await read.bytes(), title);
    case "musicxml":
      return musicXmlToBlueprintSong(await read.text(), title);
    default: {
      const raw = await read.json();
      if (raw && typeof raw === "object" && "sections" in raw && "source" in raw) {
        return parseMcgillJcrd(raw);
      }
      throw new Error(`No parser for file type: ${kind}`);
    }
  }
}

/** Shared tail: artist from the file name, then lyric enrichment. */
async function finishSong(song: BlueprintSong, fileNameArtist?: string): Promise<ParseResult> {
  if (fileNameArtist && !song.artist) song.artist = fileNameArtist;
  return { ok: true, song: await enrichWithLrclib(song) };
}

/** Parse a file listed by the dev server's directory browser. */
export async function parseFile(dirPath: string, entry: DirectoryEntry): Promise<ParseResult> {
  const { title, fileNameArtist } = titleForFile(entry.file);
  try {
    const res = await fetch(`/__local-file?dir=${encodeURIComponent(dirPath)}&file=${encodeURIComponent(entry.file)}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const song = await songFromContent(
      entry.type,
      {
        text: () => res.clone().text(),
        json: () => res.clone().json(),
        bytes: () => res.clone().arrayBuffer(),
      },
      title,
    );
    return await finishSong(song, fileNameArtist);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown parse error" };
  }
}

/**
 * Parse a file the user picked in the desktop host's native dialog.
 *
 * Same parsers, same title/artist inference, same lyric enrichment as the
 * directory browser — only the byte source differs. This is the path that
 * makes MIDI, MusicXML and `.als` importable in a packaged build, where the
 * dev server's `/__local-file` endpoint does not exist.
 */
export async function parseHostFile(file: HostFile): Promise<ParseResult> {
  const host = getHost();
  if (!host) return { ok: false, error: "No desktop host available to read that file." };
  const { title, fileNameArtist } = titleForFile(file.name);
  try {
    const song = await songFromContent(
      hostFileKind(file),
      {
        text: () => host.readText(file.path),
        json: async () => JSON.parse(await host.readText(file.path)),
        bytes: async () => {
          const bytes = await host.readBytes(file.path);
          // `Uint8Array` over IPC → ArrayBuffer for the parsers. Slice copies
          // into a standalone buffer (the view may reference a larger pool).
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
        alsXml: () => host.readAlsXml(file.path),
      },
      title,
    );
    return await finishSong(song, fileNameArtist);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown parse error" };
  }
}
