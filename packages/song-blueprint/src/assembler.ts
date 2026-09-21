/**
 * Heuristic BlueprintSong assembler.
 *
 * Takes raw ChordMiniApp analysis data (chords, per-second loudness segments) +
 * optional LRCLIB synced lyrics and produces a structured BlueprintSong with
 * meaningful section labels (intro, verse, chorus, bridge, outro).
 *
 * Strategy:
 *   1. Group loudness segments into structural regions based on energy curves
 *   2. Map energy regions → structural sections using position + energy heuristics
 *   3. Assign chords and lyrics to each section
 *   4. Produce a clean BlueprintSong with 6-16 labeled sections
 *
 * Single source of truth — used by:
 *   - apps/trackdraft/scripts/assemble-blueprint.ts  (CLI)
 *   - apps/trackdraft/vite.config.ts                    (dev server)
 *   - apps/trackdraft/src/components/dashboard/ActionBar.tsx  (browser)
 */

import type { NoteName } from "@music-theory/core";
import { chordMiniAppToBlueprintSong } from "./adapters";
import type {
  BlueprintSong,
  BlueprintSection,
  Chord,
  ChordMiniAppResult,
  LrclibData,
} from "./index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnergyRegion {
  label: "quiet" | "medium" | "loud";
  startTime: number;
  endTime: number;
}

interface SectionCandidate {
  name: string;
  role: BlueprintSection["role"];
  startTime: number;
  endTime: number;
  loudnessProfile: string;
}

// ---------------------------------------------------------------------------
// Section templates (heuristic scoring)
// ---------------------------------------------------------------------------

const SECTION_TEMPLATES: Array<{
  role: BlueprintSection["role"];
  name: string;
  typicalEnergy: string;
  typicalPosition: "start" | "middle" | "end" | "any";
  typicalDurationSec: number;
}> = [
  { role: "intro",      name: "Intro",      typicalEnergy: "quiet",   typicalPosition: "start",  typicalDurationSec: 15 },
  { role: "verse",      name: "Verse",       typicalEnergy: "medium",  typicalPosition: "any",    typicalDurationSec: 25 },
  { role: "chorus",     name: "Chorus",      typicalEnergy: "loud",    typicalPosition: "any",    typicalDurationSec: 20 },
  { role: "bridge",     name: "Bridge",      typicalEnergy: "medium",  typicalPosition: "middle", typicalDurationSec: 20 },
  { role: "solo",       name: "Solo",        typicalEnergy: "loud",    typicalPosition: "middle", typicalDurationSec: 25 },
  { role: "breakdown",  name: "Breakdown",   typicalEnergy: "quiet",   typicalPosition: "middle", typicalDurationSec: 20 },
  { role: "outro",      name: "Outro",       typicalEnergy: "quiet",   typicalPosition: "end",    typicalDurationSec: 20 },
];

// ---------------------------------------------------------------------------
// Loudness → energy regions
// ---------------------------------------------------------------------------

function loudnessToEnergyRegions(
  segments: Array<{ start: number; end: number; loudness: number }>,
): EnergyRegion[] {
  if (segments.length === 0) return [];
  const values = segments.map((s) => s.loudness).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] ?? 0.1;

  const regions: EnergyRegion[] = [];
  let cur: EnergyRegion | null = null;
  for (const seg of segments) {
    const label: EnergyRegion["label"] =
      seg.loudness < median * 0.6 ? "quiet" :
      seg.loudness > median * 1.5 ? "loud" : "medium";
    if (!cur) {
      cur = { label, startTime: seg.start, endTime: seg.end };
    } else if (cur.label === label) {
      cur.endTime = seg.end;
    } else {
      regions.push(cur);
      cur = { label, startTime: seg.start, endTime: seg.end };
    }
  }
  if (cur) regions.push(cur);
  return regions;
}

// ---------------------------------------------------------------------------
// Energy regions → structural sections
// ---------------------------------------------------------------------------

