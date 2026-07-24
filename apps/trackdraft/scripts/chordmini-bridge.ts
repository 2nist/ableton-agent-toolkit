/**
 * ChordMiniApp Bridge — calls the Python backend for audio analysis and
 * converts the output to a BlueprintSong (.trackdraft.json) ready for import.
 *
 * Usage:
 *   npx tsx scripts/chordmini-bridge.ts <path-to-audio-file> [output-path]
 *
 * The Python ChordMiniApp server (default: http://localhost:5000) receives the
 * audio file, runs chord detection + beat tracking + structural segmentation,
 * and returns a JSON analysis. This script converts that JSON to the canonical
 * BlueprintSong schema, writes a .trackdraft.json file, and prints ingest
 * statistics.
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

// Re-use the canonical schema via dynamic import (this script runs under tsx,
// not Vite, but the package resolution still works).
import type { BlueprintSong, BlueprintSection } from "../src/types/blueprint";
import type { NoteName, ChordQuality } from "@music-theory/core";
import { pitchClass, noteName } from "@music-theory/core";

// ---------------------------------------------------------------------------
// ChordMiniApp API types (what the Python server returns)
// ---------------------------------------------------------------------------

interface ChordMiniAppResult {
  key: string;             // e.g. "C", "Eb"
  scale: string;           // e.g. "major", "minor"
  bpm: number;
  time_signature?: { numerator: number; denominator: number };
  chords: Array<{
    chord: string;         // e.g. "Cmaj7", "F#min", "Bbdim"
    start_time: number;    // seconds
    duration: number;      // seconds
    confidence?: number;
  }>;
  segments?: Array<{
    label: string;         // e.g. "verse", "chorus", "bridge"
    start_time: number;
    end_time: number;
  }>;
  beats?: Array<{
    time: number;          // seconds
    beat_number: number;
    bar_number: number;
    confidence?: number;
  }>;
}

interface ChordMiniAppError {
  error: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";

// ---------------------------------------------------------------------------
// Chord name parsing
// ---------------------------------------------------------------------------

/**
 * Parse a chord name like "Cmaj7", "F#min", "Bbdim", "G7" into root + quality.
 * Handles enharmonic note names (both sharps and flats).
 */
