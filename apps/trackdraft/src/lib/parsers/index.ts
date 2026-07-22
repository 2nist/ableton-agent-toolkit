/**
 * Parser router: dispatches files from the directory browser to the correct parser
 * based on file extension. Produces BlueprintSong objects ready for import.
 * After parsing, automatically enriches songs with LRCLIB synced lyrics.
 */

import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";
import type { DirectoryEntry } from "../../store/directoryStore";
import { parseMidiBytes, midiToBlueprintSong } from "./parseMidi";
import { audioToBlueprintSong, textToBlueprintSong } from "./parseAudio";
import { parseMcgillJcrd, parseRockCorpusJcrd } from "./parseJcrd";
import { searchLrclib, parseSyncedLyrics } from "../youtube";

export type ParseResult =
  | { ok: true; song: BlueprintSong }
  | { ok: false; error: string };

const INSTRUMENTAL_ROLES = new Set(["solo", "intro", "outro", "breakdown"]);

async function enrichWithLrclib(song: BlueprintSong): Promise<BlueprintSong> {
  const hasLyrics = song.sections.some(
    (s) => (s.lyrics && s.lyrics.trim().length > 0) || (s.lyricsTimeline && s.lyricsTimeline.length > 0),
  );
  if (hasLyrics) return song;

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
      (song as unknown as Record<string, unknown>).sections = [{ id: sectionId, name: "Full Song", role: "verse", bars: Math.max(16, Math.ceil(timeline.length / 4)), chords: [], beatsPerChord: 4, velocity: "mf", timeSignatureNumerator: 4, timeSignatureDenPower: 2, lyrics: fullText, lyricsTimeline }];
      (song as unknown as Record<string, unknown>).arrangement = [{ sectionId, repeats: 1 }];
    }
    if (song.provenance) song.provenance.warnings = [...(song.provenance.warnings ?? []), "LRCLIB synced lyrics attached"];
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
        // Auto-detect McGill JCRD format (has source + sections with chord labels, no arrangement)
        if (raw && typeof raw === "object" && "source" in raw && "sections" in raw && !("arrangement" in raw)) {
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