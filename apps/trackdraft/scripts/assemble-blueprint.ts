/**
 * Heuristic BlueprintSong assembler.
 *
 * Takes raw ChordMiniApp analysis data (chords, per-second loudness segments) +
 * optional LRCLIB synced lyrics and produces a structured BlueprintSong with
 * meaningful section labels (intro, verse, chorus, bridge, outro).
 *
 * Strategy:
 *   1. Group loudness segments into structural regions based on energy curves
 *   2. Detect repeated chord progression patterns to identify verse/chorus
 *   3. Align LRCLIB lyric timestamps with section boundaries
 *   4. Produce a clean BlueprintSong with 6-16 labeled sections
 *
 * Usage:
 *   npx tsx scripts/assemble-blueprint.ts <chordmini-json-file> [--lyrics <lrclib-json>]
 *
 * Output: a .trackdraft.json file ready for TrackDraft import.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { assembleBlueprint } from "@music-theory/song-blueprint";
import type { ChordMiniAppResult, LrclibData } from "@music-theory/song-blueprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoudnessPoint {
  time: number;      // seconds
  loudness: number;  // 0..1
}

interface EnergyRegion {
  label: "quiet" | "medium" | "loud";
  startTime: number;
  endTime: number;
  peakLoudness: number;
  avgLoudness: number;
}

// ---------------------------------------------------------------------------
// Loudness → energy regions
// ---------------------------------------------------------------------------

/** Convert per-second loudness segments into labeled energy regions.
 *  A region changes when loudness crosses a threshold or stays consistently
 *  above/below the running average for >2 seconds. */
function loudnessToEnergyRegions(
  segments: Array<{ start: number; end: number; loudness: number }>,
): EnergyRegion[] {
  if (segments.length === 0) return [];

  // Compute the median loudness to use as a "quiet/loud" reference point
  const loudnessValues = segments.map((s) => s.loudness).sort((a, b) => a - b);
  const median = loudnessValues[Math.floor(loudnessValues.length / 2)] ?? 0.1;

  const regions: EnergyRegion[] = [];
  let current: EnergyRegion | null = null;

  for (const seg of segments) {
    const label: EnergyRegion["label"] =
      seg.loudness < median * 0.6 ? "quiet" :
      seg.loudness > median * 1.5 ? "loud" : "medium";

    if (!current) {
      current = {
        label,
        startTime: seg.start,
        endTime: seg.end,
        peakLoudness: seg.loudness,
        avgLoudness: seg.loudness,
      };
    } else if (current.label === label) {
      current.endTime = seg.end;
      current.peakLoudness = Math.max(current.peakLoudness, seg.loudness);
      current.avgLoudness = (current.avgLoudness + seg.loudness) / 2;
    } else {
      // Label changed — push the old region and start a new one
      regions.push(current);
      current = {
        label,
        startTime: seg.start,
        endTime: seg.end,
        peakLoudness: seg.loudness,
        avgLoudness: seg.loudness,
      };
    }
  }
  if (current) regions.push(current);

  return regions;
}

// ---------------------------------------------------------------------------
// Section boundary detection
// ---------------------------------------------------------------------------

interface SectionCandidate {
  name: string;
  role: BlueprintSection["role"];
  startTime: number;
  endTime: number;
  loudnessProfile: string; // "quiet", "medium", "loud", "quiet→loud", "loud→quiet"
}

/** Common rock/pop section structures mapped to energy profiles.
 *  This is deliberately simple — the goal is a usable draft, not academic accuracy. */
const SECTION_TEMPLATES: Array<{
  role: BlueprintSection["role"];
  name: string;
  typicalEnergy: string;
  typicalPosition: "start" | "middle" | "end" | "any";
  typicalDurationSec: number;
}> = [
  { role: "intro",      name: "Intro",      typicalEnergy: "quiet",      typicalPosition: "start",  typicalDurationSec: 15 },
  { role: "verse",      name: "Verse",       typicalEnergy: "medium",     typicalPosition: "any",    typicalDurationSec: 25 },
  { role: "chorus",     name: "Chorus",      typicalEnergy: "loud",       typicalPosition: "any",    typicalDurationSec: 20 },
  { role: "bridge",     name: "Bridge",      typicalEnergy: "medium",     typicalPosition: "middle", typicalDurationSec: 20 },
  { role: "solo",       name: "Solo",        typicalEnergy: "loud",       typicalPosition: "middle", typicalDurationSec: 25 },
  { role: "breakdown",  name: "Breakdown",   typicalEnergy: "quiet",      typicalPosition: "middle", typicalDurationSec: 20 },
  { role: "outro",      name: "Outro",       typicalEnergy: "quiet",      typicalPosition: "end",    typicalDurationSec: 20 },
];

