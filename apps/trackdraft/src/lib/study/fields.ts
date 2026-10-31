/**
 * The Study field registry — the one place that decides what can be grouped,
 * filtered or measured, and at which grain.
 *
 * Every panel control is generated from this list, so a new data type is one
 * descriptor rather than a new screen. `grain: "common"` means the field is
 * denormalised onto every row (a chord row still knows its song's genre), so
 * it can group any panel; a grain-specific field can only narrow its own
 * grain — a `roman` filter is meaningless to a section panel.
 */

import type { Grain, StudyRow } from "./types";

export type FieldGrain = Grain | "common";

export interface DimensionDef {
  key: string;
  label: string;
  grain: FieldGrain;
}

export interface MeasureDef {
  key: string;
  label: string;
  grain: Grain;
  /** `share` reads a boolean field; `mean` a numeric one. */
  kind: "count" | "mean" | "share";
  field?: string;
}

export const DIMENSIONS: readonly DimensionDef[] = [
  { key: "title", label: "song", grain: "common" },
  { key: "artist", label: "artist", grain: "common" },
  { key: "genre", label: "genre", grain: "common" },
  { key: "key", label: "key", grain: "common" },
  { key: "scale", label: "scale", grain: "common" },
  { key: "meter", label: "meter", grain: "common" },
  { key: "section", label: "section name", grain: "common" },
  { key: "role", label: "role", grain: "common" },
  { key: "form", label: "form", grain: "song" },
  { key: "velocity", label: "velocity", grain: "section" },
  { key: "roman", label: "degree", grain: "chord" },
  { key: "nextRoman", label: "next degree", grain: "chord" },
  { key: "degree", label: "degree number", grain: "chord" },
  { key: "quality", label: "quality", grain: "chord" },
  { key: "fn", label: "function", grain: "chord" },
  { key: "cadence", label: "cadence", grain: "chord" },
  { key: "borrowed", label: "borrowed", grain: "chord" },
];

/** Keys repeat across grains on purpose — a measure is only resolved inside
 *  its panel's grain (`measureDef(grain, key)`), and the same key means the
 *  same idea at every grain ("% borrowed" is a share of the grain's rows). */
export const MEASURES: readonly MeasureDef[] = [
  { key: "count", label: "count", grain: "song", kind: "count" },
  { key: "meanBars", label: "mean bars", grain: "song", kind: "mean", field: "totalBars" },
  { key: "meanSections", label: "mean sections", grain: "song", kind: "mean", field: "sectionCount" },
  { key: "meanTension", label: "mean tension", grain: "song", kind: "mean", field: "avgTension" },
  { key: "borrowShare", label: "% borrowed", grain: "song", kind: "mean", field: "borrowedShare" },
  { key: "melodyShare", label: "% with melody", grain: "song", kind: "mean", field: "melodyShare" },
  { key: "lyricShare", label: "% with lyrics", grain: "song", kind: "mean", field: "lyricShare" },

  { key: "count", label: "count", grain: "section", kind: "count" },
  { key: "meanBars", label: "mean bars", grain: "section", kind: "mean", field: "bars" },
  { key: "meanChords", label: "mean chords", grain: "section", kind: "mean", field: "chordCount" },
  { key: "meanDegrees", label: "mean distinct degrees", grain: "section", kind: "mean", field: "distinctDegrees" },
  { key: "meanTension", label: "mean tension", grain: "section", kind: "mean", field: "avgTension" },
  { key: "borrowShare", label: "% borrowed", grain: "section", kind: "share", field: "borrowed" },
  { key: "melodyShare", label: "% with melody", grain: "section", kind: "share", field: "hasMelody" },
  { key: "lyricShare", label: "% with lyrics", grain: "section", kind: "share", field: "hasLyrics" },
  { key: "drumShare", label: "% with drums", grain: "section", kind: "share", field: "hasDrums" },

  { key: "count", label: "count", grain: "chord", kind: "count" },
  { key: "meanTension", label: "mean tension", grain: "chord", kind: "mean", field: "tension" },
  { key: "meanDuration", label: "mean beats", grain: "chord", kind: "mean", field: "durationBeats" },
  { key: "borrowShare", label: "% borrowed", grain: "chord", kind: "share", field: "borrowed" },
  { key: "appliedShare", label: "% applied", grain: "chord", kind: "share", field: "applied" },
];

const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((d) => [`${d.grain}:${d.key}`, d]));

export function dimensionsFor(grain: Grain): DimensionDef[] {
  return DIMENSIONS.filter((d) => d.grain === "common" || d.grain === grain);
}

export function dimensionDef(grain: Grain, key: string | undefined): DimensionDef | undefined {
  if (!key) return undefined;
  return DIMENSION_BY_KEY.get(`common:${key}`) ?? DIMENSION_BY_KEY.get(`${grain}:${key}`);
}

export function measuresFor(grain: Grain): MeasureDef[] {
  return MEASURES.filter((m) => m.grain === grain);
}

export function measureDef(grain: Grain, key: string): MeasureDef | undefined {
  return MEASURES.find((m) => m.grain === grain && m.key === key);
}

/** Human value for a grouped row — booleans read yes/no, blanks read as an
 *  honest "untagged" rather than an empty cell. */
export function displayValue(row: StudyRow, key: string): string {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === undefined || value === "") return "untagged";
  if (typeof value === "number" && !Number.isFinite(value)) return "untagged";
  return String(value);
}
