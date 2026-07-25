/**
 * ChordMiniApp Bridge — calls the Python backend for audio analysis and
 * converts the output to a BlueprintSong (.trackdraft.json) ready for import.
 *
 * Usage:
 *   npx tsx scripts/chordmini-bridge.ts <path-to-audio-file> [output-path] [--lyrics <lrclib-json-file>]
 *
 * The Python ChordMiniApp server (default: http://localhost:5000) receives the
 * audio file, runs chord detection + beat tracking + structural segmentation,
 * and returns a JSON analysis. This script converts that JSON to the canonical
 * BlueprintSong schema (via the shared @music-theory/song-blueprint adapters),
 * writes a .trackdraft.json file, and prints ingest statistics.
 *
 * Requires: ChordMiniApp Python server running (separate process).
 *
 * Output:
 *   - Writes a .trackdraft.json file (same directory as source, or custom path)
 *   - Prints section count, chord count, detected key, BPM
 *   - The resulting file is immediately importable via the TrackDraft directory
 *     browser or the ActionBar's "Import .json" button.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Canonical shared adapter — single source of truth, same as the browser
// ActionBar uses via youtubeFullImport.ts.
import {
  chordMiniAppToBlueprintSong,
} from "@music-theory/song-blueprint";
import type {
  ChordMiniAppResult,
  LrclibData,
} from "@music-theory/song-blueprint";
import type { BlueprintSong } from "../src/types/blueprint";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChordMiniAppError {
  error: string;
}

function parseArgs(): { audioPath: string; outputPath: string; lyricsPath?: string } {
  const args = process.argv.slice(2);
  let audioPath = "";
  let outputPath = "";
  let lyricsPath: string | undefined;

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--lyrics" && i + 1 < args.length) {
      lyricsPath = args[i + 1];
      i += 2;
    } else if (!audioPath) {
      audioPath = args[i];
      i++;
    } else if (!outputPath) {
      outputPath = args[i];
      i++;
    } else {
      i++;
    }
  }

  if (!outputPath) {
    outputPath = path.join(
      path.dirname(path.resolve(audioPath)),
      path.basename(audioPath, path.extname(audioPath)).replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".trackdraft.json",
    );
  }

  return { audioPath, outputPath, lyricsPath };
}

async function loadLyricsFile(lyricsPath?: string): Promise<LrclibData | null> {
  if (!lyricsPath) return null;

  try {
    const raw = fs.readFileSync(lyricsPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      syncedLyrics: typeof data.syncedLyrics === "string" ? data.syncedLyrics : undefined,
      plainLyrics: typeof data.plainLyrics === "string" ? data.plainLyrics : undefined,
    };
  } catch (err) {
    console.warn(`Warning: Could not load lyrics file "${lyricsPath}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/chordmini-bridge.ts <audio-file> [output-path] [--lyrics <lrclib-json-file>]");
    console.error("  audio-file: Path to an audio file (mp3, wav, flac, etc.)");
    console.error("  output-path: Optional output .trackdraft.json path (default: same dir as source)");
    console.error("  --lyrics <path>: Optional LRCLIB JSON file with syncedLyrics/plainLyrics fields");
    process.exit(1);
  }

  const { audioPath, outputPath, lyricsPath } = parseArgs();

  if (!audioPath || !fs.existsSync(audioPath)) {
    console.error(`Audio file not found: ${audioPath || "(none provided)"}`);
    process.exit(1);
  }

  const title = path.basename(audioPath, path.extname(audioPath)).replace(/[-_]/g, " ");

  console.log(`Sending ${audioPath} to ChordMiniApp at ${CHORDMINI_URL}...`);

  try {
    // Read audio file as FormData
    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer]);
    const formData = new FormData();
    formData.append("audio", blob, path.basename(audioPath));

    const res = await fetch(CHORDMINI_URL, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as ChordMiniAppError;
      throw new Error(body.error ?? `ChordMiniApp returned ${res.status}`);
    }

    const json = await res.json() as ChordMiniAppResult;

    if (!json.chords || json.chords.length === 0) {
      console.warn("Warning: ChordMiniApp returned 0 chords — the output will be a skeleton.");
    }

    // Load optional LRCLIB lyrics data
    const lrclibData = await loadLyricsFile(lyricsPath);

    // Use the canonical shared adapter (same code path as the browser)
    const song = chordMiniAppToBlueprintSong(json, title, undefined, lrclibData);

    fs.writeFileSync(outputPath, JSON.stringify(song, null, 2));
    console.log(`\n✅ Written: ${outputPath}`);
    console.log(`   Title: ${song.title}`);
    console.log(`   Key: ${song.key} ${song.scale}`);
    console.log(`   BPM: ${song.bpm}`);
    console.log(`   Sections: ${song.sections.length}`);
    console.log(`   Total chords: ${song.sections.reduce((sum, s) => sum + s.chords.length, 0)}`);
    if (lrclibData?.syncedLyrics) {
      console.log(`   Lyrics: synced (from file)`);
    }
    console.log(`\nImport this file via the TrackDraft directory browser or ActionBar → Import .json.`);
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    console.error("\nMake sure the ChordMiniApp Python server is running.");
    console.error("Expected API: POST /analyze with multipart form field 'audio'.");
    process.exit(1);
  }
}

main();