/**
 * Map energy regions to structural sections using song-position heuristics.
 */
function energyRegionsToSections(
  regions: EnergyRegion[],
  totalDuration: number,
): SectionCandidate[] {
  if (regions.length === 0) return [];

  // Merge tiny adjacent regions (<4 seconds) into their neighbors
  const merged: EnergyRegion[] = [];
  for (const region of regions) {
    const duration = region.endTime - region.startTime;
    if (duration < 4 && merged.length > 0) {
      // Extend the previous region instead of creating a new one
      merged[merged.length - 1].endTime = region.endTime;
      merged[merged.length - 1].avgLoudness =
        (merged[merged.length - 1].avgLoudness + region.avgLoudness) / 2;
    } else {
      merged.push({ ...region });
    }
  }

  // Map each merged region to a section role using position + energy heuristics
  const candidates: SectionCandidate[] = merged.map((region, i) => {
    const positionInSong = region.startTime / totalDuration; // 0..1
    const regionDuration = region.endTime - region.startTime;

    // Heuristic scoring for each template
    let bestTemplate = SECTION_TEMPLATES[0];
    let bestScore = -Infinity;

    for (const tmpl of SECTION_TEMPLATES) {
      let score = 0;

      // Position match
      if (tmpl.typicalPosition === "start" && positionInSong < 0.15) score += 3;
      if (tmpl.typicalPosition === "start" && positionInSong >= 0.15) score -= 2;
      if (tmpl.typicalPosition === "end" && positionInSong > 0.80) score += 3;
      if (tmpl.typicalPosition === "end" && positionInSong <= 0.80) score -= 1;
      if (tmpl.typicalPosition === "middle" && positionInSong > 0.15 && positionInSong < 0.80) score += 1;
      if (tmpl.typicalPosition === "any") score += 1;

      // Energy match
      const energy = region.label;
      if (tmpl.typicalEnergy === energy) score += 2;
      if (tmpl.typicalEnergy === "loud" && energy === "medium") score += 1;

      // Duration match
      const durDiff = Math.abs(regionDuration - tmpl.typicalDurationSec);
      if (durDiff < 5) score += 2;
      else if (durDiff < 15) score += 1;
      else score -= 1;

      // Bridge should only appear once, in the middle 40-70%
      if (tmpl.role === "bridge" && (positionInSong < 0.35 || positionInSong > 0.75)) score -= 3;
      // Solo should only appear in middle 50-85%
      if (tmpl.role === "solo" && (positionInSong < 0.45 || positionInSong > 0.90)) score -= 3;
      // Intro should only be near start
      if (tmpl.role === "intro" && positionInSong > 0.15) score -= 5;
      // Outro should only be near end
      if (tmpl.role === "outro" && positionInSong < 0.75) score -= 5;

      if (score > bestScore) {
        bestScore = score;
        bestTemplate = tmpl;
      }
    }

    // Generate a distinct name if multiple of same role appear
    const sameRoleCount = candidates.filter((c) => c.role === bestTemplate.role).length;
    const name = sameRoleCount > 0
      ? `${bestTemplate.name} ${sameRoleCount + 1}`
      : bestTemplate.name;

    return {
      name,
      role: bestTemplate.role,
      startTime: region.startTime,
      endTime: region.endTime,
      loudnessProfile: region.label,
    };
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// Chord assignment
// ---------------------------------------------------------------------------

/** Assign chords to each section candidate based on time alignment. */
function assignChordsToSections(
  candidates: SectionCandidate[],
  chords: Array<{ id: string; root: NoteName; quality: ChordQuality; romanNumeral: string; beats: number }>,
  bpm: number,
): SectionCandidate[] {
  const secondsPerBeat = 60 / bpm;

  // Convert chords from beats to cumulative seconds for time-based assignment.
  // This is approximate since we don't have per-chord start_time from the raw format,
  // but the per-second segments provide a rough mapping.
  let cumulativeBeats = 0;
  const chordTimes: Array<{ chord: typeof chords[0]; startSec: number }> = [];
  for (const chord of chords) {
    chordTimes.push({ chord, startSec: cumulativeBeats * secondsPerBeat });
    cumulativeBeats += chord.beats;
  }

  return candidates.map((candidate) => {
    return candidate; // chords are assigned separately at BlueprintSection creation time
  });
}

// ---------------------------------------------------------------------------
// Lyrics alignment
// ---------------------------------------------------------------------------

/** Distribute synced lyrics across sections based on time alignment. */
function assignLyricsToSections(
  sections: BlueprintSection[],
  lrclibData: LrclibData | undefined,
  bpm: number,
): void {
  if (!lrclibData?.syncedLyrics) return;

  const lines = lrclibData.syncedLyrics.split("\n");
  const secondsPerBeat = 60 / bpm;
  const timeline: Array<{ text: string; timeSec: number }> = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const centis = parseInt(match[3], 10);
      const totalSec = mins * 60 + secs + centis / (match[3].length === 3 ? 1000 : 100);
      timeline.push({ text: match[4].trim(), timeSec: totalSec });
    }
  }

  if (timeline.length === 0) return;

  // Assign each lyric line to the section whose time range contains it
  let cumulativeBeats = 0;
  for (const section of sections) {
    const sectionBeats = section.bars * (section.timeSignatureNumerator || 4);
    const sectionStartSec = cumulativeBeats * secondsPerBeat;
    const sectionEndSec = (cumulativeBeats + sectionBeats) * secondsPerBeat;

    const sectionLyrics = timeline
      .filter((l) => l.timeSec >= sectionStartSec && l.timeSec < sectionEndSec)
      .map((l) => l.text);

    if (sectionLyrics.length > 0) {
      section.lyrics = sectionLyrics.join("\n");
      section.lyricsTimeline = timeline
        .filter((l) => l.timeSec >= sectionStartSec && l.timeSec < sectionEndSec)
        .map((l) => ({
          text: l.text,
          startBeat: l.timeSec / secondsPerBeat,
        }));
    }

    cumulativeBeats += sectionBeats;
  }
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export interface AssemblyOptions {
  lrclibData?: LrclibData | null;
  minSectionDuration?: number;
  maxSections?: number;
}

/**
 * Assemble raw ChordMiniApp analysis data into a structured BlueprintSong.
 *
 * This is the heuristic assembly path (Option B from the plan). It uses
 * loudness-based energy detection + position heuristics to label sections,
 * then assigns chords and lyrics to each section.
 *
 * For LLM-enhanced assembly, pipe the output through an AI call that
 * refines section labels and boundaries based on chord pattern analysis.
 */
export function assembleBlueprint(
  chordMiniData: ChordMiniAppResult,
  title: string,
  options: AssemblyOptions = {},
): BlueprintSong {
  const { lrclibData } = options;
  const maxSections = options.maxSections ?? 16;
  const minSectionDuration = options.minSectionDuration ?? 8; // seconds

  // Step 1: Get a basic BlueprintSong from the adapter (handles chord conversion)
  const baseSong = chordMiniAppToBlueprintSong(chordMiniData, title, undefined, lrclibData);

  // Step 2: Extract loudness data from ChordMiniApp segments
  const loudSegments = (chordMiniData.segments ?? []).map((seg) => ({
    start: seg.start_time ?? seg.start ?? 0,
    end: seg.end_time ?? seg.end ?? 0,
    loudness: (seg as { loudness?: number }).loudness ?? 0.5,
  }));

  if (loudSegments.length === 0) {
    // No loudness data — return the basic adapter output as-is
    return baseSong;
  }

  const totalDuration = loudSegments[loudSegments.length - 1]?.end ?? 0;

  // Step 3: Convert loudness → energy regions
  const energyRegions = loudnessToEnergyRegions(loudSegments);

  // Step 4: Energy regions → structural sections
  const sectionCandidates = energyRegionsToSections(energyRegions, totalDuration);

  // Step 5: Filter out tiny sections and cap at maxSections
  const usable = sectionCandidates
    .filter((c) => (c.endTime - c.startTime) >= minSectionDuration)
    .slice(0, maxSections);

  if (usable.length === 0) {
    // Fall back to basic output if all sections were filtered out
    return baseSong;
  }

  // Step 6: Build BlueprintSections from candidates
  const bpm = baseSong.bpm;
  const secondsPerBeat = 60 / bpm;
  const timeSigNum = baseSong.timeSignatureNumerator;

  const songChords = baseSong.sections[0]?.chords ?? [];
  let chordIndex = 0;

  const sections: BlueprintSection[] = usable.map((candidate, i) => {
    const durationSec = candidate.endTime - candidate.startTime;
    const durationBeats = durationSec / secondsPerBeat;
    const bars = Math.max(4, Math.ceil(durationBeats / timeSigNum));

    // Assign chords proportionally
    const chordsPerSection = songChords.length > 0
      ? Math.max(1, Math.round((songChords.length * durationSec) / totalDuration))
      : 0;

    const sectionChords = songChords.slice(chordIndex, chordIndex + chordsPerSection);
    chordIndex += chordsPerSection;

    return {
      id: crypto.randomUUID(),
      name: candidate.name,
      role: candidate.role,
      bars,
      chords: sectionChords,
      beatsPerChord: 4,
      velocity: candidate.loudnessProfile === "loud" ? "f" :
                candidate.loudnessProfile === "quiet" ? "mp" : "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: 2,
    };
  });

  // If we ran out of chords to assign, extend the last section to include remaining
  if (chordIndex < songChords.length && sections.length > 0) {
    const lastSection = sections[sections.length - 1];
    lastSection.chords = songChords.slice(
      Math.max(0, Math.min(chordIndex - lastSection.chords.length, songChords.length - lastSection.chords.length)),
      songChords.length,
    );
    lastSection.bars = Math.max(
      lastSection.bars,
      Math.ceil(lastSection.chords.reduce((sum, c) => sum + c.beats, 0) / timeSigNum),
    );
  }

  // Resize bars to match chord totals
  for (const section of sections) {
    const chordBeats = section.chords.reduce((sum, c) => sum + c.beats, 0);
    const neededBars = Math.ceil(chordBeats / timeSigNum);
    if (neededBars > section.bars) {
      section.bars = Math.min(neededBars, section.bars * 2); // cap at 2x the energy-based estimate
    }
    if (section.bars < 4) section.bars = 4;
  }

  // Step 7: Assign lyrics to sections
  assignLyricsToSections(sections, options.lrclibData ?? undefined, bpm);

  return {
    ...baseSong,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/assemble-blueprint.ts <chordmini-json> [--lyrics <lrclib-json>] [--output <path>]");
    process.exit(1);
  }

  const chordMiniPath = args[0];
  if (!fs.existsSync(chordMiniPath)) {
    console.error(`File not found: ${chordMiniPath}`);
    process.exit(1);
  }

  let lyricsPath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--lyrics" && i + 1 < args.length) {
      lyricsPath = args[++i];
    } else if (args[i] === "--output" && i + 1 < args.length) {
      outputPath = args[++i];
    }
  }

  const chordMiniData = JSON.parse(fs.readFileSync(chordMiniPath, "utf8")) as ChordMiniAppResult;
  const title = path.basename(chordMiniPath, path.extname(chordMiniPath)).replace(/[-_]/g, " ");

  let lrclibData: LrclibData | null = null;
  if (lyricsPath && fs.existsSync(lyricsPath)) {
    const raw = JSON.parse(fs.readFileSync(lyricsPath, "utf8")) as Record<string, unknown>;
    lrclibData = {
      syncedLyrics: typeof raw.syncedLyrics === "string" ? raw.syncedLyrics : undefined,
      plainLyrics: typeof raw.plainLyrics === "string" ? raw.plainLyrics : undefined,
    };
  }

  const song = assembleBlueprint(chordMiniData, title, { lrclibData });

  const outPath = outputPath ?? path.join(
    path.dirname(path.resolve(chordMiniPath)),
    path.basename(chordMiniPath, path.extname(chordMiniPath))
      .replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".trackdraft.json",
  );

  fs.writeFileSync(outPath, JSON.stringify(song, null, 2));
  console.log(`✅ Assembled: ${outPath}`);
  console.log(`   Title: ${song.title}`);
  console.log(`   Key: ${song.key} ${song.scale}, BPM: ${song.bpm}`);
  console.log(`   Sections: ${song.sections.length}`);
  for (const s of song.sections) {
    console.log(`     ${s.name} (${s.role}): ${s.bars} bars, ${s.chords.length} chords, ${s.velocity}`);
  }
}