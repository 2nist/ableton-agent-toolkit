import { ALL_LANES, type DrumLaneId, type GridBar } from "@drum/library";
import type { DrumPattern } from "../../types/blueprint";

/**
 * The drum-analysis exchange format — what the audio→grid side writes and
 * the importer runner reads. One file per song:
 *
 * ```json
 * {
 *   "format": "trackdraft-drum-analysis",
 *   "songId": "beatles-01-drive-my-car",
 *   "beatsPerBar": 4,
 *   "stepsPerBar": 16,
 *   "bars": [ { "lanes": { "kick": [100, 0, …], "snare": […], "hat": […] } }, … ],
 *   "sections": [
 *     { "sectionId": "…-section-1", "startBar": 2, "bars": 8 },
 *     { "sectionName": "refrain", "startBar": 10, "bars": 8 }
 *   ]
 * }
 * ```
 *
 * `bars` is the flat song timeline the grid was transcribed on (`GridBar`
 * from `@drum/library`: per lane, `stepsPerBar` step velocities, 0 = rest).
 * Each `sections` entry names a span of that timeline and the song section
 * it belongs to — `gridToBlocks` turns each span into `DrumBlock`s. The
 * analyzer picks `stepsPerBar` (16 straight / 12 triplet feel) and
 * `beatsPerBar`; per the converter's current contract both are constant
 * across the song.
 *
 * Parsing is intentionally a clear, strict boundary (same philosophy as
 * `parseImportedSong`): the file is written by another tool, so every
 * malformed shape fails HERE with a message naming the field, instead of
 * deep inside the converter.
 */

/** One span of the grid timeline → one song section. */
export interface AnalysisSectionRef {
  /** Song section id — the primary match key. */
  sectionId?: string;
  /** Fallback match key (case-insensitive name) when ids are unknown. */
  sectionName?: string;
  /** Optional role hint for the converter (e.g. "chorus"). */
  role?: string;
  /** Song-global bar where this span starts. */
  startBar: number;
  /** Span length in bars. */
  bars: number;
}

export interface DrumAnalysisFile {
  /** Format tag — informational ("trackdraft-drum-analysis"). */
  format?: string;
  /** Match hint: which song the analysis was made against. */
  songId?: string;
  songTitle?: string;
  /** Quarter-note beats per bar (default 4). */
  beatsPerBar: number;
  /** Grid steps per bar — 16 for straight 16ths, 12 for triplet feel. */
  stepsPerBar: number;
  /** The flat song timeline of per-bar lane step grids. */
  bars: GridBar[];
  /** Grid spans to import, in any order (song order preferred). */
  sections: AnalysisSectionRef[];
  /** Lanes the import keeps — the rest are cleared across the span.
   *  Converter default: kick / snare / hat. */
  lanes?: DrumLaneId[];
  /** "euclid" (default) keeps fill detail; "motion" replaces fills with a
   *  native gesture (loses fill detail). */
  fillEncoding?: "euclid" | "motion";
  /** Base pattern to opt into the legacy arrangement (converter default
   *  "none": the muted base + blocks is the pure path). */
  basePattern?: DrumPattern;
}

/** Every pattern a `drumPattern` may name (mirrors @drum/library's copy). */
export const DRUM_PATTERN_NAMES: readonly DrumPattern[] = [
  "none", "kick_only", "standard", "half_time", "driving",
  "bridge_sparse", "intense", "dnb", "78", "68", "54",
];

const LANE_SET = new Set<string>(ALL_LANES);

function fail(what: string, got?: string): never {
  throw new Error(`Not a valid drum analysis file: ${what}${got ? ` (got ${got})` : ""}.`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) ? v : null;
}

