/**
 * Canonical chord-name parsing and ChordMiniApp → BlueprintSong conversion.
 *
 * Single source of truth shared by:
 *   - apps/trackdraft/src/lib/youtubeFullImport.ts     (browser ActionBar)
 *   - apps/trackdraft/scripts/chordmini-bridge.ts       (CLI bridge)
 *   - extensions/trackdraft-bridge                      (Ableton extension)
 *
 * Every adapter that ingests ChordMiniApp analysis JSON routes through
 * chordMiniAppToBlueprintSong() here — no duplicate, out-of-sync
 * implementations that can silently corrupt blueprint data.
 */

import type { NoteName, ChordQuality } from "@music-theory/core";
import type { BlueprintSong, BlueprintSection, LyricsTimelineEntry } from "./index";
import { SECTION_ROLE_MAP } from "./index";

// ---------------------------------------------------------------------------
// Input types (what ChordMiniApp / LRCLIB return)
// ---------------------------------------------------------------------------

/** ChordMiniApp can return chords in two formats:
 *  1. Raw chord names (chord + start_time + duration) — needs parseChordName()
 *  2. Pre-parsed chords (root + quality + beats) — use directly
 */
export interface ChordMiniAppRawChord {
  chord: string;
  start_time: number;
  duration: number;
  confidence?: number;
}
export interface ChordMiniAppParsedChord {
  id?: string;
  root: string;
  quality: string;
  romanNumeral?: string;
  beats: number;
}
export interface ChordMiniAppResult {
  key: string;
  scale: string;
  bpm: number;
  duration?: number;
  mode?: string;
  key_confidence?: number;
  time_signature?: { numerator: number; denominator: number };
  chords: Array<ChordMiniAppRawChord | ChordMiniAppParsedChord>;
  segments?: Array<{
    label?: string;
    start_time?: number;
    end_time?: number;
    /** ChordMiniApp also emits bare `start`/`end` without a label (YT import path). */
    start?: number;
    end?: number;
    loudness?: number;
  }>;
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
  // Guard against empty/undefined chord names from malformed ChordMiniApp output
  if (!chordName || typeof chordName !== "string" || chordName.trim().length === 0) return null;
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
// LRCLIB synced lyrics → timeline
// ---------------------------------------------------------------------------

/**
 * Parse LRCLIB synced lyrics into BlueprintSong's LyricsTimelineEntry[] format.
 * LRCLIB synced lyrics format: [mm:ss.xx]Line text\n[mm:ss.xx]Next line...
 */
export function parseSyncedLyrics(syncedLyrics: string, bpm: number = 120): LyricsTimelineEntry[] {
  const lines = syncedLyrics.split("\n");
  const timeline: LyricsTimelineEntry[] = [];
  const secondsPerBeat = 60 / bpm;

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centiseconds = parseInt(match[3], 10);
      const totalSeconds = minutes * 60 + seconds + centiseconds / (match[3].length === 3 ? 1000 : 100);
      const startBeat = totalSeconds / secondsPerBeat;
      timeline.push({ startBeat: Math.round(startBeat * 100) / 100, text: match[4].trim() });
    }
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// Conversion constants & limits
// ---------------------------------------------------------------------------

const MIN_BARS = 4;
const MAX_SECTIONS = 16;

// ---------------------------------------------------------------------------
// ChordMiniApp JSON → BlueprintSong
// ---------------------------------------------------------------------------

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
  // The ChordMiniApp server returns the mode as `mode` ("minor"/"major");
  // older shapes used `scale`. Reading only `scale` made EVERY analyzed
  // song come out ionian regardless of the real mode (found in the YT
  // ingestion test, 2026-09-20 — the app had the same bug via this shared
  // adapter).
  const scaleTag = (json.scale ?? json.mode ?? "").toLowerCase();
  const scale = scaleTag.includes("minor") || scaleTag.includes("aeolian") ? "aeolian" : "ionian";
  const key = (json.key ?? "C") as NoteName;
  const bpm = json.bpm && json.bpm > 0 ? json.bpm : 120;
  const timeSigNum = json.time_signature?.numerator ?? 4;
  const timeSigDen = json.time_signature?.denominator ?? 4;
  const secondsPerBeat = bpm > 0 ? 60 / bpm : 0.5; // default 120bpm

  // Convert chords — handle two formats the Python ChordMiniApp may return:
  //   Format A (raw):   { chord: "Cmaj7", start_time, duration }
  //   Format B (parsed): { root: "C", quality: "maj", romanNumeral: "I", beats: 2 }
  const allChords = (json.chords ?? [])
    .filter((c) => {
      // Accept either format: raw chord name OR pre-parsed root+quality
      const isRaw = c && "chord" in c && typeof (c as ChordMiniAppRawChord).chord === "string" && (c as ChordMiniAppRawChord).chord.trim().length > 0;
      const isParsed = c && "root" in c && typeof (c as ChordMiniAppParsedChord).root === "string";
      return isRaw || isParsed;
    })
    .map((c) => {
      // Format B: pre-parsed (the Python server sends this)
      if ("root" in c && typeof (c as ChordMiniAppParsedChord).root === "string") {
        const parsed = c as ChordMiniAppParsedChord;
        return {
          id: parsed.id || crypto.randomUUID(),
          romanNumeral: parsed.romanNumeral || parsed.root,
          root: parsed.root as NoteName,
          quality: parsed.quality as ChordQuality,
          beats: parsed.beats || 2,
        };
      }
      // Format A: raw (parseChordName path)
      const raw = c as ChordMiniAppRawChord;
      const chordParsed = parseChordName(raw.chord);
      const durationBeats = secondsPerBeat > 0
        ? Math.max(1, Math.round((raw.duration / secondsPerBeat) * 100) / 100)
        : 4;
      return {
        id: crypto.randomUUID(),
        romanNumeral: chordParsed?.root ?? "C",
        root: chordParsed?.root ?? "C",
        quality: chordParsed?.quality ?? "maj",
        beats: Math.round(durationBeats),
      };
    });

