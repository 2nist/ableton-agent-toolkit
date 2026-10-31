/**
 * Leads — the "what should I look at?" engine.
 *
 * Discovery fails on a blank query form, so the surface proposes instead:
 * a couple of facts that are always true of the current scope, then the
 * biggest deviations between a group and the scope's own average. Deterministic
 * (no sampling, no ML), support-gated so a 3-section group can't headline, and
 * every lead carries the filter that reproduces it.
 */

import { dimensionDef, displayValue, measureDef, type DimensionDef, type MeasureDef } from "./fields";
import { measureValue, rowValue } from "./report";
import type { Grain, StudyFilter, StudyRow } from "./types";

export interface Lead {
  id: string;
  text: string;
  detail: string;
  /** Clicking the lead narrows every panel to the group that produced it. */
  filter?: StudyFilter;
}

const CONTRAST_DIMENSIONS: Record<Grain, string[]> = {
  song: ["genre", "form", "key", "meter"],
  section: ["role", "velocity", "meter", "key"],
  chord: ["roman", "role", "fn", "meter"],
};

const CONTRAST_MEASURES: Record<Grain, string[]> = {
  song: ["meanTension", "meanBars", "melodyShare"],
  section: ["meanTension", "meanBars", "melodyShare", "borrowShare"],
  chord: ["meanTension", "meanDuration", "borrowShare"],
};