function energyRegionsToSections(regions: EnergyRegion[], totalDuration: number): SectionCandidate[] {
  if (regions.length === 0) return [];

  // Merge tiny regions (<4s) into their left neighbor
  const merged: EnergyRegion[] = [];
  for (const r of regions) {
    if (r.endTime - r.startTime < 4 && merged.length > 0) {
      merged[merged.length - 1].endTime = r.endTime;
    } else {
      merged.push({ ...r });
    }
  }

  return merged.map((region) => {
    const pos = region.startTime / totalDuration;
    const dur = region.endTime - region.startTime;
    let best = SECTION_TEMPLATES[0];
    let bestScore = -Infinity;

    for (const tmpl of SECTION_TEMPLATES) {
      let score = 0;
      // Position
      if (tmpl.typicalPosition === "start" && pos < 0.15) score += 3;
      if (tmpl.typicalPosition === "start" && pos >= 0.15) score -= 2;
      if (tmpl.typicalPosition === "end" && pos > 0.80) score += 3;
      if (tmpl.typicalPosition === "end" && pos <= 0.80) score -= 1;
      if (tmpl.typicalPosition === "middle" && pos > 0.15 && pos < 0.80) score += 1;
      if (tmpl.typicalPosition === "any") score += 1;
      // Energy
      if (tmpl.typicalEnergy === region.label) score += 2;
      if (tmpl.typicalEnergy === "loud" && region.label === "medium") score += 1;
      // Duration
      const durDiff = Math.abs(dur - tmpl.typicalDurationSec);
      if (durDiff < 5) score += 2;
      else if (durDiff < 15) score += 1;
      else score -= 1;
      // Hard constraints
      if (tmpl.role === "bridge" && (pos < 0.35 || pos > 0.75)) score -= 3;
      if (tmpl.role === "solo" && (pos < 0.45 || pos > 0.90)) score -= 3;
      if (tmpl.role === "intro" && pos > 0.15) score -= 5;
      if (tmpl.role === "outro" && pos < 0.75) score -= 5;
      if (score > bestScore) { bestScore = score; best = tmpl; }
    }

    // Generate distinct names for repeated roles
    // (We compute this after building all candidates via outer closure — see caller)
    return { name: best.name, role: best.role, startTime: region.startTime, endTime: region.endTime, loudnessProfile: region.label };
  });
}

/** Assign distinct names to candidates with the same role (e.g. "Verse 1", "Verse 2"). */
function deduplicateNames(candidates: SectionCandidate[]): SectionCandidate[] {
  const counts = new Map<BlueprintSection["role"], number>();
  return candidates.map((c) => {
    const n = (counts.get(c.role) ?? 0) + 1;
    counts.set(c.role, n);
    return { ...c, name: n > 1 ? `${c.name} ${n}` : c.name };
  });
}

// ---------------------------------------------------------------------------
// Lyrics alignment
// ---------------------------------------------------------------------------