  // Build sections from segments — merge adjacent same-label slices,
  // distribute chords proportionally, and cap at 16 so the UI stays
  // usable (ChordMiniApp can emit 300+ beat-level time slices).
  let sections: BlueprintSection[] = [];
  const rawSegments = json.segments ?? [];

  if (rawSegments.length > 0) {
    // Step 1: merge adjacent segments with the same label
    const merged: Array<{ label: string; startTime: number; endTime: number }> = [];
    for (const seg of rawSegments) {
      // The server sends bare `start`/`end` (no label) on loudness segments —
      // accept both shapes. Skip invalid time values: ChordMiniApp can emit
      // NaN, Infinity, or missing start/end times in malformed output.
      const segStart = seg.start_time ?? seg.start ?? NaN;
      const segEnd = seg.end_time ?? seg.end ?? NaN;
      if (!isFinite(segStart) || !isFinite(segEnd)) continue;
      const label = seg.label || "Section";
      const last = merged[merged.length - 1];
      if (last && last.label === label) {
        last.endTime = segEnd;
      } else {
        merged.push({ label, startTime: segStart, endTime: segEnd });
      }
    }

    // Step 2: cap at MAX_SECTIONS, extending final end time
    const capped = merged.slice(0, MAX_SECTIONS);
    if (capped.length > 0 && merged.length > MAX_SECTIONS) {
      capped[capped.length - 1].endTime = merged[merged.length - 1].endTime;
    }

    // Span from the first section's start to the last section's end. Also
    // valid for a single merged section, which must still receive all chords
    // (the old `length > 1` guard silently dropped every chord in that case).
    const totalBeats =
      capped.length > 0 && secondsPerBeat > 0
        ? (capped[capped.length - 1].endTime - capped[0].startTime) / secondsPerBeat
        : 0;

    sections = capped.map((seg) => {
      let durationBeats =
        secondsPerBeat > 0
          ? (seg.endTime - seg.startTime) / secondsPerBeat
          : seg.endTime - seg.startTime;
      if (!isFinite(durationBeats) || durationBeats <= 0) durationBeats = MIN_BARS * timeSigNum;
      const role: BlueprintSection["role"] =
        SECTION_ROLE_MAP[seg.label?.toLowerCase()] ?? "custom";

      // Distribute chords proportionally across merged sections
      let segmentChords: typeof allChords = [];
      if (allChords.length > 0 && totalBeats > 0) {
        const sectionStart =
          secondsPerBeat > 0
            ? (seg.startTime - capped[0].startTime) / secondsPerBeat
            : 0;
        const sectionEnd = sectionStart + durationBeats;
        segmentChords = allChords.filter((_, idx) => {
          const pos = idx / allChords.length;
          return pos >= sectionStart / totalBeats && pos < sectionEnd / totalBeats;
        });
      }

      return {
        id: crypto.randomUUID(),
        name: seg.label || `Section ${capped.indexOf(seg) + 1}`,
        role,
        bars: Math.max(MIN_BARS, Math.ceil(Math.max(1, durationBeats) / timeSigNum)),
        chords: segmentChords,
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenPower: Math.log2(timeSigDen),
      };
    });
  }

  // No usable segments — fall back to a single "Full Song" section
  if (sections.length === 0 && allChords.length > 0) {
    const totalBeats = allChords.reduce((sum, c) => sum + c.beats, 0);
    sections = [{
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(MIN_BARS * 4, Math.ceil(totalBeats / timeSigNum)),
      chords: allChords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: Math.log2(timeSigDen),
    }];
  }

  // Segments existed but all chord names were filtered out — produce one
  // section so the song isn't completely empty (covers malformed
  // ChordMiniApp output where every .chord field is null).
  if (sections.length === 0 && rawSegments.length > 0) {
    const lastSeg = rawSegments[rawSegments.length - 1];
    const durationSeconds =
      (lastSeg.end_time ?? lastSeg.end ?? 0) - (rawSegments[0].start_time ?? rawSegments[0].start ?? 0);
    sections = [{
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(MIN_BARS * 4, Math.ceil(Math.max(MIN_BARS, durationSeconds * (bpm / 60) / timeSigNum))),
      chords: [],
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
    `Key: ${key} ${json.scale ?? json.mode ?? "major"}, BPM: ${bpm}`,
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
    concept: `YouTube full import: ${json.chords?.length ?? 0} chords, ${rawSegments.length} segments${lrclibData?.syncedLyrics ? ", synced lyrics" : ""}`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings,
    },
    createdAt: now,
    updatedAt: now,
  };
}