const GRAIN_LABEL: Record<Grain, string> = {
  song: "songs",
  section: "sections",
  chord: "chords",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMeasure(value: number, kind: "mean" | "share", field?: string): string {
  if (kind === "share") return pct(value);
  if (field === "meanTension" || field === "avgTension" || field === "tension") return value.toFixed(2);
  return value.toFixed(1);
}

function valueLabel(measureKey: string, field: string | undefined): string {
  const def = measureDef("section", measureKey) ?? measureDef("chord", measureKey) ?? measureDef("song", measureKey);
  return def?.label ?? field ?? measureKey;
}

function facts(rows: readonly StudyRow[], grain: Grain): Lead[] {
  const out: Lead[] = [];
  const total = rows.length;
  if (total === 0) return out;

  if (grain === "chord") {
    const moves = new Map<string, number>();
    const degrees = new Map<string, number>();
    for (const row of rows) {
      if (row.grain !== "chord") continue;
      if (row.nextRoman !== "(end)") {
        const key = `${row.roman} → ${row.nextRoman}`;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      }
      degrees.set(row.roman, (degrees.get(row.roman) ?? 0) + 1);
    }
    const topMove = [...moves].sort((a, b) => b[1] - a[1])[0];
    const topDegree = [...degrees].sort((a, b) => b[1] - a[1])[0];
    if (topDegree) {
      out.push({
        id: "fact-degree",
        text: `Most-used degree: ${topDegree[0]}`,
        detail: `${topDegree[1]} of ${total} chords`,
        filter: { field: "roman", op: "eq", value: topDegree[0], grain: "chord" },
      });
    }
    if (topMove) {
      out.push({
        id: "fact-move",
        text: `Most common move: ${topMove[0]}`,
        detail: `${topMove[1]} of ${total} chords`,
      });
    }
    return out;
  }

  if (grain === "song") {
    const forms = new Map<string, number>();
    for (const row of rows) {
      const key = displayValue(row, "form");
      forms.set(key, (forms.get(key) ?? 0) + 1);
    }
    const topForm = [...forms].sort((a, b) => b[1] - a[1])[0];
    if (topForm) {
      out.push({
        id: "fact-form",
        text: `Most common form: ${topForm[0]}`,
        detail: `${topForm[1]} of ${total} songs`,
        filter: { field: "form", op: "eq", value: topForm[0], grain: "song" },
      });
    }
    const melody = rows.reduce((sum, row) => sum + Number((row as unknown as Record<string, unknown>).melodyShare ?? 0), 0) / total;
    out.push({ id: "fact-melody", text: `${pct(melody)} of a song's sections carry a melody`, detail: `scope average · ${total} songs` });
    return out;
  }

  const roles = new Map<string, number>();
  let withMelody = 0;
  let cadenced = 0;
  for (const row of rows) {
    if (row.grain !== "section") continue;
    roles.set(row.role, (roles.get(row.role) ?? 0) + 1);
    if (row.hasMelody) withMelody += 1;
    if (row.cadences) cadenced += 1;
  }
  const topRole = [...roles].sort((a, b) => b[1] - a[1])[0];
  if (topRole && topRole[0] !== "untagged") {
    out.push({
      id: "fact-role",
      text: `${pct(topRole[1] / total)} of ${GRAIN_LABEL[grain]} are ${topRole[0]}`,
      detail: `${topRole[1]} of ${total}`,
      filter: { field: "role", op: "eq", value: topRole[0], grain: "common" },
    });
  } else {
    // The corpus has no section roles; lead with the songs that appear most
    // instead of reporting that everything is untagged.
    const titles = new Map<string, number>();
    for (const row of rows) {
      if (row.grain !== "section") continue;
      titles.set(row.title, (titles.get(row.title) ?? 0) + 1);
    }
    const topTitle = [...titles].sort((a, b) => b[1] - a[1])[0];
    if (topTitle) {
      out.push({
        id: "fact-title",
        text: `Most sections come from ${topTitle[0]}`,
        detail: `${topTitle[1]} of ${total}`,
        filter: { field: "title", op: "eq", value: topTitle[0], grain: "common" },
      });
    }
  }
  out.push({
    id: "fact-melody",
    text: `${pct(withMelody / total)} of sections carry a melody`,
    detail: `${withMelody} of ${total} · ${pct(cadenced / total)} end a cadence`,
  });
  return out;
}

interface Bucket {
  key: string;
  n: number;
  sums: number[];
  counts: number[];
  hits: number[];
}

/** Group-vs-scope deviations, support-gated and ranked.
 *
 *  One pass per dimension accumulating counts/sums/hits, instead of building a
 *  row array per group and measuring each one. On the 65k-chord corpus this is
 *  the difference between ~100 ms and ~30 ms per render. */
function contrasts(rows: readonly StudyRow[], grain: Grain): Lead[] {
  const total = rows.length;
  if (total === 0) return [];
  const minSupport = Math.max(3, Math.ceil(total * 0.08));
  const dimensions = CONTRAST_DIMENSIONS[grain]
    .map((key) => dimensionDef(grain, key))
    .filter((entry): entry is DimensionDef => !!entry);
  const measures = CONTRAST_MEASURES[grain]
    .map((key) => measureDef(grain, key))
    .filter((entry): entry is MeasureDef => !!entry && entry.kind !== "count");
  if (dimensions.length === 0 || measures.length === 0) return [];

  const globals = measures.map((measure) => measureValue(rows, measure));
  const out: (Lead & { score: number })[] = [];

  for (const dimension of dimensions) {
    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      const key = displayValue(row, dimension.key);
      if (key === "untagged") continue;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          n: 0,
          sums: measures.map(() => 0),
          counts: measures.map(() => 0),
          hits: measures.map(() => 0),
        };
        buckets.set(key, bucket);
      }
      bucket.n += 1;
      for (let index = 0; index < measures.length; index += 1) {
        const measure = measures[index]!;
        const value = rowValue(row, measure.field!);
        if (measure.kind === "share") {
          bucket.counts[index]! += 1;
          if (typeof value === "number" ? value > 0 : !!value) bucket.hits[index]! += 1;
        } else {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            bucket.sums[index]! += numeric;
            bucket.counts[index]! += 1;
          }
        }
      }
    }
    // A dimension with hundreds of values (song titles) compares noise.
    if (buckets.size > 50) continue;

    for (const bucket of buckets.values()) {
      if (bucket.n < minSupport || bucket.n > total * 0.75) continue;
      for (let index = 0; index < measures.length; index += 1) {
        const measure = measures[index]!;
        const global = globals[index]!;
        const observations = bucket.counts[index]!;
        if (!Number.isFinite(global) || observations === 0) continue;
        const value = measure.kind === "share"
          ? bucket.hits[index]! / observations
          : bucket.sums[index]! / observations;
        if (!Number.isFinite(value)) continue;

        let effect = 0;
        let text = "";
        const label = valueLabel(measure.key, measure.field);
        if (measure.kind === "share") {
          const diff = value - global;
          if (Math.abs(diff) < 0.12) continue;
          effect = Math.abs(diff) / 0.12;
          text = `${bucket.key}: ${label} ${diff >= 0 ? "+" : ""}${Math.round(diff * 100)} pts vs scope`;
        } else {
          if (global <= 1e-6) continue;
          const ratio = value / global;
          if (ratio < 1.2 && ratio > 0.83) continue;
          effect = Math.abs(Math.log2(ratio));
          text = `${bucket.key}: ${label} ${ratio.toFixed(1)}× the scope`;
        }
        out.push({
          id: `contrast-${dimension.key}-${bucket.key}-${measure.key}`,
          text,
          detail: `${formatMeasure(value, measure.kind === "share" ? "share" : "mean", measure.field)} vs ${formatMeasure(global, measure.kind === "share" ? "share" : "mean", measure.field)} · n=${bucket.n}/${total} · by ${dimension.label}`,
          filter: {
            field: dimension.key,
            op: "eq",
            value: bucket.key,
            grain: dimension.grain === "common" ? "common" : grain,
          },
          score: effect * Math.sqrt(bucket.n / total),
        });
      }
    }
  }

  out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  const seen = new Set<string>();
  const unique: Lead[] = [];
  for (const lead of out) {
    if (seen.has(lead.text)) continue;
    seen.add(lead.text);
    unique.push({ id: lead.id, text: lead.text, detail: lead.detail, filter: lead.filter });
    if (unique.length >= 4) break;
  }
  return unique;
}

export function computeLeads(rows: readonly StudyRow[], grain: Grain): Lead[] {
  return [...facts(rows, grain), ...contrasts(rows, grain)].slice(0, 6);
}

export function filterLabel(filter: StudyFilter): string {
  const symbol = filter.op === "eq" ? "=" : filter.op === "contains" ? "has" : filter.op;
  // Grain-specific filters (roman, nextRoman, cadence…) only narrow their own
  // panels; naming the grain on the chip is what stops that reading as a bug.
  const scope = filter.grain === "common" ? "" : ` · ${filter.grain}`;
  return `${filter.field} ${symbol} ${filter.value}${scope}`;
}