function assignLyricsToSections(
  sections: BlueprintSection[],
  spans: Array<{ startTime: number; endTime: number }>,
  lrclibData: LrclibData | undefined,
  bpm: number,
): void {
  if (!lrclibData?.syncedLyrics) return;
  const lines = lrclibData.syncedLyrics.split("\n");
  const spb = 60 / bpm;
  const timeline: Array<{ text: string; timeSec: number }> = [];
  for (const line of lines) {
    const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (m) {
      timeline.push({
        text: m[4].trim(),
        timeSec: parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100),
      });
    }
  }
  if (timeline.length === 0) return;

  // Window by REAL audio time: [boundary, next span.start). Lines in
  // filtered-out gaps attach to the section before them; lines before the
  // first span land in the first section and everything after the final
  // span lands in the last, so no lyric is ever dropped.
  for (let i = 0; i < sections.length; i++) {
    const span = spans[i];
    if (!span) continue;
    const windowStart = i === 0 ? -Infinity : span.startTime;
    const windowEnd = spans[i + 1]?.startTime ?? Infinity;
    const hits = timeline.filter((l) => l.timeSec >= windowStart && l.timeSec < windowEnd);
    if (hits.length > 0) {
      sections[i].lyrics = hits.map((l) => l.text).join("\n");
      sections[i].lyricsTimeline = hits.map((l) => ({
        text: l.text,
        startBeat: Math.max(0, Math.round(((l.timeSec - span.startTime) / spb) * 1000) / 1000),
      }));
    }
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

export function assembleBlueprint(
  chordMiniData: ChordMiniAppResult,
  title: string,
  options: AssemblyOptions = {},
): BlueprintSong {
  const { lrclibData, maxSections = 16, minSectionDuration = 8 } = options;

  // Step 1: basic conversion (handles chord format normalization + lyrics parse)
  const base = chordMiniAppToBlueprintSong(chordMiniData, title, undefined, lrclibData);

  // Step 2: extract loudness data
  const loudSegments = (chordMiniData.segments ?? []).map((seg) => ({
    start: (seg as { start_time?: number; start?: number }).start_time ?? (seg as { start?: number }).start ?? 0,
    end: (seg as { end_time?: number; end?: number }).end_time ?? (seg as { end?: number }).end ?? 0,
    loudness: (seg as { loudness?: number }).loudness ?? 0.5,
  }));

  if (loudSegments.length === 0) return base;

  const totalDuration = loudSegments[loudSegments.length - 1]?.end ?? 0;

  // Step 3: loudness → energy regions → section candidates
  const energyRegions = loudnessToEnergyRegions(loudSegments);
  let candidates = energyRegionsToSections(energyRegions, totalDuration);
  candidates = deduplicateNames(candidates);
  const usable = candidates
    .filter((c) => (c.endTime - c.startTime) >= minSectionDuration)
    .slice(0, maxSections);

  if (usable.length === 0) return base;

  // Step 4: build BlueprintSections.
  // Tile the chord progression across the usable sections proportionally to
  // their real durations, using CUMULATIVE rounding so the slices exactly
  // cover allChords in order — no gaps and no duplication.
  const bpm = base.bpm;
  const spb = 60 / bpm;
  const tsNum = base.timeSignatureNumerator;
  const allChords = base.sections[0]?.chords ?? [];

  const usableDur = usable.reduce((sum, c) => sum + (c.endTime - c.startTime), 0);
  let cumDur = 0;
  const endIdx = usable.map((c, i) => {
    cumDur += c.endTime - c.startTime;
    const frac = usableDur > 0 ? cumDur / usableDur : (i + 1) / usable.length;
    return Math.round(allChords.length * frac);
  });

  const sections: BlueprintSection[] = usable.map((c, i) => {
    const durSec = c.endTime - c.startTime;
    const durBeats = durSec / spb;
    const bars = Math.max(4, Math.ceil(durBeats / tsNum));
    const startIdx = i === 0 ? 0 : endIdx[i - 1];
    const sc = allChords.slice(startIdx, endIdx[i]);

    return {
      id: crypto.randomUUID(),
      name: c.name,
      role: c.role,
      bars,
      chords: sc,
      beatsPerChord: 4,
      velocity: c.loudnessProfile === "loud" ? "f" : c.loudnessProfile === "quiet" ? "mp" : "mf",
      timeSignatureNumerator: tsNum,
      timeSignatureDenPower: 2,
    };
  });

  // Clamp bars to chord totals
  for (const s of sections) {
    const cb = s.chords.reduce((sum, c) => sum + c.beats, 0);
    const need = Math.ceil(cb / tsNum);
    if (need > s.bars) s.bars = Math.min(need, s.bars * 2);
    if (s.bars < 4) s.bars = 4;
  }

  // Step 5: assign lyrics (windowed by each section's real audio span)
  assignLyricsToSections(
    sections,
    usable.map((c) => ({ startTime: c.startTime, endTime: c.endTime })),
    lrclibData ?? undefined,
    bpm,
  );

  return {
    ...base,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
  };
}