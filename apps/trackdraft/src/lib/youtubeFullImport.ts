/**
 * YouTube → BlueprintSong full import pipeline — chord parsing and assembly
 * logic shared between the ActionBar browser component and the
 * ChordMiniApp CLI bridge script.
 */

import { parseSyncedLyrics } from "./youtube";
import type { BlueprintSong, BlueprintSection, LyricsTimelineEntry } from "../types/blueprint";
import type { NoteName, ChordQuality } from "@music-theory/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChordMiniAppResult {
  key: string;
  scale: string;
  bpm: number;
  time_signature?: { numerator: number; denominator: number };
  chords: Array<{ chord: string; start_time: number; duration: number; confidence?: number }>;
  segments?: Array<{ label: string; start_time: number; end_time: number }>;
}

export interface LrclibData {
  syncedLyrics?: string;
  plainLyrics?: string;
}

// ---------------------------------------------------------------------------
// Chord name parsing
// ---------------------------------------------------------------------------

/**
 * Parse a chord name like "Cmaj7", "F#min", "Bbdim", "G7" into root + quality.
 * Handles enharmonic note names (both sharps and flats).
 *
 * Supported formats:
 *   "C"     → maj
 *   "Cm"    → min
 *   "C#m"   → min (sharp root)
 *   "Bbmaj7" → maj7
 *   "Ebdim"  → dim
 *   "G7"     → dom7
 *   "Asus4"  → sus4
 *   "F#m7b5" → m7b5
 */
export function parseChordName(chordName: string): { root: NoteName; quality: ChordQuality } | null {
  const match = chordName.match(/^([A-G][#b]?)(maj7|min7|m7b5|maj|min|m|dim|aug|sus2|sus4|7)?$/i);
  if (!match) return null;

  const rawRoot = match[1];
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

  return { root, quality: qualityMap[suffix] ?? "maj" };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const SECTION_ROLE_MAP: Record<string, BlueprintSection["role"]> = {
  intro: "intro",
  verse: "verse",
  chorus: "chorus",
  pre_chorus: "verse",
  prechorus: "verse",
  bridge: "bridge",
  outro: "outro",
  solo: "solo",
  breakdown: "breakdown",
};

/**
 * Converts ChordMiniApp analysis JSON + optional LRCLIB lyrics into a
 * complete BlueprintSong ready for import.
 *
 * @param json - ChordMiniApp analysis result (chords, key, BPM, segments)
 * @param title - Song title
 * @param artist - Optional artist name
 * @param lrclibData - Optional LRCLIB lyrics data (syncedLyrics + plainLyrics)
 * @returns A complete BlueprintSong with populated sections, chords, and lyrics
 */
export function chordMiniAppToBlueprintSong(
  json: ChordMiniAppResult,
  title: string,
  artist?: string,
  lrclibData?: LrclibData | null,
): BlueprintSong {
  const now = new Date().toISOString();
  const scale = json.scale?.toLowerCase() === "minor" ? "aeolian" : "ionian";
  const key = (json.key ?? "C") as NoteName;
  const bpm = json.bpm && json.bpm > 0 ? json.bpm : 120;
  const timeSigNum = json.time_signature?.numerator ?? 4;
  const timeSigDen = json.time_signature?.denominator ?? 4;
  const secondsPerBeat = bpm > 0 ? 60 / bpm : 0.5; // default 120bpm

  // Convert chords from seconds to beats
  const allChords = (json.chords ?? []).map((c) => {
    const parsed = parseChordName(c.chord);
    const durationBeats = secondsPerBeat > 0
      ? Math.max(1, Math.round((c.duration / secondsPerBeat) * 100) / 100)
      : 4;
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
  const segmentCount = json.segments?.length ?? 0;

  if (segmentCount > 0) {
    sections = json.segments!.map((seg, i) => {
      const durationBeats = secondsPerBeat > 0
        ? (seg.end_time - seg.start_time) / secondsPerBeat
        : seg.end_time - seg.start_time;
      const chordsPerSegment = Math.ceil(allChords.length / Math.max(1, segmentCount));
      const segmentChordSlice = allChords.slice(i * chordsPerSegment, (i + 1) * chordsPerSegment);
      const role: BlueprintSection["role"] = SECTION_ROLE_MAP[seg.label?.toLowerCase()] ?? "custom";

      return {
        id: crypto.randomUUID(),
        name: seg.label || `Section ${i + 1}`,
        role,
        bars: Math.max(4, Math.ceil(Math.max(1, durationBeats) / timeSigNum)),
        chords: segmentChordSlice,
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenPower: Math.log2(timeSigDen),
      };
    });
  } else if (allChords.length > 0) {
    const totalBeats = allChords.reduce((sum, c) => sum + c.beats, 0);
    sections = [{
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(16, Math.ceil(totalBeats / timeSigNum)),
      chords: allChords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: Math.log2(timeSigDen),
    }];
  }

  // Attach lyrics if available
  if (lrclibData?.syncedLyrics && sections.length > 0) {
    const timeline = parseSyncedLyrics(lrclibData.syncedLyrics, bpm);
    if (timeline.length > 0) {
      const fullText = lrclibData.plainLyrics || timeline.map((t) => t.text).join("\n");
      const lyricsTimeline: LyricsTimelineEntry[] = timeline.map((t) => ({ text: t.text, startBeat: t.startBeat }));

      if (sections.length === 1) {
        sections[0].lyrics = fullText;
        sections[0].lyricsTimeline = lyricsTimeline;
      } else {
        let cumulativeBeats = 0;
        for (const section of sections) {
          const sectionBeats = section.bars * timeSigNum;
          const endBeat = cumulativeBeats + sectionBeats;
          const sectionLyrics = lyricsTimeline.filter(
            (l) => l.startBeat >= cumulativeBeats && l.startBeat < endBeat,
          );
          if (sectionLyrics.length > 0) {
            section.lyrics = sectionLyrics.map((l) => l.text).join("\n");
            section.lyricsTimeline = sectionLyrics;
          }
          cumulativeBeats = endBeat;
        }
      }
    }
  }

  const warnings = [
    "Chord detection by ChordMiniApp — review and adjust.",
    `Key: ${key} ${json.scale ?? "major"}, BPM: ${bpm}`,
  ];
  if (lrclibData?.syncedLyrics) {
    warnings.push("Synced lyrics from LRCLIB — review section boundaries.");
  }

  return {
    id: crypto.randomUUID(),
    title,
    artist,
    key,
    scale: scale as BlueprintSong["scale"],
    bpm,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: timeSigDen,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    concept: `YouTube full import: ${json.chords?.length ?? 0} chords, ${segmentCount} segments${lrclibData?.syncedLyrics ? ", synced lyrics" : ""}`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings,
    },
    createdAt: now,
    updatedAt: now,
  };
}