/** Validate + normalize an analysis file (throws with a field-named message). */
export function parseAnalysisFile(raw: unknown): DrumAnalysisFile {
  if (!isObj(raw)) fail("expected a JSON object");

  const stepsPerBar = finiteInt(raw.stepsPerBar);
  if (stepsPerBar === null || stepsPerBar < 1) fail(`"stepsPerBar" must be a positive integer (16 straight / 12 triplet feel)`, String(raw.stepsPerBar));

  const beatsPerBar = raw.beatsPerBar === undefined ? 4 : finiteInt(raw.beatsPerBar);
  if (beatsPerBar === null || beatsPerBar < 1) fail(`"beatsPerBar" must be a positive integer`, String(raw.beatsPerBar));

  if (!Array.isArray(raw.bars) || raw.bars.length === 0) fail(`"bars" must be a non-empty array of { lanes } grids`);
  const bars: GridBar[] = raw.bars.map((bar, bi) => {
    if (!isObj(bar)) fail(`bars[${bi}] must be an object`);
    const lanesRaw = bar.lanes;
    if (lanesRaw !== undefined && !isObj(lanesRaw)) fail(`bars[${bi}].lanes must be an object`);
    const lanes: GridBar["lanes"] = {};
    for (const [key, steps] of Object.entries((lanesRaw as Record<string, unknown>) ?? {})) {
      if (!LANE_SET.has(key)) fail(`bars[${bi}].lanes."${key}" is not a lane`, ALL_LANES.join("/"));
      if (!Array.isArray(steps)) fail(`bars[${bi}].lanes."${key}" must be an array of step velocities`);
      for (const v of steps) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(`bars[${bi}].lanes."${key}" has a non-numeric/negative step velocity`, String(v));
      }
      lanes[key as DrumLaneId] = steps as number[];
    }
    return { lanes };
  });

  if (!Array.isArray(raw.sections) || raw.sections.length === 0) fail(`"sections" must be a non-empty array of { startBar, bars, sectionId?/sectionName? }`);
  const sections: AnalysisSectionRef[] = raw.sections.map((sec, si) => {
    if (!isObj(sec)) fail(`sections[${si}] must be an object`);
    const startBar = finiteInt(sec.startBar);
    const barsN = finiteInt(sec.bars);
    if (startBar === null || startBar < 0) fail(`sections[${si}].startBar must be a non-negative integer`, String(sec.startBar));
    if (barsN === null || barsN < 1) fail(`sections[${si}].bars must be a positive integer`, String(sec.bars));
    if (typeof sec.sectionId !== "string" && typeof sec.sectionName !== "string") {
      fail(`sections[${si}] needs a "sectionId" string (or "sectionName")`);
    }
    return {
      sectionId: typeof sec.sectionId === "string" ? sec.sectionId : undefined,
      sectionName: typeof sec.sectionName === "string" ? sec.sectionName : undefined,
      role: typeof sec.role === "string" ? sec.role : undefined,
      startBar,
      bars: barsN,
    };
  });

  let lanes: DrumLaneId[] | undefined;
  if (raw.lanes !== undefined) {
    if (!Array.isArray(raw.lanes) || raw.lanes.length === 0) fail(`"lanes" must be a non-empty array of lane ids`);
    for (const l of raw.lanes) {
      if (typeof l !== "string" || !LANE_SET.has(l)) fail(`"lanes" has an unknown lane`, `${String(l)} — valid: ${ALL_LANES.join("/")}`);
    }
    lanes = raw.lanes as DrumLaneId[];
  }

  if (raw.fillEncoding !== undefined && raw.fillEncoding !== "euclid" && raw.fillEncoding !== "motion") {
    fail(`"fillEncoding" must be "euclid" or "motion"`, String(raw.fillEncoding));
  }
  if (raw.basePattern !== undefined && (typeof raw.basePattern !== "string" || !DRUM_PATTERN_NAMES.includes(raw.basePattern as DrumPattern))) {
    fail(`"basePattern" is not a drum pattern`, `${String(raw.basePattern)} — valid: ${DRUM_PATTERN_NAMES.join("/")}`);
  }

  return {
    format: typeof raw.format === "string" ? raw.format : undefined,
    songId: typeof raw.songId === "string" ? raw.songId : undefined,
    songTitle: typeof raw.songTitle === "string" ? raw.songTitle : undefined,
    beatsPerBar,
    stepsPerBar,
    bars,
    sections,
    lanes,
    fillEncoding: raw.fillEncoding as DrumAnalysisFile["fillEncoding"],
    basePattern: raw.basePattern as DrumPattern | undefined,
  };
}
