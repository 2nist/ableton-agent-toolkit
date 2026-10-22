/**
 * Parser router: dispatches files from the directory browser to the correct parser
 * based on file extension. Produces BlueprintSong objects ready for import.
 * After parsing, automatically enriches songs with LRCLIB synced lyrics and
 * auto-detects section boundaries from repeated lyric patterns (chorus detection).
 */

import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";
import type { DirectoryEntry } from "../../store/directoryStore";
import { parseMidiBytes, midiToBlueprintSong } from "./parseMidi";
import { audioToBlueprintSong, textToBlueprintSong } from "./parseAudio";
import { parseMcgillJcrd, parseRockCorpusJcrd } from "./parseJcrd";
import { parseMozartJcrd } from "./parseMozart";
import { searchLrclib, parseSyncedLyrics } from "../youtube";
import { buildLyricDocument, detectRepeatedBlocks, assignLinesToSection, mergeLinesIntoSection } from "../lyrics/sectionize";
import { alsToBlueprintSong } from "./parseAbleton";

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

const INSTRUMENTAL_ROLES = new Set(["solo", "intro", "outro", "breakdown"]);

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

  return { ...currentSong, sections: finalSections };
}

async function enrichWithLrclib(song: BlueprintSong): Promise<BlueprintSong> {
  const hasLyrics = song.sections.some(
    (s) => (s.lyrics && s.lyrics.trim().length > 0) || (s.lyricsTimeline && s.lyricsTimeline.length > 0),
  );
  if (hasLyrics) return autoSectionFromRepeats(song);

  try {
    const lrclib = await searchLrclib(song.title, song.artist);
    if (!lrclib?.syncedLyrics) return song;

    const timeline = parseSyncedLyrics(lrclib.syncedLyrics, song.bpm);
    if (timeline.length === 0) return song;

    const fullText = lrclib.plainLyrics || timeline.map((t) => t.text).join("\n");
    const lyricsTimeline = timeline.map((t) => ({ text: t.text, startBeat: t.startBeat }));

    if (song.sections.length > 0) {
      let cumulativeBeats = 0;
      for (const section of song.sections) {
        const sectionBeats = section.bars * section.timeSignatureNumerator;
        const endBeat = cumulativeBeats + sectionBeats;
        if (INSTRUMENTAL_ROLES.has(section.role)) { cumulativeBeats = endBeat; continue; }
        const sectionLyrics = lyricsTimeline.filter((l) => l.startBeat >= cumulativeBeats && l.startBeat < endBeat);
        section.lyrics = sectionLyrics.length > 0 ? sectionLyrics.map((l) => l.text).join("\n") : undefined;
        section.lyricsTimeline = sectionLyrics.length > 0 ? sectionLyrics : undefined;
        cumulativeBeats = endBeat;
      }
    } else {
      const sectionId = crypto.randomUUID();
      song.sections = [{
        id: sectionId,
        name: "Full Song",
        role: "verse",
        bars: Math.max(16, Math.ceil(timeline.length / 4)),
        chords: [],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: song.timeSignatureNumerator,
        timeSignatureDenPower: Math.log2(song.timeSignatureDenominator),
        lyrics: fullText,
        lyricsTimeline,
      }];
      song.arrangement = [{ sectionId, repeats: 1 }];
    }
    if (song.provenance) song.provenance.warnings = [...(song.provenance.warnings ?? []), "LRCLIB synced lyrics attached"];

    // After attaching synced lyrics, attempt chorus detection from repeated patterns
    song = autoSectionFromRepeats(song);
  } catch {}
  return song;
}

export async function parseFile(dirPath: string, entry: DirectoryEntry): Promise<ParseResult> {
  const baseName = entry.file.replace(/\.[^.]+$/, "");
  const title = baseName.replace(/[-_]/g, " ");
  try {
    const res = await fetch(`/__local-file?dir=${encodeURIComponent(dirPath)}&file=${encodeURIComponent(entry.file)}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    let song: BlueprintSong;

    switch (entry.type) {
      case "blueprint": {
        const raw = await res.json();
        // Three JSON flavours share the same .json extension and all have
        // `source` + `sections` with no `arrangement`, so they are told apart
        // by their chord vocabulary: the choCo/Mozart files label chords with
        // Roman numerals only (and carry `partition`/`time_signature`), while
        // McGill names absolute chords.
        if (isMozartJcrd(raw)) {
          song = parseMozartJcrd(raw);
        } else if (raw && typeof raw === "object" && "source" in raw && "sections" in raw && !("arrangement" in raw)) {
          song = parseMcgillJcrd(raw);
        } else {
          const { parseImportedSong } = await import("../exportImport");
          song = parseImportedSong(raw);
        }
        break;
      }
      case "jcrd": {
        const raw = await res.json();
        song = parseRockCorpusJcrd(raw);
        break;
      }
      case "midi": {
        const buffer = await res.arrayBuffer();
        song = midiToBlueprintSong(parseMidiBytes(new Uint8Array(buffer)), title);
        break;
      }
      case "audio": {
        song = await audioToBlueprintSong(await res.arrayBuffer(), title);
        break;
      }
      case "lyrics": {
        song = textToBlueprintSong(await res.text(), title);
        break;
      }
      case "ableton": {
        song = await alsToBlueprintSong(await res.arrayBuffer(), title);
        break;
      }
      default: {
        const raw = await res.json();
        if (raw && typeof raw === "object" && "sections" in raw && "source" in raw) {
          song = parseMcgillJcrd(raw);
        } else {
          throw new Error(`No parser for file type: ${entry.type}`);
        }
      }
    }
    return { ok: true, song: await enrichWithLrclib(song) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown parse error" };
  }
}