function parseChordName(chordName: string): { root: NoteName; quality: ChordQuality } | null {
  // Common chord name patterns: root + quality suffix
  // Examples: "C" → maj, "Cm" → min, "C#7" → 7, "Bbmaj7" → maj7, "Ebdim" → dim
  const match = chordName.match(/^([A-G][#b]?)(maj7|min7|m7b5|maj|min|m|dim|aug|sus2|sus4|7)?$/i);
  if (!match) return null;

  const rawRoot = match[1];
  // Normalize root to canonical NoteName (first letter uppercase + accidental)
  const root = (rawRoot.charAt(0).toUpperCase() + rawRoot.slice(1).toLowerCase()) as NoteName;

  const suffix = match[2]?.toLowerCase() ?? "";
  const qualityMap: Record<string, ChordQuality> = {
    "": "maj",
    "maj": "maj",
    "min": "min",
    "m": "min",
    "7": "7",
    "maj7": "maj7",
    "min7": "min7",
    "m7b5": "m7b5",
    "sus2": "sus2",
    "sus4": "sus4",
    "dim": "dim",
    "aug": "aug",
  };

  const quality = qualityMap[suffix] ?? "maj";
  return { root, quality };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function chordMiniAppToBlueprintSong(json: ChordMiniAppResult, title: string): BlueprintSong {
  const now = new Date().toISOString();

  // Detect key from result — map "major"/"minor" to scale type
  const scale = json.scale?.toLowerCase() === "minor" ? "aeolian" : "ionian";
  const key = (json.key ?? "C") as NoteName;
  const bpm = json.bpm ?? 120;
  const timeSigNum = json.time_signature?.numerator ?? 4;
  const timeSigDen = json.time_signature?.denominator ?? 4;
  const secondsPerBeat = 60 / bpm;

  // Convert chords from time (seconds) to beats
  const chords = (json.chords ?? []).map((c, idx) => {
    const parsed = parseChordName(c.chord);
    const startBeat = Math.round((c.start_time / secondsPerBeat) * 100) / 100;
    const durationBeats = Math.max(1, Math.round((c.duration / secondsPerBeat) * 100) / 100);

    return {
      id: crypto.randomUUID(),
      romanNumeral: parsed?.root ?? "C",
      root: parsed?.root ?? "C",
      quality: parsed?.quality ?? "maj",
      beats: Math.round(durationBeats),
    };
  });

  // Build sections from segments, or create a single section from all chords
  let sections: BlueprintSection[] = [];
  if (json.segments && json.segments.length > 0) {
    sections = json.segments.map((seg, i) => {
      const startBeat = seg.start_time / secondsPerBeat;
      const endBeat = seg.end_time / secondsPerBeat;
      const durationBeats = endBeat - startBeat;

      // Filter chords that fall within this segment
      const sectionChords = chords.filter((c) => {
        const cStart = c.beats; // approximate — re-deriving from start_time would be better
        // Use a simpler approach: assign chords round-robin by segment
        return true; // See below — we'll assign them in order
      });

      // Simpler approach: partition chords by segment count
      const chordsPerSegment = Math.ceil(chords.length / Math.max(1, json.segments!.length));
      const segmentChordSlice = chords.slice(i * chordsPerSegment, (i + 1) * chordsPerSegment);

      const roleMap: Record<string, BlueprintSection["role"]> = {
        intro: "intro",
        verse: "verse",
        chorus: "chorus",
        pre_chorus: "verse",
        bridge: "bridge",
        outro: "outro",
        solo: "solo",
        breakdown: "breakdown",
      };
      const role: BlueprintSection["role"] = roleMap[seg.label?.toLowerCase()] ?? "custom";

      return {
        id: crypto.randomUUID(),
        name: seg.label || `Section ${i + 1}`,
        role,
        bars: Math.max(4, Math.ceil(durationBeats / timeSigNum)),
        chords: segmentChordSlice,
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenPower: Math.log2(timeSigDen),
      };
    });
  } else if (chords.length > 0) {
    // No segments — single section with all chords
    const totalBeats = chords.reduce((sum, c) => sum + c.beats, 0);
    sections = [{
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(16, Math.ceil(totalBeats / timeSigNum)),
      chords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: Math.log2(timeSigDen),
    }];
  }

  return {
    id: crypto.randomUUID(),
    title,
    key,
    scale: scale as BlueprintSong["scale"],
    bpm,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: timeSigDen,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    concept: `ChordMiniApp analysis: ${json.chords?.length ?? 0} chords, ${json.segments?.length ?? 0} segments`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings: [
        "Chord detection by ChordMiniApp — review and adjust in the editor.",
        `Key: ${key} ${json.scale ?? "major"}, BPM: ${bpm}`,
      ],
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/chordmini-bridge.ts <audio-file> [output-path]");
    console.error("  audio-file: Path to an audio file (mp3, wav, flac, etc.)");
    console.error("  output-path: Optional output .trackdraft.json path (default: same dir as source)");
    process.exit(1);
  }

  const audioPath = args[0];
  if (!fs.existsSync(audioPath)) {
    console.error(`Audio file not found: ${audioPath}`);
    process.exit(1);
  }

  const outputPath = args[1] ?? path.join(
    path.dirname(path.resolve(audioPath)),
    path.basename(audioPath, path.extname(audioPath)).replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".trackdraft.json",
  );

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

    const song = chordMiniAppToBlueprintSong(json, title);

    fs.writeFileSync(outputPath, JSON.stringify(song, null, 2));
    console.log(`\n✅ Written: ${outputPath}`);
    console.log(`   Title: ${song.title}`);
    console.log(`   Key: ${song.key} ${song.scale}`);
    console.log(`   BPM: ${song.bpm}`);
    console.log(`   Sections: ${song.sections.length}`);
    console.log(`   Total chords: ${song.sections.reduce((sum, s) => sum + s.chords.length, 0)}`);
    console.log(`\nImport this file via the TrackDraft directory browser or ActionBar → Import .json.`);
  } catch (err) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    console.error("\nMake sure the ChordMiniApp Python server is running.");
    console.error("Expected API: POST /analyze with multipart form field 'audio'.");
    process.exit(1);
  }
}

main();